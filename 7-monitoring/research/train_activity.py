"""Fit a reproducible research baseline from labeled pose features, never pixels.

This trains only activity classification; temporal fall rules require separate
sequence validation. The test set is not used to select parameters or thresholds.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
from edge.activity import FEATURE_NAMES, CLASSIFIER_MIN_CONFIDENCE
from .split import assert_no_leakage
from .evaluate import metrics


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest"); parser.add_argument("--output-dir", required=True)
    parser.add_argument("--seed", type=int, default=2026)
    args = parser.parse_args()
    raw = Path(args.manifest).read_bytes()
    rows = [json.loads(line) for line in raw.decode("utf-8").splitlines() if line.strip()]
    assert_no_leakage(rows)
    supported = {"standing", "walking", "sitting", "lying", "resting"}
    for row in rows:
        if row.get("label") not in supported or not isinstance(row.get("features"), dict):
            raise ValueError("Use labeled activity samples with the documented feature schema")
        vector = [row["features"][key] for key in FEATURE_NAMES]
        if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in vector):
            raise ValueError("Only finite measured pose features are permitted")
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler
    import sklearn
    import joblib
    import numpy
    training = [r for r in rows if r["split"] == "train"]
    labels = {r["label"] for r in training}
    if len(labels) < 2 or not {r["label"] for r in rows}.issubset(labels):
        raise ValueError("Training needs at least two classes and must represent all held-out classes")
    model = make_pipeline(StandardScaler(), LogisticRegression(class_weight="balanced", max_iter=1000, random_state=args.seed))
    vectors = lambda samples: [[row["features"][key] for key in FEATURE_NAMES] for row in samples]
    model.fit(vectors(training), [row["label"] for row in training])
    outputs = {"manifestSha256": hashlib.sha256(raw).hexdigest(), "seed": args.seed,
               "classifier": "StandardScaler + balanced LogisticRegression", "featureNames": FEATURE_NAMES,
               "scoreMeaning": "uncalibrated classifier probability; no clinical probability claim",
               "libraryVersions": {"sklearn": sklearn.__version__, "numpy": numpy.__version__, "joblib": joblib.__version__}}
    output_dir = Path(args.output_dir); output_dir.mkdir(parents=True, exist_ok=True)
    for split in ("validation", "test"):
        samples = [row for row in rows if row["split"] == split]
        predicted = model.predict(vectors(samples))
        probabilities = model.predict_proba(vectors(samples)).max(axis=1)
        # Deployment applies the same threshold; rejected predictions count.
        predictions = [{"sampleId": row["sampleId"], "actual": row["label"],
                        "predicted": str(label) if confidence >= CLASSIFIER_MIN_CONFIDENCE else "unknown", "confidence": float(confidence)}
                       for row, label, confidence in zip(samples, predicted, probabilities)]
        outputs[split] = metrics(predictions)
        (output_dir/f"{split}-predictions.json").write_text(json.dumps(predictions, indent=2), encoding="utf-8")
    version = "activity-logistic-v1-"+hashlib.sha256(raw).hexdigest()[:12]
    artifact_path = output_dir/"activity-model.joblib"
    joblib.dump({"model": model, "featureNames": FEATURE_NAMES, "modelVersion": version}, artifact_path)
    outputs.update(modelVersion=version, modelSha256=hashlib.sha256(artifact_path.read_bytes()).hexdigest())
    (output_dir/"evaluation.json").write_text(json.dumps(outputs, indent=2, allow_nan=False), encoding="utf-8")


if __name__ == "__main__":
    main()
