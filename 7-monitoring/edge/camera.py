"""Latest-camera-sample process. Stop can terminate a blocked device driver.

Pixels only cross an in-memory queue, never a file or network API.
"""
import multiprocessing as mp
import os
from queue import Empty, Full
import time


def _capture(source, output, stop, lease, width, height):
    os.environ["OPENCV_FFMPEG_LOGLEVEL"] = "-8"
    import cv2
    cv2.setLogLevel(0)
    capture = None
    try:
        if source == "picamera2":
            from picamera2 import Picamera2
            capture = Picamera2()
            # Picamera2 RGB888 buffers are BGR byte order, as expected by OpenCV.
            capture.configure(capture.create_video_configuration(main={"size": (width, height), "format": "RGB888"}))
            capture.start()
        else:
            capture = cv2.VideoCapture(int(source) if source.isdigit() else source)
            capture.set(cv2.CAP_PROP_FRAME_WIDTH, width)
            capture.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
            capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            if not capture.isOpened():
                return
        while not stop.is_set() and time.monotonic() < lease.value:
            if source == "picamera2":
                sample = capture.capture_array(); ok = sample is not None
            else:
                ok, sample = capture.read()
            if not ok or sample is None:
                return
            if stop.is_set() or time.monotonic() >= lease.value:
                return  # A blocking read may finish after consent has expired.
            if sample.shape[1] > width:
                sample = cv2.resize(sample, (width, max(1, int(sample.shape[0]*width/sample.shape[1]))))
            try:
                output.put_nowait((time.monotonic(), sample))
            except Full:
                try:
                    output.get_nowait()
                except Empty:
                    pass
                try:
                    output.put_nowait((time.monotonic(), sample))
                except Full:
                    pass
    except Exception:
        # Avoid third-party error messages containing RTSP credentials or pixels.
        return
    finally:
        if capture is not None:
            if source == "picamera2":
                capture.stop(); capture.close()
            else:
                capture.release()
        output.cancel_join_thread()


class Camera:
    def __init__(self, source="0", width=640, height=480):
        self.source, self.width, self.height = source, width, height
        self.context = mp.get_context("spawn")
        self.process = None; self.output = None; self.stop_event = None; self.lease = None

    def start(self, expires_at):
        self.output = self.context.Queue(maxsize=1)
        self.stop_event = self.context.Event()
        self.lease = self.context.Value("d", expires_at)
        self.process = self.context.Process(target=_capture, args=(self.source, self.output, self.stop_event, self.lease, self.width, self.height), daemon=True)
        self.process.start()

    def read(self):
        if not self.output:
            return None
        try:
            return self.output.get_nowait()
        except Empty:
            return None

    def stop(self):
        if self.process:
            self.stop_event.set(); self.process.join(timeout=0.5)
            if self.process.is_alive():
                self.process.terminate(); self.process.join(timeout=1)
            self.process.close(); self.output.cancel_join_thread(); self.output.close()
        self.process = None; self.output = None

    def update_lease(self, expires_at):
        if self.lease is not None:
            self.lease.value = expires_at

    def alive(self):
        return bool(self.process and self.process.is_alive())
