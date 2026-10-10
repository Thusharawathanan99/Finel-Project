"""
Donut Prescription OCR — Fine-Tuning Script

Fine-tune the Donut model on prescription data for improved accuracy.

Usage:
  # Fine-tune on the HuggingFace prescription dataset
  python train_donut.py

  # Fine-tune on your own exported dataset (from the app's DatasetCollector)
  python train_donut.py --custom-data ./my_prescriptions/

  # Resume training from a checkpoint
  python train_donut.py --resume ./checkpoints/epoch-5/

Requirements:
  pip install -r requirements.txt
"""

import os
import re
import json
import random
import argparse
import logging
from pathlib import Path
from training_safety import split_unique_samples, image_sample_id, optimizer_update_due, accumulation_group_size, optimizer_steps_per_epoch
from datetime import datetime

import torch
from PIL import Image
from torch.utils.data import Dataset, DataLoader
from transformers import (
    DonutProcessor,
    VisionEncoderDecoderModel,
    VisionEncoderDecoderConfig,
    get_scheduler,
)

# ─────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────

# Base model to fine-tune
BASE_MODEL = "naver-clova-ix/donut-base"

# Or start from the already-fine-tuned prescription model
PRETRAINED_MODEL = "chinmays18/medical-prescription-ocr"

# HuggingFace dataset for prescription images
HF_DATASET = "chinmays18/medical-prescription-dataset"

# Training hyperparameters
TRAIN_CONFIG = {
    "epochs": 30,
    "batch_size": 2,              # Increase if you have more GPU memory
    "learning_rate": 5e-5,
    "weight_decay": 0.01,
    "warmup_steps": 100,
    "max_length": 512,            # Max output sequence length
    "image_size": [720, 960],     # [height, width] — Donut default
    "gradient_accumulation_steps": 4,
    "save_every_n_epochs": 5,
    "eval_every_n_epochs": 2,
    "seed": 42,
}

try:
    BASE_DIR = Path(__file__).parent
except NameError:
    BASE_DIR = Path.cwd()

OUTPUT_DIR = BASE_DIR / "models" / "donut-prescription"
TRAINING_SPLIT_MANIFEST = None
CHECKPOINT_DIR = BASE_DIR / "checkpoints"
RESEARCH_DIR = BASE_DIR / "research"

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(message)s")
log = logging.getLogger("train")


# ─────────────────────────────────────────────
# Dataset Classes
# ─────────────────────────────────────────────

class PrescriptionDataset(Dataset):
    """
    Dataset for Donut fine-tuning on prescription images.

    Each sample:
      - Image: prescription photo
      - Ground truth: JSON string with medication details
    """

    def __init__(self, data_list, processor, max_length=512, split="train"):
        self.data = data_list
        self.processor = processor
        self.max_length = max_length
        self.split = split

    def __len__(self):
        return len(self.data)

    def __getitem__(self, idx):
        sample = self.data[idx]

        # Load and process image
        image = sample["image"]
        if isinstance(image, str):
            image = Image.open(image).convert("RGB")
        elif not isinstance(image, Image.Image):
            image = image.convert("RGB")

        pixel_values = self.processor(
            images=image, return_tensors="pt"
        ).pixel_values.squeeze(0)

        # Process ground truth text
        ground_truth = sample.get("ground_truth", sample.get("text", ""))
        if isinstance(ground_truth, dict):
            ground_truth = json.dumps(ground_truth)

        # Tokenize the target text
        target_encoding = self.processor.tokenizer(
            ground_truth,
            add_special_tokens=True,
            max_length=self.max_length,
            padding="max_length",
            truncation=True,
            return_tensors="pt",
        )

        labels = target_encoding.input_ids.squeeze(0)
        # Mask padding tokens for loss computation
        labels[labels == self.processor.tokenizer.pad_token_id] = -100

        return {
            "pixel_values": pixel_values,
            "labels": labels,
        }


class CustomPrescriptionDataset(Dataset):
    """
    Dataset for fine-tuning on your own collected data.
    Expects a directory with:
      - images/ — prescription images
      - annotations.json — exported from the app's DatasetCollector
    """

    def __init__(self, data_dir, processor, max_length=512):
        self.data_dir = Path(data_dir)
        self.processor = processor
        self.max_length = max_length
        self.samples = self._load_annotations()

    def _load_annotations(self):
        annotations_file = self.data_dir / "annotations.json"
        if not annotations_file.exists():
            log.warning(f"No annotations.json found in {self.data_dir}")
            return []

        with open(annotations_file) as f:
            data = json.load(f)

        samples = []
        annotations = data.get("annotations", data)
        if isinstance(annotations, list):
            for ann in annotations:
                image_path = self.data_dir / "images" / f"{ann.get('imageHash', ann.get('id', ''))}.jpg"
                if image_path.exists():
                    ground_truth = {
                        "medications": ann.get("medications", [])
                    }
                    samples.append({
                        "image_path": str(image_path),
                        "ground_truth": json.dumps(ground_truth),
                    })

        log.info(f"Loaded {len(samples)} custom annotations from {self.data_dir}")
        return samples

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        sample = self.samples[idx]
        image = Image.open(sample["image_path"]).convert("RGB")

        pixel_values = self.processor(
            images=image, return_tensors="pt"
        ).pixel_values.squeeze(0)

        target_encoding = self.processor.tokenizer(
            sample["ground_truth"],
            add_special_tokens=True,
            max_length=self.max_length,
            padding="max_length",
            truncation=True,
            return_tensors="pt",
        )

        labels = target_encoding.input_ids.squeeze(0)
        labels[labels == self.processor.tokenizer.pad_token_id] = -100

        return {
            "pixel_values": pixel_values,
            "labels": labels,
        }


# ─────────────────────────────────────────────
# Training Functions
# ─────────────────────────────────────────────

def load_hf_dataset(processor, train_split=0.9):
    """Download and prepare the HuggingFace prescription dataset."""
    from huggingface_hub import snapshot_download
    from PIL import Image
    import glob

    log.info(f"📥 Downloading dataset repository: {HF_DATASET}")
    repo_path = snapshot_download(repo_id=HF_DATASET, repo_type="dataset")

    # Load raw files directly to bypass deprecated `trust_remote_code` mechanics
    data_list = []
    train_images_dir = os.path.join(repo_path, "train", "images")
    train_ann_dir = os.path.join(repo_path, "train", "annotations")

    for img_path in glob.glob(os.path.join(train_images_dir, "*.png")):
        base_name = os.path.splitext(os.path.basename(img_path))[0]
        json_path = os.path.join(train_ann_dir, f"{base_name}.json")
        
        if os.path.exists(json_path):
            with open(json_path, 'r', encoding='utf-8') as f:
                ann = json.load(f)
            
            data_list.append({
                "image": Image.open(img_path).convert("RGB"),
                "ground_truth": ann.get("ground_truth", "")
            })

    log.info(f"   Total samples: {len(data_list)}")

    global TRAINING_SPLIT_MANIFEST
    train_data, val_data, TRAINING_SPLIT_MANIFEST = split_unique_samples(data_list, train_split)
    log.info(f"   Train: {len(train_data)}, Val: {len(val_data)}")

    train_dataset = PrescriptionDataset(train_data, processor, split="train")
    val_dataset = PrescriptionDataset(val_data, processor, split="val")

    return train_dataset, val_dataset


def train(args):
    """Main training loop."""
    # Set seed for reproducibility
    torch.manual_seed(TRAIN_CONFIG["seed"])
    random.seed(TRAIN_CONFIG["seed"])

    # Determine device & VRAM
    device = "cuda" if torch.cuda.is_available() else "cpu"
    use_fp16 = False
    use_grad_checkpoint = False

    if device == "cuda":
        gpu_name = torch.cuda.get_device_name(0)
        vram_gb = torch.cuda.get_device_properties(0).total_memory / (1024**3)
        log.info(f"🖥️  GPU: {gpu_name} ({vram_gb:.1f} GB VRAM)")

        # Auto-optimize for low-VRAM GPUs (RTX 3050 = 4GB or 8GB)
        if vram_gb < 6 or args.low_vram:
            log.info("⚡ Low-VRAM mode: FP16 + gradient checkpointing + batch=1")
            use_fp16 = True
            use_grad_checkpoint = True
            TRAIN_CONFIG["batch_size"] = 1
            TRAIN_CONFIG["gradient_accumulation_steps"] = 8  # Simulate batch=8
        elif vram_gb < 10:
            log.info("⚡ Mid-VRAM mode: FP16 enabled")
            use_fp16 = True
            TRAIN_CONFIG["batch_size"] = min(TRAIN_CONFIG["batch_size"], 2)
        else:
            log.info("🚀 High-VRAM mode: Full precision")
    else:
        log.info(f"🖥️  Device: CPU (no GPU — training will be slow)")

    # Load model and processor
    if args.resume:
        model_source = args.resume
        log.info(f"📂 Resuming from checkpoint: {model_source}")
    elif args.from_pretrained:
        model_source = PRETRAINED_MODEL
        log.info(f"📂 Fine-tuning from pre-trained: {model_source}")
    else:
        model_source = BASE_MODEL
        log.info(f"📂 Training from base model: {model_source}")

    processor = DonutProcessor.from_pretrained(model_source)
    model = VisionEncoderDecoderModel.from_pretrained(model_source)

    # Enable gradient checkpointing to save VRAM (trades compute for memory)
    if use_grad_checkpoint:
        model.encoder.gradient_checkpointing_enable()
        if hasattr(model.decoder, 'gradient_checkpointing_enable'):
            model.decoder.gradient_checkpointing_enable()
        log.info("   ✅ Gradient checkpointing enabled (saves ~40% VRAM)")

    model.to(device)

    param_count = sum(p.numel() for p in model.parameters())
    log.info(f"   Parameters: {param_count:,}")
    if device == "cuda":
        vram_used = torch.cuda.memory_allocated() / (1024**3)
        log.info(f"   VRAM used (model only): {vram_used:.2f} GB")

    # Load dataset
    if args.custom_data:
        log.info(f"📂 Loading custom dataset from: {args.custom_data}")
        full_dataset = CustomPrescriptionDataset(args.custom_data, processor)
        # Split 90/10
        global TRAINING_SPLIT_MANIFEST
        train_samples, heldout_samples, TRAINING_SPLIT_MANIFEST = split_unique_samples(full_dataset.samples)
        train_dataset = CustomPrescriptionDataset(args.custom_data, processor)
        val_dataset = CustomPrescriptionDataset(args.custom_data, processor)
        train_dataset.samples = train_samples
        val_dataset.samples = heldout_samples

    else:
        train_dataset, val_dataset = load_hf_dataset(processor)

    train_loader = DataLoader(
        train_dataset,
        batch_size=TRAIN_CONFIG["batch_size"],
        shuffle=True,
        num_workers=0,  # Windows compatibility
        pin_memory=True if device == "cuda" else False,
    )

    val_loader = DataLoader(
        val_dataset,
        batch_size=TRAIN_CONFIG["batch_size"],
        shuffle=False,
        num_workers=0,
    )

    # Optimizer and scheduler
    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=TRAIN_CONFIG["learning_rate"],
        weight_decay=TRAIN_CONFIG["weight_decay"],
    )

    total_steps = optimizer_steps_per_epoch(len(train_loader), TRAIN_CONFIG["gradient_accumulation_steps"]) * TRAIN_CONFIG["epochs"]
    scheduler = get_scheduler(
        "cosine",
        optimizer=optimizer,
        num_warmup_steps=TRAIN_CONFIG["warmup_steps"],
        num_training_steps=total_steps,
    )

    # Mixed precision scaler for FP16
    scaler = torch.amp.GradScaler('cuda') if use_fp16 else None

    # Training loop
    log.info("=" * 60)
    log.info("🏋️ Starting Training")
    log.info(f"   Epochs: {TRAIN_CONFIG['epochs']}")
    log.info(f"   Batch size: {TRAIN_CONFIG['batch_size']}")
    log.info(f"   Grad accumulation: {TRAIN_CONFIG['gradient_accumulation_steps']} (effective batch = {TRAIN_CONFIG['batch_size'] * TRAIN_CONFIG['gradient_accumulation_steps']})")
    log.info(f"   Total steps: {total_steps}")
    log.info(f"   Learning rate: {TRAIN_CONFIG['learning_rate']}")
    log.info(f"   FP16: {use_fp16}")
    log.info(f"   Gradient checkpointing: {use_grad_checkpoint}")
    log.info("=" * 60)

    best_val_loss = float("inf")
    grad_accum_steps = TRAIN_CONFIG["gradient_accumulation_steps"]

    # ── Research: Training History ──
    RESEARCH_DIR.mkdir(parents=True, exist_ok=True)
    training_history = []

    for epoch in range(1, TRAIN_CONFIG["epochs"] + 1):
        model.train()
        optimizer.zero_grad()
        epoch_loss = 0
        step_count = 0

        from tqdm.auto import tqdm
        pbar = tqdm(train_loader, desc=f"Epoch {epoch:2d}/{TRAIN_CONFIG['epochs']}", leave=False)
        for batch_idx, batch in enumerate(pbar):
            pixel_values = batch["pixel_values"].to(device)
            labels = batch["labels"].to(device)

            # Forward pass — with FP16 autocasting if enabled
            if use_fp16:
                with torch.amp.autocast('cuda'):
                    outputs = model(pixel_values=pixel_values, labels=labels)
                    loss = outputs.loss / accumulation_group_size(batch_idx, len(train_loader), grad_accum_steps)
                scaler.scale(loss).backward()
            else:
                outputs = model(pixel_values=pixel_values, labels=labels)
                loss = outputs.loss / accumulation_group_size(batch_idx, len(train_loader), grad_accum_steps)
                loss.backward()

            if optimizer_update_due(batch_idx, len(train_loader), grad_accum_steps):
                if use_fp16:
                    scaler.unscale_(optimizer)
                    torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                    scaler.step(optimizer)
                    scaler.update()
                else:
                    torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                    optimizer.step()
                scheduler.step()
                optimizer.zero_grad()

            epoch_loss += outputs.loss.item()
            step_count += 1

            if (batch_idx + 1) % 10 == 0:
                avg_loss = epoch_loss / step_count
                vram_info = ""
                if device == "cuda":
                    vram_mb = torch.cuda.memory_allocated() / (1024**2)
                    vram_info = f" | VRAM: {vram_mb:.0f}MB"
                log.info(
                    f"  Epoch {epoch}/{TRAIN_CONFIG['epochs']} | "
                    f"Step {batch_idx + 1}/{len(train_loader)} | "
                    f"Loss: {avg_loss:.4f} | "
                    f"LR: {scheduler.get_last_lr()[0]:.2e}{vram_info}"
                )

        avg_train_loss = epoch_loss / max(step_count, 1)
        current_lr = scheduler.get_last_lr()[0]
        log.info(f"📊 Epoch {epoch} — Train Loss: {avg_train_loss:.4f}")

        # Validation
        val_loss = None
        if epoch % TRAIN_CONFIG["eval_every_n_epochs"] == 0:
            val_loss = evaluate(model, val_loader, device)
            log.info(f"📊 Epoch {epoch} — Val Loss: {val_loss:.4f}")

            if val_loss < best_val_loss:
                best_val_loss = val_loss
                log.info(f"   🏆 New best val loss! Saving best model...")
                save_model(model, processor, OUTPUT_DIR / "best")

        # ── Research: Record epoch metrics ──
        epoch_record = {
            "epoch": epoch,
            "train_loss": round(avg_train_loss, 6),
            "val_loss": round(val_loss, 6) if val_loss is not None else None,
            "learning_rate": current_lr,
            "best_val_loss": round(best_val_loss, 6),
        }
        training_history.append(epoch_record)

        # Save checkpoint
        if epoch % TRAIN_CONFIG["save_every_n_epochs"] == 0:
            checkpoint_path = CHECKPOINT_DIR / f"epoch-{epoch}"
            save_model(model, processor, checkpoint_path)

    # Save final model
    save_model(model, processor, OUTPUT_DIR)

    # ── Research: Export training history ──
    history_data = {
        "training_completed_at": datetime.now().isoformat(),
        "model_source": model_source,
        "dataset": HF_DATASET if not args.custom_data else args.custom_data,
        "device": device,
        "parameters": param_count,
        "hyperparameters": TRAIN_CONFIG,
        "train_samples": len(train_dataset),
        "val_samples": len(val_dataset),
        "best_val_loss": round(best_val_loss, 6),
        "final_train_loss": round(avg_train_loss, 6),
        "history": training_history,
    }

    history_json_path = RESEARCH_DIR / "training_history.json"
    with open(history_json_path, "w") as f:
        json.dump(history_data, f, indent=2)
    log.info(f"📄 Training history saved: {history_json_path}")

    # Export CSV for plotting loss curves
    history_csv_path = RESEARCH_DIR / "training_loss_curve.csv"
    with open(history_csv_path, "w") as f:
        f.write("epoch,train_loss,val_loss,learning_rate\n")
        for h in training_history:
            val = h["val_loss"] if h["val_loss"] is not None else ""
            f.write(f"{h['epoch']},{h['train_loss']},{val},{h['learning_rate']}\n")
    log.info(f"📄 Loss curve CSV saved: {history_csv_path}")

    # Export markdown training summary for research paper
    summary_md_path = RESEARCH_DIR / "training_summary.md"
    with open(summary_md_path, "w") as f:
        f.write("# Training Summary\n\n")
        f.write(f"**Model**: `{model_source}`  \n")
        f.write(f"**Dataset**: `{HF_DATASET if not args.custom_data else args.custom_data}`  \n")
        f.write(f"**Device**: {device}  \n")
        f.write(f"**Parameters**: {param_count:,}  \n\n")
        f.write("## Hyperparameters\n\n")
        f.write("| Parameter | Value |\n|---|---|\n")
        for k, v in TRAIN_CONFIG.items():
            f.write(f"| {k} | {v} |\n")
        f.write(f"\n## Results\n\n")
        f.write(f"| Metric | Value |\n|---|---|\n")
        f.write(f"| Training Samples | {len(train_dataset)} |\n")
        f.write(f"| Validation Samples | {len(val_dataset)} |\n")
        f.write(f"| Final Train Loss | {avg_train_loss:.4f} |\n")
        f.write(f"| Best Val Loss | {best_val_loss:.4f} |\n")
        f.write(f"| Total Epochs | {TRAIN_CONFIG['epochs']} |\n")
        f.write(f"\n## Loss Curve Data\n\n")
        f.write("| Epoch | Train Loss | Val Loss |\n|---|---|---|\n")
        for h in training_history:
            val = f"{h['val_loss']:.4f}" if h["val_loss"] is not None else "—"
            f.write(f"| {h['epoch']} | {h['train_loss']:.4f} | {val} |\n")
    log.info(f"📄 Training summary saved: {summary_md_path}")

    log.info("=" * 60)
    log.info("✅ Training complete!")
    log.info(f"   Best val loss: {best_val_loss:.4f}")
    log.info(f"   Model saved to: {OUTPUT_DIR}")
    log.info(f"   Research files saved to: {RESEARCH_DIR}")
    log.info("=" * 60)


def evaluate(model, val_loader, device):
    """Run evaluation and return average loss."""
    model.eval()
    total_loss = 0
    count = 0

    with torch.no_grad():
        for batch in val_loader:
            pixel_values = batch["pixel_values"].to(device)
            labels = batch["labels"].to(device)

            outputs = model(pixel_values=pixel_values, labels=labels)
            total_loss += outputs.loss.item()
            count += 1

    model.train()
    return total_loss / max(count, 1)


def save_model(model, processor, output_path):
    """Save model and processor to disk."""
    output_path = Path(output_path)
    output_path.mkdir(parents=True, exist_ok=True)
    if TRAINING_SPLIT_MANIFEST is not None:
        (output_path / "training_split.json").write_text(json.dumps(TRAINING_SPLIT_MANIFEST, indent=2), encoding="utf-8")
    model.save_pretrained(str(output_path))
    processor.save_pretrained(str(output_path))
    log.info(f"   💾 Model saved to: {output_path}")


# ─────────────────────────────────────────────
# Entry Point
# ─────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fine-tune Donut for prescription OCR")
    parser.add_argument(
        "--custom-data",
        type=str,
        default=None,
        help="Path to custom prescription dataset directory (images/ + annotations.json)",
    )
    parser.add_argument(
        "--resume",
        type=str,
        default=None,
        help="Resume from a checkpoint directory",
    )
    parser.add_argument(
        "--from-pretrained",
        action="store_true",
        default=True,
        help="Start from the pre-fine-tuned prescription model (default: True)",
    )
    parser.add_argument(
        "--from-base",
        action="store_true",
        help="Start from the base Donut model (donut-base) instead of pre-trained",
    )
    parser.add_argument(
        "--epochs",
        type=int,
        default=TRAIN_CONFIG["epochs"],
        help=f"Number of epochs (default: {TRAIN_CONFIG['epochs']})",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=TRAIN_CONFIG["batch_size"],
        help=f"Batch size (default: {TRAIN_CONFIG['batch_size']})",
    )
    parser.add_argument(
        "--lr",
        type=float,
        default=TRAIN_CONFIG["learning_rate"],
        help=f"Learning rate (default: {TRAIN_CONFIG['learning_rate']})",
    )
    parser.add_argument(
        "--low-vram",
        action="store_true",
        help="Force low-VRAM optimizations (FP16 + gradient checkpointing + batch=1). Auto-detected for GPUs with <6GB VRAM.",
    )
    parser.add_argument(
        "--save-to-drive",
        type=str,
        default=None,
        help="Google Colab: save model to Google Drive path (e.g., /content/drive/MyDrive/models/)",
    )

    args = parser.parse_args()

    if args.from_base:
        args.from_pretrained = False
    if args.epochs:
        TRAIN_CONFIG["epochs"] = args.epochs
    if args.batch_size:
        TRAIN_CONFIG["batch_size"] = args.batch_size
    if args.lr:
        TRAIN_CONFIG["learning_rate"] = args.lr

    train(args)

    # If running on Colab, copy model to Google Drive
    if args.save_to_drive:
        import shutil
        drive_path = Path(args.save_to_drive)
        drive_path.mkdir(parents=True, exist_ok=True)
        log.info(f"📁 Copying model to Google Drive: {drive_path}")
        shutil.copytree(str(OUTPUT_DIR), str(drive_path / "donut-prescription"), dirs_exist_ok=True)
        shutil.copytree(str(RESEARCH_DIR), str(drive_path / "research"), dirs_exist_ok=True)
        log.info("✅ Saved to Google Drive!")
