"""Offline regressions: python -m unittest discover -s tests -v (no model/cloud/database)."""
import ast
import asyncio
import base64
import io
import json
import logging
import re
import sys
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from PIL import Image

SERVER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVER))
from donut_safety import normalize_medication, normalize_medications, decode_image_base64, load_image_bytes
from training_safety import split_unique_samples, select_held_out_indices, optimizer_update_due, accumulation_group_size, optimizer_steps_per_epoch

class HTTPException(Exception):
    def __init__(self, status_code, detail):
        self.status_code, self.detail = status_code, detail
        super().__init__(detail)
class JSONResponse:
    def __init__(self, content, status_code=200):
        self.content, self.status_code = content, status_code

def source_objects(filename, names, globals=None):
    tree = ast.parse((SERVER / filename).read_text(encoding="utf-8"))
    objects = []
    for item in tree.body:
        if getattr(item, "name", None) in names:
            item.decorator_list = []
            objects.append(item)
    namespace = {"re": re, "json": json, "time": time, "log": logging.getLogger("offline-tests"), **(globals or {})}
    module = ast.Module(body=[ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0), *objects], type_ignores=[])
    exec(compile(ast.fix_missing_locations(module), filename, "exec"), namespace)
    return namespace

def donut_model():
    namespace = source_objects("donut_server.py", ["DonutModel"], {"normalize_medication": normalize_medication, "normalize_medications": normalize_medications, "GPU_MAX_LENGTH": 512, "CPU_MAX_LENGTH": 384, "GPU_NUM_BEAMS": 3, "CPU_NUM_BEAMS": 1})
    model = object.__new__(namespace["DonutModel"])
    model.is_ready, model.device = True, "cpu"
    return model

def png_bytes(size=(2, 2), color="white", format="PNG"):
    output = io.BytesIO()
    Image.new("RGB", size, color).save(output, format=format)
    return output.getvalue()

class ExtractionTests(unittest.TestCase):
    def test_native_schedule_and_distinct_regimens_survive(self):
        model = donut_model()
        values = model._parse_medications("medications: - Warfarin .5 mg - 1 - 0 - 1 - Warfarin 5 mg - Monday signature: Fixture")
        self.assertEqual(len(values), 2)
        self.assertEqual(values[0]["dosage"], "0.5mg")
        self.assertEqual(values[0]["frequency"], "1 in the morning, 1 at night")
        self.assertEqual(values[1]["frequency"], "Monday")
        self.assertTrue(all(value["needsReview"] and value["confidence"] <= 0.5 for value in values))
    def test_json_normalizes_every_item_without_keyerror(self):
        model = donut_model()
        fixture = json.dumps({"medications": [{"drug_name": "Metformin", "dosage": "500mg", "frequency": "BID", "confidence": "bad"}, None, {"drugName": 12}]})
        model._generate_on_device = lambda *args: fixture
        result = model.predict(None)
        self.assertEqual(len(result["medications"]), 1)
        self.assertEqual(result["medications"][0]["drugName"], "Metformin")
        self.assertEqual(result["date"], "Needs Review")
        self.assertLessEqual(result["confidence"], 0.5)
        self.assertEqual(result["confidence_kind"], "unvalidated-heuristic")
    def test_malformed_array_and_confidence_never_raise_or_approve(self):
        model = donut_model()
        for values in [None, 12, "Metformin", {"drugName": "Metformin"}]:
            self.assertEqual(model._parse_medications(json.dumps({"medications": values})), [])
        for confidence in [None, True, "0.9", float("nan"), float("inf"), -1, 700]:
            result = normalize_medication({"drugName": "UnknownDrug", "confidence": confidence})
            self.assertTrue(result["needsReview"])
            self.assertEqual(result["dosage"], "Needs Review")
            self.assertLessEqual(result["confidence"], 0.5)
    def test_standard_parser_does_not_merge_lines_or_drop_decimal(self):
        values = donut_model()._parse_medications("Warfarin .5mg Monday\nMetformin 500mg BID do not take with food")
        self.assertEqual([m["drugName"] for m in values], ["Warfarin", "Metformin"])
        self.assertIn("do not take with food", values[1]["frequency"])
        self.assertTrue(values[1]["needsReview"])
    def test_confidence_does_not_increase_with_medication_count(self):
        model = donut_model()
        model._generate_on_device = lambda *args: "Metformin 500mg BID"
        single = model.predict(None)["confidence"]
        model._generate_on_device = lambda *args: "Metformin 500mg BID\nWarfarin 5mg Monday"
        self.assertEqual(model.predict(None)["confidence"], single)

class ImageTests(unittest.TestCase):
    def test_oversize_base64_and_pixels_rejected_before_inference(self):
        oversized = png_bytes((2000, 2000), format="BMP")
        self.assertGreater(len(oversized), 10 * 1024 * 1024)
        with self.assertRaisesRegex(ValueError, "limit"):
            decode_image_base64(base64.b64encode(oversized).decode(), 10 * 1024 * 1024)
        with self.assertRaisesRegex(ValueError, "pixel limit"):
            load_image_bytes(png_bytes((100, 100)), 10 * 1024 * 1024, 100)
    def test_empty_malformed_unsupported_and_valid_images(self):
        for value in [None, [], "", "!!notbase64!!", "data:text/html;base64,YQ=="]:
            with self.assertRaises(ValueError): decode_image_base64(value, 1000)
        self.assertEqual(load_image_bytes(png_bytes(), 1000, 100).size, (2, 2))
        with self.assertRaises(ValueError): load_image_bytes(b"not an image", 1000, 100)

class QueueTests(unittest.IsolatedAsyncioTestCase):
    def make_queue(self, output=None, failure=None, pending=0):
        async def run_in_threadpool(fn, image):
            if failure: raise failure
            return output if output is not None else {"medications": [], "confidence": 0}
        return source_objects("donut_server.py", ["_run_inference_with_queue", "predict_base64", "internal_access"], {
            "asyncio": asyncio, "HTTPException": HTTPException, "JSONResponse": JSONResponse,
            "donut": SimpleNamespace(is_ready=True, predict=lambda image: output), "run_in_threadpool": run_in_threadpool,
            "active_lock": asyncio.Lock(), "inference_semaphore": asyncio.Semaphore(1), "active_inferences": 0, "pending_inferences": pending,
            "MAX_PENDING_INFERENCES": 1, "MAX_CONCURRENT_INFERENCES": 1, "INFERENCE_QUEUE_TIMEOUT_SEC": 0.001,
            "MAX_IMAGE_BYTES": 10 * 1024 * 1024, "MAX_IMAGE_PIXELS": 100,
            "decode_image_base64": decode_image_base64, "load_image_bytes": load_image_bytes,
            "INTERNAL_TOKEN": "offline-fixture-token", "hmac": __import__("hmac")})
    async def test_model_error_is_503_and_releases_permit(self):
        for options in [{"output": {"error": "fixture model failure"}}, {"failure": RuntimeError("fixture model failure")}]:
            namespace = self.make_queue(**options)
            with self.assertRaises(HTTPException) as raised:
                await namespace["predict_base64"]({"image": base64.b64encode(png_bytes()).decode()})
            self.assertEqual(raised.exception.status_code, 503)
            self.assertEqual(namespace["active_inferences"], 0)
            self.assertEqual(namespace["pending_inferences"], 0)
            self.assertEqual(namespace["inference_semaphore"]._value, 1)
    async def test_full_queue_and_timeout_are_bounded(self):
        namespace = self.make_queue(pending=2)
        with self.assertRaises(HTTPException): await namespace["_run_inference_with_queue"](Image.new("RGB", (2, 2)))
        self.assertEqual(namespace["pending_inferences"], 2)
        namespace = self.make_queue()
        await namespace["inference_semaphore"].acquire()
        with self.assertRaises(HTTPException): await namespace["_run_inference_with_queue"](Image.new("RGB", (2, 2)))
        self.assertEqual(namespace["pending_inferences"], 0)
        self.assertEqual(namespace["active_inferences"], 0)
    async def test_disconnect_keeps_inference_permit_until_worker_finishes(self):
        namespace = self.make_queue()
        started, finish = asyncio.Event(), asyncio.Event()
        async def worker(fn, image):
            started.set()
            await finish.wait()
            return {"medications": [], "confidence": 0}
        namespace["run_in_threadpool"] = worker
        task = asyncio.create_task(namespace["_run_inference_with_queue"](Image.new("RGB", (2, 2))))
        await started.wait()
        task.cancel()
        await asyncio.sleep(0)
        self.assertEqual(namespace["inference_semaphore"]._value, 0)
        self.assertEqual(namespace["active_inferences"], 1)
        finish.set()
        with self.assertRaises(asyncio.CancelledError): await task
        self.assertEqual(namespace["inference_semaphore"]._value, 1)
        self.assertEqual(namespace["active_inferences"], 0)
        self.assertEqual(namespace["pending_inferences"], 0)
    async def test_internal_access_requires_token_and_body_bound(self):
        namespace = self.make_queue()
        called = []
        async def next_handler(request): called.append(True); return JSONResponse({"ok": True})
        request = SimpleNamespace(url=SimpleNamespace(path="/api/predict-base64"), client=SimpleNamespace(host="127.0.0.1"), headers={"content-length": "100"})
        result = await namespace["internal_access"](request, next_handler)
        self.assertEqual(result.status_code, 403)
        request.headers["x-donut-token"] = "offline-fixture-token"
        request.headers["content-length"] = "999999999"
        self.assertEqual((await namespace["internal_access"](request, next_handler)).status_code, 413)
        request.headers["content-length"] = "100"
        self.assertEqual((await namespace["internal_access"](request, next_handler)).status_code, 200)
        self.assertEqual(len(called), 1)

class ResearchTests(unittest.TestCase):
    def test_metrics_use_each_prediction_once_and_stay_in_bounds(self):
        metrics = source_objects("evaluate_model.py", ["compute_metrics", "_fuzzy_match"])["compute_metrics"]
        result = metrics(["metformin"], ["metformin", "metformine"])
        self.assertEqual(result["true_positives"], 1)
        self.assertEqual(result["precision"], 1)
        self.assertEqual(result["recall"], 0.5)
        self.assertAlmostEqual(result["f1"], 0.6667)
    def test_image_disjoint_splits_and_manifest_selection(self):
        samples = [{"image": Image.new("RGB", (2, 2), color), "ground_truth": "Synthetic fixture"} for color in ["red", "green", "blue"]]
        train, heldout, manifest = split_unique_samples(samples + samples[:1])
        self.assertEqual(len(train) + len(heldout), 3)
        self.assertFalse(set(manifest["train_ids"]) & set(manifest["held_out_ids"]))
        indices = select_held_out_indices(samples, manifest)
        self.assertEqual(len(indices), len(heldout))
        with self.assertRaises(ValueError): select_held_out_indices(samples, {"train_ids": ["x"], "held_out_ids": ["x"]})
        with self.assertRaises(ValueError): split_unique_samples(samples[:1])
    def test_partial_accumulation_flushes_and_scheduler_counts_updates(self):
        self.assertEqual(sum(optimizer_update_due(i, 3, 4) for i in range(3)), 1)
        self.assertEqual(optimizer_steps_per_epoch(3, 4), 1)
        self.assertEqual(accumulation_group_size(2, 3, 4), 3)
        self.assertEqual(optimizer_steps_per_epoch(9, 4), 3)
        self.assertEqual(accumulation_group_size(8, 9, 4), 1)

if __name__ == "__main__": unittest.main()
