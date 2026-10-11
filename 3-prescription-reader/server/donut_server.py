"""
Donut Prescription OCR — FastAPI Inference Server

Serves the fine-tuned Donut model for prescription image → structured medication extraction.
Works alongside Gemini in an ensemble architecture.

Usage:
  pip install -r requirements.txt
  python donut_server.py

The server will start on http://localhost:8000
"""

import io
import re
import json
import time
import logging
import os
import sys
import asyncio
import traceback
import hmac
from pathlib import Path
from contextlib import asynccontextmanager

import torch
from PIL import Image
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from transformers import DonutProcessor, VisionEncoderDecoderModel
from donut_safety import normalize_medication, normalize_medications, decode_image_base64, load_image_bytes

# ─────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────

# Remote fallback if no local model exists
MODEL_NAME = "chinmays18/medical-prescription-ocr"

# Search order for the locally trained model:
#   1. Project root: best_model/  (downloaded from Colab)
#   2. Server dir:   server/models/donut-prescription/
#   3. Fallback:     download from HuggingFace
LOCAL_MODEL_PATH_PRIMARY = Path(__file__).parent.parent / "best_model"
LOCAL_MODEL_PATH_SECONDARY = Path(__file__).parent / "models" / "donut-prescription"

# Server settings
HOST = os.getenv("DONUT_HOST", "127.0.0.1")
PORT = 8000
MAX_IMAGE_SIZE_MB = 10
MAX_IMAGE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024
MAX_IMAGE_PIXELS = max(1, min(16000000, int(os.getenv("DONUT_MAX_IMAGE_PIXELS", "16000000"))))
MAX_PENDING_INFERENCES = max(1, min(16, int(os.getenv("DONUT_MAX_PENDING_INFERENCES", "2"))))
INTERNAL_TOKEN = os.getenv("DONUT_INTERNAL_TOKEN", "")
MAX_CONCURRENT_INFERENCES = max(1, int(os.getenv("DONUT_MAX_CONCURRENT_INFERENCES", "1")))
INFERENCE_QUEUE_TIMEOUT_SEC = max(10, int(os.getenv("DONUT_QUEUE_TIMEOUT_SEC", "180")))
CPU_MAX_LENGTH = max(96, int(os.getenv("DONUT_CPU_MAX_LENGTH", "160")))
GPU_MAX_LENGTH = max(128, int(os.getenv("DONUT_GPU_MAX_LENGTH", "512")))
CPU_NUM_BEAMS = max(1, int(os.getenv("DONUT_CPU_NUM_BEAMS", "1")))
GPU_NUM_BEAMS = max(1, int(os.getenv("DONUT_GPU_NUM_BEAMS", "3")))

# ─────────────────────────────────────────────
# Logging
# ─────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("donut-server")

# ─────────────────────────────────────────────
# Global model holder
# ─────────────────────────────────────────────

class DonutModel:
    """Singleton model wrapper for Donut prescription OCR."""

    def __init__(self):
        self.processor: DonutProcessor | None = None
        self.model: VisionEncoderDecoderModel | None = None
        self.device: str = "cpu"
        self.model_name: str = MODEL_NAME
        self.is_ready: bool = False

    def _move_model_to_device(self, target_device: str) -> None:
        if self.model is None:
            raise RuntimeError("Model not initialized")
        self.model.to(target_device)
        self.model.eval()
        self.device = target_device

    def _is_cuda_runtime_error(self, exc: Exception) -> bool:
        msg = str(exc).lower()
        return (
            "cuda" in msg or
            "cublas" in msg or
            "cudnn" in msg or
            "out of memory" in msg or
            "device-side assert" in msg
        )

    def load(self):
        """Load model from local cache or download from HuggingFace."""
        log.info("=" * 60)
        log.info("Loading Donut Prescription OCR Model...")
        log.info("=" * 60)

        # Determine preferred device
        prefer_gpu = torch.cuda.is_available()
        if prefer_gpu:
            gpu_name = torch.cuda.get_device_name(0)
            log.info(f"🚀 GPU detected: {gpu_name}")
        else:
            log.info("💻 No GPU detected — using CPU (slower, but works fine)")

        # Search for local model in priority order, then fall back to HuggingFace
        if LOCAL_MODEL_PATH_PRIMARY.exists() and (LOCAL_MODEL_PATH_PRIMARY / "model.safetensors").exists():
            model_source = str(LOCAL_MODEL_PATH_PRIMARY)
            log.info(f"🏆 Found YOUR fine-tuned model at: {model_source}")
        elif LOCAL_MODEL_PATH_SECONDARY.exists() and (LOCAL_MODEL_PATH_SECONDARY / "model.safetensors").exists():
            model_source = str(LOCAL_MODEL_PATH_SECONDARY)
            log.info(f"📂 Found cached model at: {model_source}")
        else:
            model_source = MODEL_NAME
            log.info(f"☁️  No local model found — downloading from HuggingFace: {model_source}")

        try:
            log.info(f"Loading model from: {model_source}")

            self.processor = DonutProcessor.from_pretrained(model_source)
            self.model = VisionEncoderDecoderModel.from_pretrained(model_source)

            if prefer_gpu:
                try:
                    self._move_model_to_device("cuda")
                    log.info("✅ Model initialized on GPU")
                except Exception as gpu_error:
                    log.warning(f"⚠️ Failed to initialize on GPU, falling back to CPU: {gpu_error}")
                    self._move_model_to_device("cpu")
            else:
                self._move_model_to_device("cpu")

            self.model_name = model_source
            self.is_ready = True
            log.info("✅ Model loaded successfully!")
            log.info(f"   Device: {self.device}")
            log.info(f"   Parameters: {sum(p.numel() for p in self.model.parameters()):,}")

        except Exception as e:
            log.error(f"❌ Failed to load model: {e}")
            log.error("Make sure you have internet access for first-time download.")
            raise

    def _generate_on_device(self, image: Image.Image, active_device: str) -> str:
        # Preprocess image — force to RGB JPEG bytes to avoid AVIF/WebP C-level decoder issues
        image = image.convert("RGB")

        # Re-encode through JPEG to avoid problematic image codec crashes
        jpeg_buffer = io.BytesIO()
        image.save(jpeg_buffer, format="JPEG", quality=95)
        jpeg_buffer.seek(0)
        image = Image.open(jpeg_buffer)

        pixel_values = self.processor(
            images=image, return_tensors="pt"
        ).pixel_values.to(active_device)

        # Set up task prompt for prescription OCR
        task_prompt = "<s_ocr>"
        decoder_input_ids = self.processor.tokenizer(
            task_prompt, add_special_tokens=False, return_tensors="pt"
        ).input_ids.to(active_device)

        # Build attention mask explicitly to prevent the "pad token is same as eos token" crash
        attention_mask = torch.ones(pixel_values.shape[:2], dtype=torch.long, device=active_device)

        # Run generation
        max_length = GPU_MAX_LENGTH if active_device == "cuda" else CPU_MAX_LENGTH
        num_beams = GPU_NUM_BEAMS if active_device == "cuda" else CPU_NUM_BEAMS

        with torch.no_grad():
            generate_kwargs = dict(
                pixel_values=pixel_values,
                decoder_input_ids=decoder_input_ids,
                attention_mask=attention_mask,
                max_length=max_length,
                num_beams=num_beams,
                pad_token_id=self.processor.tokenizer.pad_token_id,
                eos_token_id=self.processor.tokenizer.eos_token_id,
            )
            try:
                generated_ids = self.model.generate(**generate_kwargs)
            except Exception as gen_error:
                log.error(f"Generation failed: {gen_error}")
                raise

        generated_text = self.processor.batch_decode(
            generated_ids, skip_special_tokens=True
        )[0]

        return generated_text

    def predict(self, image: Image.Image) -> dict:
        """
        Run Donut inference on a prescription image.

        Returns:
            {
                "raw_text": "...",
                "medications": [...],
                "confidence": 0.84,
                "model": "donut-prescription-v1",
                "processing_time_ms": 450
            }
        """
        if not self.is_ready:
            raise RuntimeError("Model not loaded")

        start_time = time.time()

        active_device = self.device
        try:
            generated_text = self._generate_on_device(image, active_device)
        except Exception as gpu_error:
            if active_device == "cuda" and self._is_cuda_runtime_error(gpu_error):
                log.warning(f"⚠️ GPU inference failed, switching to CPU: {gpu_error}")
                try:
                    torch.cuda.empty_cache()
                except Exception:
                    pass

                self._move_model_to_device("cpu")
                active_device = "cpu"
                generated_text = self._generate_on_device(image, active_device)
            else:
                raise

        processing_time_ms = (time.time() - start_time) * 1000

        # Log raw model output for debugging
        log.info("Model generated %d characters", len(generated_text))

        # Parse medications from the generated text
        medications = normalize_medications(self._parse_medications(generated_text))

        # Parser scores are unvalidated heuristics, not beam-search or clinical confidence.
        confidence = sum(m["confidence"] for m in medications) / len(medications) if medications else 0

        max_length = GPU_MAX_LENGTH if active_device == "cuda" else CPU_MAX_LENGTH
        num_beams = GPU_NUM_BEAMS if active_device == "cuda" else CPU_NUM_BEAMS
        log.info(
            f"✅ Inference complete: {len(medications)} medications found, "
            f"{processing_time_ms:.0f}ms, {confidence:.0%} confidence "
            f"(beams={num_beams}, max_length={max_length})"
        )
        patient_name = self._extract_patient_name(generated_text)
        doctor_name = self._extract_doctor_name(generated_text)
        date_issued = self._extract_date(generated_text)

        return {
            "raw_text": generated_text,
            "patient_name": patient_name,
            "doctor_name": doctor_name,
            "date": date_issued,
            "medications": medications,
            "confidence": confidence,
            "confidence_kind": "unvalidated-heuristic",
            "needsReview": True,
            "model": "donut-prescription-v1",
            "device": active_device,
            "processing_time_ms": round(processing_time_ms, 1),
        }

    def _parse_medications(self, text: str) -> list[dict]:
        if not isinstance(text, str):
            return []
        native = self._extract_donut_format_medications(text)
        if native:
            return native
        match = re.search(r'\{[\s\S]*\}', text)
        if match:
            try:
                payload = json.loads(match.group())
                if isinstance(payload, dict):
                    if "medications" in payload:
                        return normalize_medications(payload["medications"])
                    return normalize_medications([payload])
            except (json.JSONDecodeError, ValueError, TypeError):
                return []
        medications = []
        pattern = r"(?:^|\n)[ \t]*(?:\d+[.)][ \t]*)?(?:(?:Drug|Medication|Rx|Tab\.?|Cap\.?|Inj\.?|Syp\.?)[ \t]*:?[ \t]+)?([A-Za-z][\w \t'-]*?)[ \t]+(\d+(?:\.\d+)?|\.\d+)[ \t]*(mg|mcg|g|ml|units?|IU|mEq)[ \t]*([^\r\n]*)"
        for match in re.finditer(pattern, text, re.IGNORECASE):
            medications.append({"drugName": match.group(1).strip(), "dosage": match.group(2) + match.group(3), "frequency": match.group(4).strip() or "Needs Review"})
        return normalize_medications(medications)

    def _extract_donut_format_medications(self, text: str) -> list[dict]:
        match = re.search(r'medications\s*:\s*(.*?)(?=\bsignature\s*:|\bdoctor\s*:|$)', text, re.IGNORECASE | re.DOTALL)
        if not match:
            return []
        section = match.group(1).strip().lstrip('-').strip()
        dose = r'(?:\d+(?:\.\d+)?|\.\d+)[ \t]*(?:mg|mcg|g|ml|units?|IU|mEq)\b'
        # Split only at another drug-and-strength, preserving hyphens in 1 - 0 - 1.
        entries = re.split(r'\s+-\s+(?=[A-Za-z][A-Za-z \t-]*?\s+' + dose + ')', section, flags=re.IGNORECASE)
        medications = []
        for entry in entries:
            item = re.match(r"^([A-Za-z][\w \t'-]*?)\s+(\d+(?:\.\d+)?|\.\d+)\s*(mg|mcg|g|ml|units?|IU|mEq)\b\s*(?:-\s*)?(.*)$", entry, re.IGNORECASE | re.DOTALL)
            if item:
                medications.append({"drugName": item.group(1), "dosage": item.group(2) + item.group(3), "frequency": item.group(4).strip() or "Needs Review"})
        return normalize_medications(medications)

    def _extract_patient_name(self, text: str) -> str:
        """Extract patient name from raw prescription text."""
        match = re.search(r'(?:patient(?:\s+name)?|pt(?:\s+name)?|name)\s*[:\-]\s*([A-Za-z\s\.\,\-\'\"]{2,40})', text, re.IGNORECASE)
        if match:
            raw = match.group(1).split("\n")[0].split(",")[0].strip()
            if len(raw) > 2 and "rx" not in raw.lower() and "dr" not in raw.lower():
                return raw
        return "Needs Review"

    def _extract_doctor_name(self, text: str) -> str:
        """Extract prescribing doctor name from raw prescription text."""
        match = re.search(r'(?:dr\.?|doctor|physician|prescriber)\s*[:\-]?\s*([A-Za-z\s\.\,\-]{2,40})', text, re.IGNORECASE)
        if match:
            raw = match.group(1).split("\n")[0].split(",")[0].strip()
            if not raw.lower().startswith("dr") and not raw.lower().startswith("doctor"):
                raw = f"Dr. {raw}"
            if len(raw) > 4:
                return raw
        return "Needs Review"

    def _extract_date(self, text: str) -> str:
        """Extract prescription date from raw text."""
        match = re.search(r'(?:date|issued|rx\s*date)\s*[:\-]?\s*([0-9]{1,4}[\/\-\.][0-9]{1,2}[\/\-\.][0-9]{1,4})', text, re.IGNORECASE)
        if not match:
            match = re.search(r'\b([0-9]{1,2}[\/\-\.][0-9]{1,2}[\/\-\.][0-9]{2,4})\b', text)
        if match:
            return match.group(1).strip()
        return "Needs Review"

    def _normalize_med(self, med_dict: dict) -> dict:
        return normalize_medication(med_dict)


# ─────────────────────────────────────────────
# FastAPI Application
# ─────────────────────────────────────────────

donut = DonutModel()
inference_semaphore = asyncio.Semaphore(MAX_CONCURRENT_INFERENCES)
active_inferences = 0
pending_inferences = 0
active_lock = asyncio.Lock()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load model on startup, cleanup on shutdown."""
    donut.load()
    yield
    log.info("Server shutting down...")


app = FastAPI(
    title="Donut Prescription OCR API",
    description="Custom ML model for prescription reading — works alongside Gemini",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS — allow the Vite frontend to call this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",   # Vite dev server
        "http://localhost:5174",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
@app.get("/api/health")
async def health_check():
    """Health check endpoint for the frontend to verify backend availability."""
    return {
        "status": "ok" if donut.is_ready else "loading",
        "model": donut.model_name,
        "device": donut.device,
        "gpu_available": torch.cuda.is_available(),
        "active_inferences": active_inferences,
        "max_concurrent_inferences": MAX_CONCURRENT_INFERENCES,
    }


async def _run_inference_with_queue(pil_image: Image.Image) -> dict:
    global active_inferences, pending_inferences
    async with active_lock:
        if pending_inferences >= MAX_PENDING_INFERENCES + MAX_CONCURRENT_INFERENCES:
            raise HTTPException(503, "Inference queue is full. Please try again later.")
        pending_inferences += 1
    acquired = False
    started = False
    try:
        try:
            await asyncio.wait_for(inference_semaphore.acquire(), timeout=INFERENCE_QUEUE_TIMEOUT_SEC)
            acquired = True
        except TimeoutError:
            raise HTTPException(503, "Inference queue timed out. Please try again later.")
        async with active_lock:
            active_inferences += 1
            started = True
        # Keep the inference permit until the worker actually finishes, even if the client disconnects.
        worker = asyncio.create_task(run_in_threadpool(donut.predict, pil_image))
        try:
            result = await asyncio.shield(worker)
        except asyncio.CancelledError:
            await worker
            raise
        if not isinstance(result, dict) or result.get("error"):
            raise HTTPException(503, "Model inference is unavailable. Please try again later.")
        return result
    except HTTPException:
        raise
    except asyncio.CancelledError:
        raise
    except Exception:
        log.error("Inference worker failed")
        raise HTTPException(503, "Model inference is unavailable. Please try again later.")
    finally:
        async with active_lock:
            pending_inferences = max(0, pending_inferences - 1)
            if started:
                active_inferences = max(0, active_inferences - 1)
        if acquired:
            inference_semaphore.release()


@app.middleware("http")
async def internal_access(request, call_next):
    if request.url.path.startswith("/api/predict") or request.url.path.startswith("/predict"):
        supplied = request.headers.get("x-donut-token", "")
        local = request.client and request.client.host in {"127.0.0.1", "::1", "localhost"}
        if (INTERNAL_TOKEN and not hmac.compare_digest(supplied, INTERNAL_TOKEN)) or (not INTERNAL_TOKEN and not local):
            return JSONResponse(status_code=403, content={"error": "Internal inference access only."})
        length = request.headers.get("content-length")
        if length is None:
            return JSONResponse(status_code=411, content={"error": "Content-Length is required."})
        try:
            if int(length) < 0 or int(length) > 4 * ((MAX_IMAGE_BYTES + 2) // 3) + 65536:
                return JSONResponse(status_code=413, content={"error": "Image request exceeds the byte limit."})
        except ValueError:
            return JSONResponse(status_code=400, content={"error": "Invalid Content-Length."})
    return await call_next(request)


@app.post("/predict")
@app.post("/api/predict")
async def predict(image: UploadFile = File(...)):
    if not donut.is_ready:
        raise HTTPException(503, "Model is still loading.")
    if image.content_type not in {"image/jpeg", "image/png", "image/webp", "image/bmp"}:
        raise HTTPException(415, "Use a JPEG, PNG, WebP, or BMP image.")
    data = await image.read(MAX_IMAGE_BYTES + 1)
    try:
        pil_image = load_image_bytes(data, MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS)
    except ValueError as error:
        raise HTTPException(413 if "limit" in str(error) else 400, str(error))
    return JSONResponse(content=await _run_inference_with_queue(pil_image))


@app.post("/predict-base64")
@app.post("/api/predict-base64")
async def predict_base64(payload: dict):
    if not donut.is_ready:
        raise HTTPException(503, "Model is still loading.")
    try:
        data = decode_image_base64(payload.get("image"), MAX_IMAGE_BYTES)
        pil_image = load_image_bytes(data, MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS)
    except ValueError as error:
        raise HTTPException(413 if "limit" in str(error) else 400, str(error))
    return JSONResponse(content=await _run_inference_with_queue(pil_image))


@app.get("/api/model-info")
async def model_info():
    """Return detailed model information."""
    if not donut.is_ready:
        return {"status": "loading"}

    return {
        "model_name": donut.model_name,
        "architecture": "Donut (Swin Transformer + BART)",
        "base_model": "naver-clova-ix/donut-base",
        "task": "Prescription OCR + Medication Extraction",
        "device": donut.device,
        "parameters": sum(p.numel() for p in donut.model.parameters()),
        "gpu_available": torch.cuda.is_available(),
        "gpu_name": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
    }


# ─────────────────────────────────────────────
# Run server
# ─────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    log.info("🏥 Starting Donut Prescription OCR Server...")
    log.info(f"   Endpoint: http://localhost:{PORT}")
    log.info(f"   Docs:     http://localhost:{PORT}/docs")

    uvicorn.run(
        "donut_server:app",
        host=HOST,
        port=PORT,
        reload=False,  # Set True for development
        log_level="info",
    )
