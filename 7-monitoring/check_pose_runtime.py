"""Load supplied pose weights and process two blank frames without opening a camera."""
import argparse
import hashlib
import importlib.metadata
import json
import platform
from pathlib import Path

from edge.pose import PoseDetector


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, default=Path(__file__).parent / "models/pose_landmarker_lite.task")
    args = parser.parse_args()
    if not args.model.is_file():
        parser.error("Supply an existing local .task model with --model; this check does not download weights")
    import numpy as np
    detector = PoseDetector(args.model, max_people=6)
    try:
        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        counts = [len(detector.detect(frame, 1.0)), len(detector.detect(frame, 1.0))]
        if counts != [0, 0] or detector.last_ms != 1001:
            raise RuntimeError("Blank-frame/timestamp check failed")
        print(json.dumps({
            "passed": True, "check": "model-load-and-blank-frame-inference",
            "python": platform.python_version(), "platform": platform.platform(),
            "packages": {name: importlib.metadata.version(name) for name in
                         ("mediapipe", "opencv-contrib-python", "numpy", "psutil")},
            "modelSha256": hashlib.sha256(args.model.read_bytes()).hexdigest(),
            "configuredMaxPeople": 6, "blankFramePoseCounts": counts,
            "cameraOpened": False, "clinicalAccuracyMeasured": False,
        }, indent=2))
    finally:
        detector.close()


if __name__ == "__main__":
    main()
