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
