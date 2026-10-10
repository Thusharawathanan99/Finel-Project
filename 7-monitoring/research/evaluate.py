"""Evaluate real labeled predictions; includes abstentions as classification errors.

Input CSV: actual,predicted,confidence,participantId,lighting,ageBand,gender,skinTone
Optional durationSeconds (non-overlapping observation windows) enables FP/hour.
"""
import argparse
import csv
import json
import math
from collections import Counter
from pathlib import Path


def divide(numerator, denominator):
    return numerator/denominator if denominator else None


def metrics(rows, positive="fall"):
    if not rows:
        raise ValueError("Labeled observations are required")
    labels = sorted({r["actual"] for r in rows} | {r["predicted"] for r in rows})
    counts = Counter((r["actual"], r["predicted"]) for r in rows)
    classes = {}
    for label in labels:
        tp = counts[(label, label)]
        fp = sum(n for (actual, predicted), n in counts.items() if predicted == label and actual != label)
        fn = sum(n for (actual, predicted), n in counts.items() if actual == label and predicted != label)
        classes[label] = {"support": sum(n for (actual, _), n in counts.items() if actual == label),
                          "precision": divide(tp, tp+fp), "recall": divide(tp, tp+fn), "f1": divide(2*tp, 2*tp+fp+fn)}
    tp = counts[(positive, positive)]
    fn = sum(n for (a, p), n in counts.items() if a == positive and p != positive)
    fp = sum(n for (a, p), n in counts.items() if a != positive and p == positive)
    tn = len(rows)-tp-fn-fp
    actual_labels = {r["actual"] for r in rows}
    result = {"sampleCount": len(rows), "labels": labels,
              "confusionMatrix": [[counts[(a, p)] for p in labels] for a in labels],
              "accuracy": sum(counts[(label, label)] for label in labels)/len(rows),
              "coverage": sum(r["predicted"] != "unknown" for r in rows)/len(rows),
              "macroF1": sum(classes[l]["f1"] or 0 for l in actual_labels)/len(actual_labels),
              "perClass": classes,
              "fall": {"tp": tp, "fp": fp, "fn": fn, "tn": tn,
                       "sensitivity": divide(tp, tp+fn), "specificity": divide(tn, tn+fp)}}
    if all(r.get("durationSeconds") not in {None, ""} for r in rows):
        durations = [float(r["durationSeconds"]) for r in rows]
        if any(not math.isfinite(v) or v <= 0 for v in durations):
            raise ValueError("Positive measured observation durations are required")
        hours = sum(d for d, r in zip(durations, rows) if r["actual"] != positive)/3600
        result["fall"]["falsePositivesPerNonfallHour"] = divide(fp, hours)
    return result


def report(rows):
    result = {"evaluationUnit": "One labeled observation window per row; no overlapping windows for FP/hour", "overall": metrics(rows), "subgroups": {}}
    for field in ("lighting", "ageBand", "gender", "skinTone"):
        values = sorted({r[field] for r in rows if r.get(field)})
        if values:
            result["subgroups"][field] = {value: metrics([r for r in rows if r.get(field) == value]) for value in values}
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("predictions"); parser.add_argument("--output", required=True)
    parser.add_argument("--min-confidence", type=float, default=0.75)
    args = parser.parse_args()
    if not 0 <= args.min_confidence <= 1:
        parser.error("min-confidence must be between zero and one")
    with open(args.predictions, newline="", encoding="utf-8") as file:
        rows = list(csv.DictReader(file))
    for row in rows:
        if not row.get("actual") or not row.get("predicted"):
            raise ValueError("actual and predicted labels are required")
        confidence = float(row["confidence"])
        if not math.isfinite(confidence) or not 0 <= confidence <= 1:
            raise ValueError("confidence must be finite and between zero and one")
        if confidence < args.min_confidence:
            row["predicted"] = "unknown"
    result = report(rows); result["minimumConfidence"] = args.min_confidence
    Path(args.output).write_text(json.dumps(result, indent=2, allow_nan=False), encoding="utf-8")


if __name__ == "__main__":
    main()
