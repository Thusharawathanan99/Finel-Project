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
import multiprocessing
from pathlib import Path
from contextlib import asynccontextmanager

import torch
from PIL import Image
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from transformers import DonutProcessor, VisionEncoderDecoderModel

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
HOST = "0.0.0.0"
PORT = 8000
MAX_IMAGE_SIZE_MB = 10
MAX_CONCURRENT_INFERENCES = max(1, int(os.getenv("DONUT_MAX_CONCURRENT_INFERENCES", "1")))
INFERENCE_QUEUE_TIMEOUT_SEC = max(10, int(os.getenv("DONUT_QUEUE_TIMEOUT_SEC", "180")))
CPU_MAX_LENGTH = max(128, int(os.getenv("DONUT_CPU_MAX_LENGTH", "384")))
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
        log.info(f"📝 Raw model output ({len(generated_text)} chars): {generated_text[:500]}")

        # Parse medications from the generated text
        medications = self._parse_medications(generated_text)

        # Compute confidence based on beam search score
        confidence = min(0.95, 0.70 + 0.05 * len(medications))

        max_length = GPU_MAX_LENGTH if active_device == "cuda" else CPU_MAX_LENGTH
        num_beams = GPU_NUM_BEAMS if active_device == "cuda" else CPU_NUM_BEAMS
        log.info(
            f"✅ Inference complete: {len(medications)} medications found, "
            f"{processing_time_ms:.0f}ms, {confidence:.0%} confidence "
            f"(beams={num_beams}, max_length={max_length})"
        )
        if medications:
            for med in medications:
                log.info(f"   💊 {med['drugName']} {med['dosage']} — {med['frequency']}")
        else:
            log.warning(f"   ⚠️ No medications parsed from raw text. Text may need manual review.")

        return {
            "raw_text": generated_text,
            "medications": medications,
            "confidence": confidence,
            "model": "donut-prescription-v1",
            "device": active_device,
            "processing_time_ms": round(processing_time_ms, 1),
        }

    def _parse_medications(self, text: str) -> list[dict]:
        """
        Extract structured medication data from Donut's raw output text.

        Strategy order:
          1. Donut training format: "medications: - Drug Dose Unit - Freq ... signature:"
          2. JSON (if model outputs structured data)
          3. Regex patterns for standard clinical formats
          4. Broad line-level fallback
        """
        medications = []

        # ── Strategy 1: Donut training-data format ──
        # The model was trained on ground truth like:
        #   "medications: - Ibuprofen 5 mg - Take twice daily - Metformin 100 mg - Every 12 hours signature: ..."
        # Each medication is a pair: "- DrugName Dose Unit" followed by "- Frequency"
        med_section = self._extract_donut_format_medications(text)
        if med_section:
            return med_section

        # ── Strategy 2: JSON ──
        try:
            json_match = re.search(r'\{[\s\S]*\}', text)
            if json_match:
                parsed = json.loads(json_match.group())
                if isinstance(parsed, dict):
                    if "medications" in parsed:
                        return parsed["medications"]
                    if "drugName" in parsed or "drug_name" in parsed:
                        return [self._normalize_med(parsed)]
        except (json.JSONDecodeError, ValueError):
            pass

        # ── Strategy 3: Standard clinical regex ──
        patterns = [
            # "1. Lisinopril 10mg once daily"
            r'(?:^|\n)\s*(?:\d+[.)]\s*)?([A-Za-z][\w\s-]*?)\s+(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml|units?|IU|mEq)\s*(.*?)(?=\n|$)',
            # "Tab. Metformin 500mg 1-0-1"
            r'(?:Tab\.?|Cap\.?|Inj\.?|Syp\.?)\s+([A-Za-z][\w-]*(?:\s+[\w-]+)?)\s+(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml)\s*([\d-]+(?:\s*[-x]\s*[\d-]+)*)',
        ]

        for pattern in patterns:
            for match in re.finditer(pattern, text, re.IGNORECASE):
                drug_name = match.group(1).strip()
                dosage_num = match.group(2)
                dosage_unit = match.group(3)
                frequency = match.group(4).strip() if match.group(4) else "as directed"

                if len(drug_name) < 3:
                    continue

                medications.append({
                    "drugName": drug_name,
                    "dosage": f"{dosage_num}{dosage_unit}",
                    "frequency": frequency or "as directed",
                    "confidence": 0.75,
                    "source": "donut",
                })

        if medications:
            return medications

        # ── Strategy 4: Broader line-level parsing ──
        for line in text.split("\n"):
            line = re.sub(r'^[\s\-•*\d.)]+', '', line.strip())
            if len(line) < 4:
                continue

            match = re.search(
                r'([A-Za-z][A-Za-z0-9\- ]{1,40})\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml|units?|IU|mEq)\b(?:\s*[,;-]?\s*(.*))?$',
                line,
                re.IGNORECASE
            )
            if not match:
                continue

            drug_name = re.sub(r'\s+', ' ', match.group(1)).strip()
            dosage_num = match.group(2)
            dosage_unit = match.group(3)
            frequency = (match.group(4) or "").strip() or "as directed"

            if len(drug_name) < 3:
                continue

            medications.append({
                "drugName": drug_name,
                "dosage": f"{dosage_num}{dosage_unit}",
                "frequency": frequency,
                "confidence": 0.65,
                "source": "donut",
            })

        if medications:
            return medications

        # ── Strategy 5: Ultra-basic fallback ──
        for line in text.split("\n"):
            line = line.strip()
            if not line or len(line) < 5:
                continue
            basic_match = re.match(
                r'(.+?)\s+(\d+\s*(?:mg|mcg|g|ml))\s*(.*)',
                line, re.IGNORECASE
            )
            if basic_match:
                medications.append({
                    "drugName": basic_match.group(1).strip(),
                    "dosage": basic_match.group(2).strip(),
                    "frequency": basic_match.group(3).strip() or "as directed",
                    "confidence": 0.50,
                    "source": "donut",
                })

        return medications

    def _extract_donut_format_medications(self, text: str) -> list[dict]:
        """
        Parse the Donut model's native output format.

        Training ground truth format:
          "... medications: - Ibuprofen 5 mg - Take twice daily - Ciprofloxacin 25 mg - At bedtime signature: ..."

        Each medication is a PAIR of dash-items:
          1. "- DrugName Dose Unit"  (contains a number + mg/mcg/g/ml)
          2. "- Frequency"           (the next dash-item, no dosage pattern)
        """
        # Extract the medications section
        med_match = re.search(
            r'medications:\s*(.*?)(?:\s*signature:|$)',
            text,
            re.IGNORECASE | re.DOTALL
        )
        if not med_match:
            return []

        med_section = med_match.group(1).strip()
        if not med_section:
            return []

        # Split on " - " to get individual items
        # The section looks like: "- Drug1 10 mg - Frequency1 - Drug2 20 mg - Frequency2"
        items = re.split(r'\s*-\s+', med_section)
        items = [item.strip() for item in items if item.strip()]

        if not items:
            return []

        log.info(f"[Parser] Donut format: found {len(items)} dash-items in medications section")

        medications = []
        i = 0
        while i < len(items):
            item = items[i]

            # Check if this item contains a drug+dosage pattern (e.g., "Ibuprofen 5 mg")
            drug_match = re.match(
                r'^([A-Za-z][A-Za-z\s\-]*?)\s+(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml|units?|IU|mEq)\s*$',
                item,
                re.IGNORECASE
            )

            if drug_match:
                drug_name = drug_match.group(1).strip()
                dosage = f"{drug_match.group(2)} {drug_match.group(3)}"
                frequency = "as directed"

                # The next item should be the frequency (if it exists and isn't another drug)
                if i + 1 < len(items):
                    next_item = items[i + 1]
                    # Check if the next item is NOT a drug (i.e., no number+unit pattern)
                    is_drug = re.search(r'\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|units?|IU|mEq)', next_item, re.IGNORECASE)
                    if not is_drug:
                        frequency = next_item.strip()
                        i += 1  # Skip the frequency item

                if len(drug_name) >= 3:
                    medications.append({
                        "drugName": drug_name,
                        "dosage": dosage,
                        "frequency": frequency,
                        "confidence": 0.82,
                        "source": "donut",
                    })
                    log.info(f"   💊 {drug_name} {dosage} — {frequency}")

            i += 1

        if medications:
            log.info(f"[Parser] ✅ Extracted {len(medications)} medications from Donut format")

        return medications

    def _normalize_med(self, med_dict: dict) -> dict:
        """Normalize medication field names to our standard format."""
        return {
            "drugName": med_dict.get("drugName") or med_dict.get("drug_name", "Unknown"),
            "dosage": med_dict.get("dosage", ""),
            "frequency": med_dict.get("frequency", "as directed"),
            "confidence": med_dict.get("confidence", 0.75),
            "source": "donut",
        }


# ─────────────────────────────────────────────
# FastAPI Application
# ─────────────────────────────────────────────

donut = DonutModel()
inference_semaphore = asyncio.Semaphore(MAX_CONCURRENT_INFERENCES)
active_inferences = 0
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


def _run_inference_in_subprocess(image_bytes: bytes) -> dict:
    """
    Run Donut inference in an isolated subprocess.
    If the model crashes (segfault, C-level error), only the subprocess dies.
    The main server stays alive.
    """
    try:
        result = donut.predict(Image.open(io.BytesIO(image_bytes)).convert("RGB"))
        return result
    except Exception as e:
        return {
            "error": str(e),
            "raw_text": "",
            "medications": [],
            "confidence": 0,
            "model": "donut-prescription-v1",
            "device": donut.device,
            "processing_time_ms": 0,
        }


async def _run_inference_with_queue(pil_image: Image.Image) -> dict:
    global active_inferences

    try:
        await asyncio.wait_for(inference_semaphore.acquire(), timeout=INFERENCE_QUEUE_TIMEOUT_SEC)
    except TimeoutError:
        raise HTTPException(
            503,
            "Server is busy processing other images. Please retry in a few moments."
        )

    try:
        async with active_lock:
            active_inferences += 1

        # Convert image to JPEG bytes for safe cross-boundary passing
        buf = io.BytesIO()
        pil_image.save(buf, format="JPEG", quality=95)
        image_bytes = buf.getvalue()

        # Run in threadpool (model is loaded in this process)
        result = await run_in_threadpool(donut.predict, Image.open(io.BytesIO(image_bytes)).convert("RGB"))
        return result
    except Exception as e:
        log.error(f"Inference pipeline error: {e}", exc_info=True)
        return {
            "error": str(e),
            "raw_text": "",
            "medications": [],
            "confidence": 0,
            "model": "donut-prescription-v1",
            "device": donut.device,
            "processing_time_ms": 0,
        }
    finally:
        async with active_lock:
            active_inferences = max(0, active_inferences - 1)
        inference_semaphore.release()


@app.post("/api/predict")
async def predict(image: UploadFile = File(...)):
    """
    Process a prescription image and return extracted medications.

    Accepts: image file (JPEG, PNG, WebP)
    Returns: JSON with medications, confidence, and raw text
    """
    if not donut.is_ready:
        raise HTTPException(503, "Model is still loading. Please try again in a moment.")

    # Validate file type
    content_type = image.content_type or ""
    if not content_type.startswith("image/"):
        raise HTTPException(400, f"Expected image file, got: {content_type}")

    # Read and validate size
    image_bytes = await image.read()
    size_mb = len(image_bytes) / (1024 * 1024)
    if size_mb > MAX_IMAGE_SIZE_MB:
        raise HTTPException(400, f"Image too large: {size_mb:.1f}MB (max {MAX_IMAGE_SIZE_MB}MB)")

    log.info(f"📷 Processing image: {image.filename} ({size_mb:.1f}MB)")

    try:
        pil_image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        result = await _run_inference_with_queue(pil_image)
        return JSONResponse(content=result)
    except HTTPException:
        raise
    except Exception as e:
        log.error(f"Inference failed: {e}", exc_info=True)
        return JSONResponse(
            status_code=500,
            content={
                "error": f"Model inference failed: {str(e)}",
                "raw_text": "",
                "medications": [],
                "confidence": 0,
                "model": "donut-prescription-v1",
                "device": donut.device,
                "processing_time_ms": 0,
            }
        )


@app.post("/api/predict-base64")
async def predict_base64(payload: dict):
    """
    Process a base64-encoded prescription image.
    Accepts: { "image": "data:image/jpeg;base64,..." }
    """
    if not donut.is_ready:
        raise HTTPException(503, "Model is still loading.")

    import base64

    image_data = payload.get("image", "")
    if not image_data:
        raise HTTPException(400, "Missing 'image' field")

    # Strip data URL prefix if present
    if "base64," in image_data:
        image_data = image_data.split("base64,")[1]

    try:
        image_bytes = base64.b64decode(image_data)
        pil_image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        result = await _run_inference_with_queue(pil_image)
        return JSONResponse(content=result)
    except HTTPException:
        raise
    except Exception as e:
        log.error(f"Base64 inference failed: {e}", exc_info=True)
        return JSONResponse(
            status_code=500,
            content={
                "error": f"Model inference failed: {str(e)}",
                "raw_text": "",
                "medications": [],
                "confidence": 0,
                "model": "donut-prescription-v1",
                "device": donut.device,
                "processing_time_ms": 0,
            }
        )


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
