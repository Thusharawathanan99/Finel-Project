"""MediaPipe Tasks adapter. Model assets must be explicitly supplied locally."""
from pathlib import Path
from .activity import Point, Pose, FEATURE_NAMES


class PoseDetector:
    def __init__(self, model_path, max_people=6):
        if not Path(model_path).is_file():
            raise ValueError("Provide an existing, explicitly downloaded MediaPipe pose .task model")
        import mediapipe as mp
        self.mp = mp
        options = mp.tasks.vision.PoseLandmarkerOptions(
            base_options=mp.tasks.BaseOptions(model_asset_path=str(model_path)),
            running_mode=mp.tasks.vision.RunningMode.VIDEO,
            num_poses=max_people, min_pose_detection_confidence=0.6,
            min_pose_presence_confidence=0.6, min_tracking_confidence=0.6,
            output_segmentation_masks=False)
        self.detector = mp.tasks.vision.PoseLandmarker.create_from_options(options)
        self.last_ms = -1

    def detect(self, bgr, at):
        import cv2
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        sample = self.mp.Image(image_format=self.mp.ImageFormat.SRGB, data=rgb)
        ms = max(self.last_ms+1, int(at*1000)); self.last_ms = ms
        result = self.detector.detect_for_video(sample, ms)
        return [Pose(tuple(Point(p.x, p.y, min(p.visibility, p.presence)) for p in landmarks), bgr.shape[1]/bgr.shape[0]) for landmarks in result.pose_landmarks]

    def close(self):
        self.detector.close()


class ResearchClassifier:
    def __init__(self, path):
        # joblib/pickle can execute code: load only your own trusted trained artifact.
        import joblib
        artifact = joblib.load(path)
        if artifact.get("featureNames") != FEATURE_NAMES:
            raise ValueError("Classifier feature schema does not match the edge pipeline")
        self.model = artifact["model"]; self.version = artifact["modelVersion"]

    def predict(self, vector):
        probabilities = self.model.predict_proba([vector])[0]
        best = int(probabilities.argmax())
        return str(self.model.classes_[best]), float(probabilities[best])
