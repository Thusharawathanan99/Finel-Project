"""Subject, recording, and exact-content-disjoint split of a licensed manifest.

JSONL rows need sampleId, participantId, recordingId, contentHash, label, features.
Related subjects/recordings/duplicates form indivisible connected groups.
"""
import argparse
import json
import random
import re
from pathlib import Path

IDENTITY_FIELDS = ("participantId", "recordingId", "contentHash")


def validate_manifest(rows):
    if not rows:
        raise ValueError("A real labeled manifest is required")
    seen = set()
    for row in rows:
        if not isinstance(row.get("sampleId"), str) or row["sampleId"] in seen:
            raise ValueError("sampleId must be a unique string")
        seen.add(row["sampleId"])
        if any(not isinstance(row.get(field), str) or not row[field] for field in IDENTITY_FIELDS):
            raise ValueError("Participant, original recording, and SHA-256 identity are mandatory")
        if not re.fullmatch("[a-fA-F0-9]{64}", row["contentHash"]):
            raise ValueError("contentHash must be a source recording SHA-256 digest")


def assert_no_leakage(rows):
    validate_manifest(rows)
    maps = {field: {} for field in IDENTITY_FIELDS}
    for row in rows:
        split = row.get("split")
        if split not in {"train", "validation", "test"}:
            raise ValueError("Every sample needs a train/validation/test split")
        for field in IDENTITY_FIELDS:
            key = row[field].lower() if field == "contentHash" else row[field]
            previous = maps[field].setdefault(key, split)
            if previous != split:
                raise ValueError(f"Data leakage: {field} appears in {previous} and {split}")
    if {r["split"] for r in rows} != {"train", "validation", "test"}:
        raise ValueError("At least one independent group in each of three splits is required")


def split_manifest(rows, seed=2026, fractions=(0.70, 0.15, 0.15)):
    validate_manifest(rows)
    parents = list(range(len(rows)))
    def root(i):
        while parents[i] != i:
            parents[i] = parents[parents[i]]; i = parents[i]
        return i
    identities = {}
    for i, row in enumerate(rows):
        for field in IDENTITY_FIELDS:
            identity = (field, row[field].lower() if field == "contentHash" else row[field])
            if identity in identities:
                parents[root(i)] = root(identities[identity])
            else:
                identities[identity] = i
    groups = {}
    for i in range(len(rows)):
        groups.setdefault(root(i), []).append(i)
    if len(groups) < 3:
        raise ValueError("At least three independent participant/recording groups are needed")
    clusters = list(groups.values()); random.Random(seed).shuffle(clusters)
    clusters.sort(key=len, reverse=True)
    names = ["train", "validation", "test"]; counts = [0, 0, 0]
    output = [dict(row) for row in rows]
    for index, cluster in enumerate(clusters):
        remaining = len(clusters)-index
        empty = [i for i, count in enumerate(counts) if count == 0]
        target = empty[0] if remaining == len(empty) else max(range(3), key=lambda i: fractions[i]*len(rows)-counts[i])
        for i in cluster:
            output[i]["split"] = names[target]
        counts[target] += len(cluster)
    assert_no_leakage(output)
    return output


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest"); parser.add_argument("--output", required=True)
    parser.add_argument("--seed", type=int, default=2026); parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    rows = [json.loads(line) for line in Path(args.manifest).read_text(encoding="utf-8").splitlines() if line.strip()]
    if args.verify:
        assert_no_leakage(rows); output = rows
    else:
        output = split_manifest(rows, args.seed)
    Path(args.output).write_text("\n".join(json.dumps(row, allow_nan=False) for row in output)+"\n", encoding="utf-8")


if __name__ == "__main__":
    main()
