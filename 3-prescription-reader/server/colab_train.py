# ============================================================
# 🏥 Donut Prescription OCR — Google Colab Training Notebook
# ============================================================
#
# Copy each CELL section into a separate Colab cell.
# Set runtime: Runtime → Change runtime type → T4 GPU
#
# Output: Trained model + graphs saved to Google Drive
# ============================================================


# ============================================================
# CELL 1: Install Dependencies
# ============================================================
# Paste this into your FIRST Colab cell:
#
# !pip install -q torch torchvision transformers datasets sentencepiece Pillow matplotlib


# ============================================================
# CELL 2: Mount Google Drive
# ============================================================
# Paste this into your SECOND cell:
#
# from google.colab import drive
# drive.mount('/content/drive')


# ============================================================
# CELL 3: Check GPU & Setup
# ============================================================

import torch
import os
import json
import random
import time
import re
from pathlib import Path
from datetime import datetime

print(f"PyTorch: {torch.__version__}")
print(f"CUDA available: {torch.cuda.is_available()}")

if torch.cuda.is_available():
    print(f"GPU: {torch.cuda.get_device_name(0)}")
    # Compatible with all PyTorch versions
    vram_bytes = torch.cuda.get_device_properties(0).total_memory
    vram_gb = vram_bytes / (1024**3)
    print(f"VRAM: {vram_gb:.1f} GB")
else:
    print("⚠️ No GPU! Go to Runtime → Change runtime type → T4 GPU")
    vram_gb = 0

# Google Drive save path
DRIVE_SAVE_PATH = "/content/drive/MyDrive/prescription_ocr_model"
os.makedirs(DRIVE_SAVE_PATH, exist_ok=True)
print(f"\n📁 Model will be saved to: {DRIVE_SAVE_PATH}")


# ============================================================
# CELL 4: Download & Explore Dataset
# ============================================================

from huggingface_hub import snapshot_download
from PIL import Image
import matplotlib.pyplot as plt
import matplotlib
import glob

matplotlib.rcParams.update({'font.size': 11, 'figure.dpi': 120})

DATASET_NAME = "chinmays18/medical-prescription-dataset"
print(f"📥 Downloading dataset: {DATASET_NAME}")
repo_path = snapshot_download(repo_id=DATASET_NAME, repo_type="dataset")

# Load raw files directly to bypass deprecated `trust_remote_code` mechanics
data = []
train_images_dir = os.path.join(repo_path, "train", "images")
train_ann_dir = os.path.join(repo_path, "train", "annotations")

for img_path in glob.glob(os.path.join(train_images_dir, "*.png")):
    base_name = os.path.splitext(os.path.basename(img_path))[0]
    json_path = os.path.join(train_ann_dir, f"{base_name}.json")
    
    if os.path.exists(json_path):
        with open(json_path, 'r', encoding='utf-8') as f:
            ann = json.load(f)
        
        data.append({
            "image": Image.open(img_path).convert("RGB"),
            "ground_truth": ann.get("ground_truth", "")
        })

print(f"✅ Total samples: {len(data)}")
print(f"Keys: {list(data[0].keys()) if data else []}")

# --- Dataset Statistics ---
annotation_lengths = []
for i in range(len(data)):
    gt = data[i].get("ground_truth", data[i].get("text", ""))
    if gt:
        annotation_lengths.append(len(str(gt)))

print(f"\n📊 Dataset Statistics:")
print(f"   Samples: {len(data)}")
print(f"   Avg annotation length: {sum(annotation_lengths)/len(annotation_lengths):.0f} chars")
print(f"   Min/Max: {min(annotation_lengths)}/{max(annotation_lengths)} chars")

# --- Show sample images ---
fig, axes = plt.subplots(2, 4, figsize=(16, 8))
for i, ax in enumerate(axes.flat):
    idx = random.randint(0, len(data)-1)
    img = data[idx].get("image")
    if img:
        ax.imshow(img)
        ax.set_title(f"Sample {idx}", fontsize=10)
    ax.axis("off")
plt.suptitle(f"Dataset: {DATASET_NAME} ({len(data)} prescription images)", fontsize=14, fontweight='bold')
plt.tight_layout()
plt.savefig(f"{DRIVE_SAVE_PATH}/01_dataset_samples.png", dpi=150, bbox_inches='tight')
plt.show()
print(f"📸 Saved to Drive: 01_dataset_samples.png")

# --- Annotation length distribution ---
fig, ax = plt.subplots(figsize=(10, 4))
ax.hist(annotation_lengths, bins=30, color='#8B5CF6', edgecolor='white', alpha=0.85)
ax.set_xlabel('Annotation Length (characters)')
ax.set_ylabel('Frequency')
ax.set_title('Dataset — Annotation Length Distribution')
ax.grid(True, alpha=0.3)
plt.tight_layout()
plt.savefig(f"{DRIVE_SAVE_PATH}/02_annotation_distribution.png", dpi=150, bbox_inches='tight')
plt.show()
print(f"📸 Saved to Drive: 02_annotation_distribution.png")


# ============================================================
# CELL 5: Prepare Dataset for Training
# ============================================================

from torch.utils.data import Dataset, DataLoader
from transformers import DonutProcessor

# Start from the pre-trained prescription model (faster convergence)
MODEL_SOURCE = "chinmays18/medical-prescription-ocr"
print(f"📂 Loading processor from: {MODEL_SOURCE}")
processor = DonutProcessor.from_pretrained(MODEL_SOURCE)


class PrescriptionDataset(Dataset):
    def __init__(self, data_list, processor, max_length=512):
        self.data = data_list
        self.processor = processor
        self.max_length = max_length

    def __len__(self):
        return len(self.data)

    def __getitem__(self, idx):
        sample = self.data[idx]
        image = sample["image"]
        if not isinstance(image, Image.Image):
            image = Image.open(image)
        image = image.convert("RGB")

        pixel_values = self.processor(images=image, return_tensors="pt").pixel_values.squeeze(0)

        ground_truth = sample.get("ground_truth", sample.get("text", ""))
        if isinstance(ground_truth, dict):
            ground_truth = json.dumps(ground_truth)

        target = self.processor.tokenizer(
            ground_truth, add_special_tokens=True,
            max_length=self.max_length, padding="max_length",
            truncation=True, return_tensors="pt",
        )
        labels = target.input_ids.squeeze(0)
        labels[labels == self.processor.tokenizer.pad_token_id] = -100

        return {"pixel_values": pixel_values, "labels": labels}


"""Deterministic, image-disjoint research splits and optimizer-step arithmetic."""
import hashlib
import json
import random
from PIL import Image

def image_sample_id(image):
    if isinstance(image, (str, bytes)):
        with Image.open(image) as source:
            rgb = source.convert("RGB")
    else:
        rgb = image.convert("RGB")
    return hashlib.sha256(str(rgb.size).encode("ascii") + rgb.tobytes()).hexdigest()

def sample_image(sample):
    return sample.get("image", sample.get("image_path"))

def split_unique_samples(samples, train_ratio=0.9, seed=42):
    unique = {}
    for sample in samples:
        key = image_sample_id(sample_image(sample))
        if key in unique:
            if unique[key].get("ground_truth") != sample.get("ground_truth"):
                raise ValueError("Duplicate image has conflicting ground truth.")
            continue
        unique[key] = sample
    values = list(unique.items())
    if len(values) < 2:
        raise ValueError("Training requires at least two distinct images for a held-out split.")
    random.Random(seed).shuffle(values)
    split = max(1, min(len(values) - 1, int(len(values) * train_ratio)))
    train, heldout = values[:split], values[split:]
    manifest = {"version": 1, "seed": seed, "split": "held-out-validation", "train_ids": [key for key, _ in train], "held_out_ids": [key for key, _ in heldout]}
    return [sample for _, sample in train], [sample for _, sample in heldout], manifest

def optimizer_update_due(batch_index, total_batches, accumulation_steps):
    if total_batches < 1 or accumulation_steps < 1 or not 0 <= batch_index < total_batches:
        raise ValueError("Invalid accumulation configuration.")
    return (batch_index + 1) % accumulation_steps == 0 or batch_index + 1 == total_batches

def accumulation_group_size(batch_index, total_batches, accumulation_steps):
    return min(accumulation_steps, total_batches - (batch_index // accumulation_steps) * accumulation_steps)

def optimizer_steps_per_epoch(total_batches, accumulation_steps):
    if total_batches < 1 or accumulation_steps < 1:
        raise ValueError("Training loader and accumulation steps must be positive.")
    return (total_batches + accumulation_steps - 1) // accumulation_steps

def select_held_out_indices(data, manifest):
    train_ids = set(manifest.get("train_ids", []))
    heldout_ids = set(manifest.get("held_out_ids", []))
    if not train_ids or not heldout_ids or train_ids & heldout_ids:
        raise ValueError("Manifest needs nonempty, disjoint training and held-out image IDs.")
    indices, seen = [], set()
    for index in range(len(data)):
        key = image_sample_id(data[index]["image"])
        if key in heldout_ids and key not in seen:
            seen.add(key)
            indices.append(index)
    if not indices:
        raise ValueError("No held-out images from the training manifest exist in this evaluation dataset.")
    return indices


# Build train/val splits
data_list = []
for i in range(len(data)):
    data_list.append({
        "image": data[i]["image"],
        "ground_truth": data[i].get("ground_truth", data[i].get("text", "")),
    })

train_data, val_data, split_manifest = split_unique_samples(data_list)

train_dataset = PrescriptionDataset(train_data, processor)
val_dataset = PrescriptionDataset(val_data, processor)

print(f"✅ Train: {len(train_dataset)} samples")
print(f"✅ Val:   {len(val_dataset)} samples")


# ============================================================
# CELL 6: Train the Model (with accuracy tracking)
# ============================================================

from transformers import VisionEncoderDecoderModel, get_scheduler

# ── Hyperparameters ──
EPOCHS = 30
BATCH_SIZE = 1      # Reduced to 1 to prevent CUDA Out of Memory on T4 GPUs
LR = 5e-5
GRAD_ACCUM = 8      # Increased to 8 to maintain effective batch size of 8
EVAL_EVERY = 2
SAVE_EVERY = 10
WARMUP_STEPS = 100

device = "cuda" if torch.cuda.is_available() else "cpu"

# Load model
print(f"📂 Loading model: {MODEL_SOURCE}")
model = VisionEncoderDecoderModel.from_pretrained(MODEL_SOURCE)

# Enable gradient checkpointing to save ~40% VRAM (trades compute for memory)
model.encoder.gradient_checkpointing_enable()
if hasattr(model.decoder, 'gradient_checkpointing_enable'):
    model.decoder.gradient_checkpointing_enable()
print("   ✅ Gradient checkpointing enabled (VRAM savings)")

model.to(device)
model.train()

param_count = sum(p.numel() for p in model.parameters())
vram_used = torch.cuda.memory_allocated() / (1024**3) if torch.cuda.is_available() else 0
print(f"   Parameters: {param_count:,}")
print(f"   VRAM (model loaded): {vram_used:.2f} GB")

# Data loaders
train_loader = DataLoader(train_dataset, batch_size=BATCH_SIZE, shuffle=True, num_workers=2, pin_memory=True)
val_loader = DataLoader(val_dataset, batch_size=BATCH_SIZE, shuffle=False, num_workers=2)

# Optimizer + scheduler
optimizer = torch.optim.AdamW(model.parameters(), lr=LR, weight_decay=0.01)
total_steps = optimizer_steps_per_epoch(len(train_loader), GRAD_ACCUM) * EPOCHS
scheduler = get_scheduler("cosine", optimizer, num_warmup_steps=WARMUP_STEPS, num_training_steps=total_steps)
scaler = torch.amp.GradScaler('cuda')


def compute_token_accuracy(model, dataloader, device, max_batches=20):
    """
    Compute token-level accuracy on a dataset.
    This measures how many tokens the model predicts correctly.
    """
    model.eval()
    correct_tokens = 0
    total_tokens = 0

    with torch.no_grad():
        for i, batch in enumerate(dataloader):
            if i >= max_batches:
                break

            pixel_values = batch["pixel_values"].to(device)
            labels = batch["labels"].to(device)

            with torch.amp.autocast('cuda'):
                outputs = model(pixel_values=pixel_values, labels=labels)

            logits = outputs.logits
            predictions = logits.argmax(dim=-1)

            # Only count non-padding tokens
            mask = labels != -100
            correct_tokens += ((predictions == labels) & mask).sum().item()
            total_tokens += mask.sum().item()

    model.train()
    optimizer.zero_grad()
    accuracy = correct_tokens / max(total_tokens, 1)
    return accuracy


def compute_cer(pred_text, ref_text):
    """Character Error Rate."""
    pred = pred_text.lower().strip()
    ref = ref_text.lower().strip()
    if not ref:
        return 0.0 if not pred else 1.0

    m, n = len(pred), len(ref)
    dp = [[0]*(n+1) for _ in range(m+1)]
    for i in range(m+1): dp[i][0] = i
    for j in range(n+1): dp[0][j] = j
    for i in range(1, m+1):
        for j in range(1, n+1):
            cost = 0 if pred[i-1] == ref[j-1] else 1
            dp[i][j] = min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+cost)
    return dp[m][n] / max(n, 1)


def evaluate_cer_sample(model, processor, dataset, device, num_samples=10):
    """Run inference on a few samples and compute average CER."""
    model.eval()
    total_cer = 0
    count = 0

    indices = random.sample(range(len(dataset.data)), min(num_samples, len(dataset.data)))

    for idx in indices:
        sample = dataset.data[idx]
        image = sample["image"]
        if not isinstance(image, Image.Image):
            continue
        image = image.convert("RGB")
        gt = sample.get("ground_truth", sample.get("text", ""))

        pixel_values = processor(images=image, return_tensors="pt").pixel_values.to(device)

        task_prompt = "<s_ocr>"
        decoder_ids = processor.tokenizer(task_prompt, add_special_tokens=False, return_tensors="pt").input_ids.to(device)

        with torch.no_grad():
            with torch.amp.autocast('cuda'):
                generated = model.generate(
                    pixel_values, decoder_input_ids=decoder_ids,
                    max_length=512, num_beams=1, early_stopping=True,
                    pad_token_id=processor.tokenizer.pad_token_id,
                    eos_token_id=processor.tokenizer.eos_token_id,
                )

        predicted = processor.batch_decode(generated, skip_special_tokens=True)[0]
        cer = compute_cer(predicted, gt)
        total_cer += cer
        count += 1

    model.train()
    optimizer.zero_grad()
    return total_cer / max(count, 1)


# ── Training History ──
history = {
    "train_loss": [],
    "val_loss": [],
    "token_accuracy": [],
    "cer": [],
    "learning_rate": [],
    "epoch_time": [],
    "vram_peak_mb": [],
}

best_val_loss = float("inf")
best_accuracy = 0.0

print(f"\n{'='*70}")
print(f"  🏋️ TRAINING — {EPOCHS} epochs, batch={BATCH_SIZE}, lr={LR}")
print(f"  Effective batch: {BATCH_SIZE * GRAD_ACCUM}")
print(f"  Steps/epoch: {len(train_loader)}, Total steps: {total_steps}")
print(f"{'='*70}\n")

training_start = time.time()

for epoch in range(1, EPOCHS + 1):
    epoch_start = time.time()
    model.train()
    optimizer.zero_grad()
    epoch_loss = 0
    steps = 0

    from tqdm.auto import tqdm
    pbar = tqdm(train_loader, desc=f"Epoch {epoch:2d}/{EPOCHS}", leave=False)
    for batch_idx, batch in enumerate(pbar):
        pixel_values = batch["pixel_values"].to(device)
        labels = batch["labels"].to(device)

        with torch.amp.autocast('cuda'):
            outputs = model(pixel_values=pixel_values, labels=labels)
            loss = outputs.loss / accumulation_group_size(batch_idx, len(train_loader), GRAD_ACCUM)

        scaler.scale(loss).backward()

        if optimizer_update_due(batch_idx, len(train_loader), GRAD_ACCUM):
            scaler.unscale_(optimizer)
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            scaler.step(optimizer)
            scaler.update()
            scheduler.step()
            optimizer.zero_grad()

        epoch_loss += outputs.loss.item()
        steps += 1
        pbar.set_postfix(loss=(epoch_loss / max(steps, 1)))

    avg_train_loss = epoch_loss / max(steps, 1)
    current_lr = scheduler.get_last_lr()[0]
    epoch_time = time.time() - epoch_start
    vram_peak = torch.cuda.max_memory_allocated() / (1024**2) if torch.cuda.is_available() else 0

    # Record basic metrics every epoch
    history["train_loss"].append(avg_train_loss)
    history["learning_rate"].append(current_lr)
    history["epoch_time"].append(epoch_time)
    history["vram_peak_mb"].append(vram_peak)

    # ── Validation + Accuracy (every EVAL_EVERY epochs) ──
    val_loss = None
    token_acc = None
    cer_score = None

    if epoch % EVAL_EVERY == 0 or epoch == EPOCHS:
        # Validation loss
        model.eval()
        val_total = 0
        val_count = 0
        with torch.no_grad():
            for batch in val_loader:
                pv = batch["pixel_values"].to(device)
                lb = batch["labels"].to(device)
                with torch.amp.autocast('cuda'):
                    out = model(pixel_values=pv, labels=lb)
                val_total += out.loss.item()
                val_count += 1
        val_loss = val_total / max(val_count, 1)

        # Token accuracy
        token_acc = compute_token_accuracy(model, val_loader, device, max_batches=20)

        # CER on sample predictions
        cer_score = evaluate_cer_sample(model, processor, val_dataset, device, num_samples=8)

        # Save best model
        if val_loss < best_val_loss:
            best_val_loss = val_loss
            best_accuracy = token_acc
            model.save_pretrained("/content/best_model")
            processor.save_pretrained("/content/best_model")
            Path("/content/best_model").joinpath("training_split.json").write_text(json.dumps(split_manifest, indent=2), encoding="utf-8")
            marker = " 🏆 BEST"
        else:
            marker = ""

        model.train()
    else:
        marker = ""

    history["val_loss"].append(val_loss)
    history["token_accuracy"].append(token_acc)
    history["cer"].append(cer_score)

    # ── Print progress ──
    val_str = f" | Val: {val_loss:.4f}" if val_loss is not None else ""
    acc_str = f" | Acc: {token_acc:.1%}" if token_acc is not None else ""
    cer_str = f" | CER: {cer_score:.3f}" if cer_score is not None else ""
    print(
        f"  Epoch {epoch:2d}/{EPOCHS} | "
        f"Train: {avg_train_loss:.4f}{val_str}{acc_str}{cer_str} | "
        f"LR: {current_lr:.2e} | "
        f"{epoch_time:.0f}s | VRAM: {vram_peak:.0f}MB{marker}"
    )

    # Save checkpoint to Drive periodically
    if epoch % SAVE_EVERY == 0:
        model.save_pretrained(f"{DRIVE_SAVE_PATH}/checkpoint-epoch-{epoch}")
        processor.save_pretrained(f"{DRIVE_SAVE_PATH}/checkpoint-epoch-{epoch}")
        Path(f"{DRIVE_SAVE_PATH}/checkpoint-epoch-{epoch}").joinpath("training_split.json").write_text(json.dumps(split_manifest, indent=2), encoding="utf-8")
        print(f"  💾 Checkpoint saved to Drive: checkpoint-epoch-{epoch}")

total_time = time.time() - training_start

# Save final model
model.save_pretrained("/content/final_model")
processor.save_pretrained("/content/final_model")
Path("/content/final_model").joinpath("training_split.json").write_text(json.dumps(split_manifest, indent=2), encoding="utf-8")

print(f"\n{'='*70}")
print(f"  ✅ Training complete!")
print(f"  Total time: {total_time/60:.1f} minutes")
print(f"  Best val loss: {best_val_loss:.4f}")
print(f"  Best token accuracy: {best_accuracy:.1%}")
print(f"{'='*70}")


# ============================================================
# CELL 7: Plot All Training Graphs
# ============================================================

import matplotlib.pyplot as plt
import numpy as np

epochs_list = list(range(1, EPOCHS + 1))

fig, axes = plt.subplots(2, 3, figsize=(18, 10))

# ── 1. Training & Validation Loss ──
ax = axes[0, 0]
ax.plot(epochs_list, history["train_loss"], 'b-', linewidth=2, label='Train Loss')
val_epochs = [i+1 for i, v in enumerate(history["val_loss"]) if v is not None]
val_losses = [v for v in history["val_loss"] if v is not None]
if val_losses:
    ax.plot(val_epochs, val_losses, 'r-o', linewidth=2, markersize=5, label='Val Loss')
    best_idx = val_losses.index(min(val_losses))
    ax.annotate(f'Best: {min(val_losses):.4f}',
                xy=(val_epochs[best_idx], min(val_losses)),
                xytext=(val_epochs[best_idx]+1, min(val_losses) + (max(val_losses)-min(val_losses))*0.2),
                arrowprops=dict(arrowstyle='->', color='red', lw=1.5),
                fontsize=9, color='red', fontweight='bold')
ax.set_xlabel('Epoch')
ax.set_ylabel('Loss')
ax.set_title('Training & Validation Loss', fontweight='bold')
ax.legend()
ax.grid(True, alpha=0.3)

# ── 2. Token Accuracy ──
ax = axes[0, 1]
acc_epochs = [i+1 for i, v in enumerate(history["token_accuracy"]) if v is not None]
acc_values = [v*100 for v in history["token_accuracy"] if v is not None]
if acc_values:
    ax.plot(acc_epochs, acc_values, 'g-o', linewidth=2, markersize=6, color='#10B981')
    ax.fill_between(acc_epochs, acc_values, alpha=0.15, color='#10B981')
    best_acc = max(acc_values)
    best_acc_epoch = acc_epochs[acc_values.index(best_acc)]
    ax.annotate(f'Best: {best_acc:.1f}%',
                xy=(best_acc_epoch, best_acc),
                xytext=(best_acc_epoch-3, best_acc-5),
                arrowprops=dict(arrowstyle='->', color='#059669', lw=1.5),
                fontsize=9, color='#059669', fontweight='bold')
ax.set_xlabel('Epoch')
ax.set_ylabel('Accuracy (%)')
ax.set_title('Token-Level Accuracy', fontweight='bold')
ax.grid(True, alpha=0.3)

# ── 3. Character Error Rate (CER) ──
ax = axes[0, 2]
cer_epochs = [i+1 for i, v in enumerate(history["cer"]) if v is not None]
cer_values = [v for v in history["cer"] if v is not None]
if cer_values:
    ax.plot(cer_epochs, cer_values, 's-', linewidth=2, markersize=6, color='#EF4444')
    ax.fill_between(cer_epochs, cer_values, alpha=0.1, color='#EF4444')
    best_cer = min(cer_values)
    best_cer_epoch = cer_epochs[cer_values.index(best_cer)]
    ax.annotate(f'Best: {best_cer:.3f}',
                xy=(best_cer_epoch, best_cer),
                xytext=(best_cer_epoch+1, best_cer + (max(cer_values)-min(cer_values))*0.3),
                arrowprops=dict(arrowstyle='->', color='#DC2626', lw=1.5),
                fontsize=9, color='#DC2626', fontweight='bold')
ax.set_xlabel('Epoch')
ax.set_ylabel('CER (lower is better)')
ax.set_title('Character Error Rate', fontweight='bold')
ax.grid(True, alpha=0.3)

# ── 4. Learning Rate Schedule ──
ax = axes[1, 0]
ax.plot(epochs_list, history["learning_rate"], '-', linewidth=2, color='#8B5CF6')
ax.fill_between(epochs_list, history["learning_rate"], alpha=0.1, color='#8B5CF6')
ax.set_xlabel('Epoch')
ax.set_ylabel('Learning Rate')
ax.set_title('Learning Rate Schedule (Cosine)', fontweight='bold')
ax.ticklabel_format(style='scientific', axis='y', scilimits=(0,0))
ax.grid(True, alpha=0.3)

# ── 5. Epoch Training Time ──
ax = axes[1, 1]
ax.bar(epochs_list, history["epoch_time"], color='#F59E0B', edgecolor='white', alpha=0.85)
ax.set_xlabel('Epoch')
ax.set_ylabel('Time (seconds)')
ax.set_title('Training Time per Epoch', fontweight='bold')
ax.grid(True, alpha=0.3, axis='y')
avg_time = sum(history["epoch_time"]) / len(history["epoch_time"])
ax.axhline(y=avg_time, color='#D97706', linestyle='--', linewidth=1.5, label=f'Avg: {avg_time:.0f}s')
ax.legend()

# ── 6. VRAM Usage ──
ax = axes[1, 2]
ax.plot(epochs_list, [v/1024 for v in history["vram_peak_mb"]], '-', linewidth=2, color='#06B6D4')
ax.fill_between(epochs_list, [v/1024 for v in history["vram_peak_mb"]], alpha=0.15, color='#06B6D4')
ax.set_xlabel('Epoch')
ax.set_ylabel('Peak VRAM (GB)')
ax.set_title('GPU Memory Usage', fontweight='bold')
ax.grid(True, alpha=0.3)

plt.suptitle('Donut Model — Training Metrics Dashboard', fontsize=16, fontweight='bold', y=1.02)
plt.tight_layout()
plt.savefig(f"{DRIVE_SAVE_PATH}/03_training_dashboard.png", dpi=150, bbox_inches='tight')
plt.show()
print(f"📊 Saved to Drive: 03_training_dashboard.png")


# ── Summary Card ──
fig, ax = plt.subplots(figsize=(8, 5))
ax.axis('off')

summary_text = f"""
    TRAINING SUMMARY
    {'─'*40}
    Model:           Donut (naver-clova-ix/donut-base)
    Fine-tuned from: chinmays18/medical-prescription-ocr
    Dataset:         {DATASET_NAME}
    Samples:         {len(train_dataset)} train / {len(val_dataset)} val

    Epochs:          {EPOCHS}
    Batch Size:      {BATCH_SIZE} (effective: {BATCH_SIZE * GRAD_ACCUM})
    Learning Rate:   {LR}
    Parameters:      {param_count:,}
    Training Time:   {total_time/60:.1f} minutes

    RESULTS
    {'─'*40}
    Best Val Loss:      {best_val_loss:.4f}
    Best Token Accuracy: {best_accuracy:.1%}
    Best CER:           {min(cer_values):.4f}
"""

ax.text(0.05, 0.95, summary_text, transform=ax.transAxes,
        fontsize=11, verticalalignment='top', fontfamily='monospace',
        bbox=dict(boxstyle='round,pad=0.8', facecolor='#F0F9FF', edgecolor='#3B82F6', linewidth=2))
plt.tight_layout()
plt.savefig(f"{DRIVE_SAVE_PATH}/04_training_summary.png", dpi=150, bbox_inches='tight')
plt.show()
print(f"📊 Saved to Drive: 04_training_summary.png")


# ============================================================
# CELL 8: Save Everything to Google Drive
# ============================================================

import shutil

print(f"📁 Saving everything to: {DRIVE_SAVE_PATH}")

# Save best model
if os.path.exists("/content/best_model"):
    shutil.copytree("/content/best_model", f"{DRIVE_SAVE_PATH}/best_model", dirs_exist_ok=True)
    print(f"  ✅ Best model saved")

# Save final model
if os.path.exists("/content/final_model"):
    shutil.copytree("/content/final_model", f"{DRIVE_SAVE_PATH}/final_model", dirs_exist_ok=True)
    print(f"  ✅ Final model saved")

# Save training history as JSON
training_record = {
    "training_completed_at": datetime.now().isoformat(),
    "model_source": MODEL_SOURCE,
    "base_model": "naver-clova-ix/donut-base",
    "dataset": DATASET_NAME,
    "dataset_size": len(data),
    "train_samples": len(train_dataset),
    "val_samples": len(val_dataset),
    "hyperparameters": {
        "epochs": EPOCHS,
        "batch_size": BATCH_SIZE,
        "effective_batch_size": BATCH_SIZE * GRAD_ACCUM,
        "learning_rate": LR,
        "warmup_steps": WARMUP_STEPS,
        "gradient_accumulation_steps": GRAD_ACCUM,
        "optimizer": "AdamW",
        "scheduler": "cosine",
        "precision": "FP16",
    },
    "results": {
        "best_val_loss": best_val_loss,
        "best_token_accuracy": best_accuracy,
        "best_cer": min(cer_values) if cer_values else None,
        "final_train_loss": history["train_loss"][-1],
        "total_training_time_minutes": total_time / 60,
    },
    "gpu": {
        "name": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU",
        "vram_gb": vram_gb,
        "peak_vram_mb": max(history["vram_peak_mb"]) if history["vram_peak_mb"] else 0,
    },
    "parameters": param_count,
    "history": {
        "train_loss": history["train_loss"],
        "val_loss": history["val_loss"],
        "token_accuracy": history["token_accuracy"],
        "cer": history["cer"],
        "learning_rate": history["learning_rate"],
        "epoch_time": history["epoch_time"],
    },
}

with open(f"{DRIVE_SAVE_PATH}/training_history.json", "w") as f:
    json.dump(training_record, f, indent=2)
print(f"  ✅ Training history JSON saved")

# Save CSV for external use
with open(f"{DRIVE_SAVE_PATH}/training_metrics.csv", "w") as f:
    f.write("epoch,train_loss,val_loss,token_accuracy,cer,learning_rate,epoch_time_sec\n")
    for i in range(EPOCHS):
        val = history["val_loss"][i] if history["val_loss"][i] is not None else ""
        acc = history["token_accuracy"][i] if history["token_accuracy"][i] is not None else ""
        cer = history["cer"][i] if history["cer"][i] is not None else ""
        f.write(f"{i+1},{history['train_loss'][i]:.6f},{val},{acc},{cer},{history['learning_rate'][i]:.8f},{history['epoch_time'][i]:.1f}\n")
print(f"  ✅ Training metrics CSV saved")

print(f"\n{'='*60}")
print(f"  ✅ ALL FILES SAVED TO GOOGLE DRIVE!")
print(f"{'='*60}")
print(f"\n  📁 {DRIVE_SAVE_PATH}/")
print(f"  ├── best_model/          ← Your trained model (USE THIS)")
print(f"  ├── final_model/         ← Last epoch model")
print(f"  ├── training_history.json")
print(f"  ├── training_metrics.csv")
print(f"  ├── 01_dataset_samples.png")
print(f"  ├── 02_annotation_distribution.png")
print(f"  ├── 03_training_dashboard.png")
print(f"  └── 04_training_summary.png")
print(f"\n  📥 To use locally:")
print(f"  1. Download 'best_model' folder from Drive")
print(f"  2. Place at: server/models/donut-prescription/")
print(f"  3. Run: python donut_server.py")


# ============================================================
# CELL 9: Test Inference on Sample
# ============================================================

print(f"\n{'='*60}")
print(f"  🧪 Testing trained model on random samples")
print(f"{'='*60}\n")

model.eval()

fig, axes = plt.subplots(2, 3, figsize=(18, 10))
test_indices = random.sample(range(len(data)), 6)

for i, (ax, idx) in enumerate(zip(axes.flat, test_indices)):
    sample = data[idx]
    image = sample["image"].convert("RGB")
    gt = sample.get("ground_truth", sample.get("text", ""))

    pixel_values = processor(images=image, return_tensors="pt").pixel_values.to(device)
    task_prompt = "<s_ocr>"
    decoder_ids = processor.tokenizer(task_prompt, add_special_tokens=False, return_tensors="pt").input_ids.to(device)

    with torch.no_grad():
        with torch.amp.autocast('cuda'):
            generated = model.generate(
                pixel_values, decoder_input_ids=decoder_ids,
                max_length=512, num_beams=3, early_stopping=True,
                pad_token_id=processor.tokenizer.pad_token_id,
                eos_token_id=processor.tokenizer.eos_token_id,
            )

    predicted = processor.batch_decode(generated, skip_special_tokens=True)[0]
    cer = compute_cer(predicted, gt)

    ax.imshow(image)
    ax.set_title(f"Sample {idx} | CER: {cer:.3f}", fontsize=10, fontweight='bold')
    ax.axis("off")

    print(f"Sample {idx}:")
    print(f"  Predicted: {predicted[:120]}...")
    print(f"  GT:        {gt[:120]}...")
    print(f"  CER:       {cer:.4f}\n")

plt.suptitle('Inference Results — Trained Donut Model', fontsize=14, fontweight='bold')
plt.tight_layout()
plt.savefig(f"{DRIVE_SAVE_PATH}/05_inference_results.png", dpi=150, bbox_inches='tight')
plt.show()
print(f"📸 Saved to Drive: 05_inference_results.png")

print(f"\n✅ DONE! Your model is ready in Google Drive.")
