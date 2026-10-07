"""Recognition fixtures, screenshot fallback and both real import entry points."""
import argparse
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from urllib import error, request

from companion import app as companion
from runtime import SoloRuntime
from server import app as backend
from shared.mission_import import ocr, service
from shared.mission_import.parser import parse_mission_objectives
from shared.mission_import.text import parse_max_container_scu

FIXTURES = json.loads((Path(__file__).parent / "fixtures/mission-texts.json").read_text(encoding="utf-8"))
CONTAINER_FIXTURES = json.loads((Path(__file__).parent / "fixtures/container-texts.json").read_text(encoding="utf-8"))


class MissionTextTests(unittest.TestCase):
    def test_all_four_german_container_formats(self):
        for size in (1, 2, 4, 8, 16, 24, 32):
            for text in (
                f"Max. Containergröße: {size} SCU",
                f"Schiffskapazität: {size} SCU SCU",
                f"Maximal {size} SCU Frachtcontainer",
                f"Ein Schiff, das {size} SCU Frachtcontainer transportieren kann",
            ):
                with self.subTest(text=text):
                    self.assertEqual(parse_max_container_scu(text), size)

    def test_container_size_labels_and_unrelated_scu_values(self):
        for fixture in CONTAINER_FIXTURES:
            with self.subTest(fixture=fixture["name"]):
                self.assertEqual(parse_max_container_scu(fixture["text"]), fixture["expected"])

    def test_existing_german_english_and_service_contracts(self):
        for fixture in FIXTURES:
            with self.subTest(fixture=fixture["name"]):
                draft = parse_mission_objectives(fixture["text"])
                if fixture["checks"] is None:
                    self.assertIsNone(draft)
                    continue
                self.assertIsNotNone(draft)
                for path, expected in fixture["checks"].items():
                    value = draft
                    for part in path.split("."):
                        value = value[int(part)] if isinstance(value, list) else value[part]
                    self.assertEqual(value, expected, path)


class ScreenshotPipelineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.image = self.root / "original.png"
        self.image.write_bytes(b"fixture")

    def crop(self, source, region):
        self.assertEqual(source, self.image)
        path = self.root / (region + ".png")
        path.touch()
        return path

    def recognize(self, texts, *, crop=None):
        with patch.object(ocr, "prepare_ocr_crop", side_effect=crop or self.crop), patch.object(
            ocr, "run_ocr", side_effect=lambda _exe, image: texts[image.stem]
        ):
            return service.read_mission_screenshot("tesseract", self.image, lambda *_: None)

    def assert_crops_cleaned(self):
        self.assertEqual(list(self.root.iterdir()), [self.image])

    def test_details_title_reward_and_quality_share_one_pipeline(self):
        draft, failure = self.recognize({
            "objectives": FIXTURES[0]["text"],
            "details": "Maximum container size: 8 SCU",
            "title": "Titan Delivery",
            "reward": "Reward: 12,500 aUEC\nContractor: Test Pilot",
        })
        self.assertIsNone(failure)
        self.assertEqual(draft["title"], "Titan Delivery")
        self.assertEqual(draft["payout"], 12500)
        self.assertEqual(draft["maxContainerScu"], 8)
        self.assertEqual(draft["serviceDetails"]["customer"], "Test Pilot")
        self.assertEqual(draft["fieldQuality"]["payout"], "verified")
        self.assert_crops_cleaned()

    def test_full_image_fallback_and_crop_cleanup(self):
        draft, failure = self.recognize({
            "objectives": "", "details": "", "title": "", "reward": "", "original": FIXTURES[4]["text"],
        })
        self.assertIsNone(failure)
        self.assertEqual(draft["routes"][0]["targetScu"], 8)
        self.assert_crops_cleaned()

    def test_container_size_survives_screenshot_pipeline(self):
        for fixture in CONTAINER_FIXTURES:
            with self.subTest(fixture=fixture["name"]):
                draft, failure = self.recognize({
                    "objectives": FIXTURES[0]["text"], "details": fixture["text"],
                    "title": "Cargo contract", "reward": "Reward: 12,500 aUEC",
                })
                self.assertIsNone(failure)
                self.assertEqual(draft.get("maxContainerScu"), fixture["expected"])
                self.assertEqual(draft["consignments"][0]["totalScu"], 8)
                self.assert_crops_cleaned()

    def test_service_found_in_details_and_enriched_from_title(self):
        draft, failure = self.recognize({
            "objectives": "", "details": "SALVAGE RIGHTS\nContractor: Test Pilot",
            "title": "CLAIM #AB-123: Freelancer SALVAGE RIGHTS", "reward": "Reward: 0 aUEC",
        })
        self.assertIsNone(failure)
        self.assertEqual(draft["type"], "salvage")
        self.assertEqual(draft["serviceDetails"]["salvageTarget"], "Freelancer")
        self.assertEqual(draft["serviceDetails"]["claimNumber"], "#AB-123")
        self.assertEqual(draft["payout"], 0)
        self.assert_crops_cleaned()

    def test_package_recovery_keeps_delivery_type(self):
        draft, failure = self.recognize({
            "objectives": FIXTURES[5]["text"], "details": "Paket bergen",
            "title": "Retrieval Run", "reward": "Reward: 1500 aUEC",
        })
        self.assertIsNone(failure)
        self.assertEqual(draft["type"], "delivery")
        self.assertEqual(draft["serviceDetails"]["packages"][0]["destination"], "Lorville")
        self.assert_crops_cleaned()

    def test_optional_ocr_failure_preserves_recognized_mission(self):
        def read(_exe, image):
            if image.stem == "objectives":
                return FIXTURES[0]["text"]
            raise subprocess.TimeoutExpired("tesseract", 30)
        with patch.object(ocr, "prepare_ocr_crop", side_effect=self.crop), patch.object(ocr, "run_ocr", side_effect=read):
            draft, failure = service.read_mission_screenshot("tesseract", self.image, lambda *_: None)
        self.assertEqual(draft["title"], "Titan")
        self.assertIsNone(failure)
        self.assert_crops_cleaned()

    def test_failed_ocr_returns_error_and_cleans_all_crops(self):
        with patch.object(ocr, "prepare_ocr_crop", side_effect=self.crop), patch.object(
            ocr, "run_ocr", side_effect=RuntimeError("unreadable")
        ):
            draft, failure = service.read_mission_screenshot("tesseract", self.image, lambda *_: None)
        self.assertIsNone(draft)
        self.assertIsInstance(failure, RuntimeError)
        self.assert_crops_cleaned()

    def test_no_crop_platform_uses_original_image(self):
        with patch.object(ocr, "prepare_ocr_crop", return_value=None), patch.object(
            ocr, "run_ocr", return_value=FIXTURES[0]["text"]
        ) as run:
            draft, failure = service.read_mission_screenshot("tesseract", self.image, lambda *_: None)
        self.assertIsNone(failure)
        self.assertEqual(draft["consignments"][0]["totalScu"], 8)
        run.assert_called_once_with("tesseract", self.image)

    def test_crop_timeout_cleans_partial_output_and_uses_packaged_script(self):
        outputs = []
        def fail(command, **_options):
            self.assertTrue(Path(command[command.index("-File") + 1]).is_file())
            output = Path(command[command.index("-Output") + 1])
            outputs.append(output)
            output.touch()
            raise subprocess.TimeoutExpired("powershell", 20)
        with patch.object(ocr.os, "name", "nt"), patch.object(ocr.subprocess, "run", side_effect=fail):
            with self.assertRaises(subprocess.TimeoutExpired):
                ocr.prepare_ocr_crop(self.image, "objectives")
        self.assertEqual(len(outputs), 1)
        self.assertFalse(outputs[0].exists())

    def test_tesseract_reads_utf8_and_uses_its_bundled_language_data(self):
        exe = self.root / "tesseract.exe"
        (self.root / "tessdata").mkdir()
        with patch.object(ocr.subprocess, "run", return_value=Mock(returncode=0, stdout="Aufträge", stderr="")) as run:
            self.assertEqual(ocr.run_ocr(str(exe), self.image), "Aufträge")
        self.assertEqual(run.call_args.kwargs["encoding"], "utf-8")
        self.assertEqual(run.call_args.kwargs["env"]["TESSDATA_PREFIX"], str(self.root / "tessdata"))


class RecognitionApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.runtime = SoloRuntime(self.root / "data", port=0, lan=False)
        self.runtime.start(capture_enabled=False)
        self.image = self.root / "screen.png"
        self.image.write_bytes(b"test screenshot")

    def tearDown(self):
        self.runtime.stop()
        self.temp.cleanup()

    def api(self, path, body=None, headers=None):
        req = request.Request(self.runtime.url + path, data=body, headers=headers or {})
        try:
            response = request.urlopen(req, timeout=5)
        except error.HTTPError as exception:
            response = exception
        with response:
            return response.status, json.loads(response.read())

    def recognize(self):
        return self.api("/api/imports/recognize", self.image.read_bytes(), {"Content-Type": "image/png"})

    def test_manual_and_companion_produce_identical_drafts_without_preview_saving(self):
        # Both entry points execute the real shared pipeline, parser, normalization,
        # and learned-location lookup. Only the external OCR executable is mocked.
        fixtures = [f for f in FIXTURES if f["checks"] is not None]
        for index, fixture in enumerate(fixtures):
            with self.subTest(fixture=fixture["name"]), patch.object(ocr, "resolve_tesseract", return_value="tesseract"), patch.object(
                ocr, "prepare_ocr_crop", return_value=None
            ), patch.object(ocr, "run_ocr", return_value=fixture["text"]):
                self.image.write_bytes(str(index).encode())
                before = len(self.api("/api/imports?status=pending")[1]["imports"])
                code, preview = self.recognize()
                self.assertEqual(code, 200)
                self.assertTrue(preview["ok"])
                self.assertIsNotNone(preview["draft"])
                self.assertEqual(len(self.api("/api/imports?status=pending")[1]["imports"]), before)
                self.assertIsNone(self.api("/api/state")[1]["state"])
                args = argparse.Namespace(scope="solo", server=self.runtime.url, token="", user_token="",
                                          device_id="test-pc", device_name="PC", settle_seconds=0)
                state = companion.CompanionState(self.root / "capture-state.json")
                companion.process_screenshot(args, state, "tesseract", self.image, lambda *_: None)
                imports = self.api("/api/imports?status=pending")[1]["imports"]
                self.assertEqual(len(imports), before + 1)
                self.assertEqual(imports[0]["draft"], preview["draft"])
                self.assertTrue(state.contains(companion.file_signature(self.image)))

    def test_container_size_reaches_manual_preview_and_companion_inbox(self):
        for index, details in enumerate((
            "Max. Containergröße: 16 SCU",
            "Schiffskapazitat: 16 SCU SCU",
            "Maximal 16 SCU Frachtcontainer",
            "Ein Schiff, das 16 SCU Frachtcontainer transportieren kann",
        )):
            texts = {"objectives": FIXTURES[0]["text"], "details": details, "title": "Cargo", "reward": ""}

            def crop(_image, region):
                path = self.root / (region + ".png")
                path.touch()
                return path

            with self.subTest(details=details), patch.object(ocr, "resolve_tesseract", return_value="tesseract"), patch.object(
                ocr, "prepare_ocr_crop", side_effect=crop
            ), patch.object(ocr, "run_ocr", side_effect=lambda _exe, image: texts[image.stem]):
                self.image.write_bytes(str(index).encode())
                code, preview = self.recognize()
                self.assertEqual(code, 200)
                self.assertEqual(preview["draft"]["maxContainerScu"], 16)
                args = argparse.Namespace(scope="solo", server=self.runtime.url, token="", user_token="",
                                          device_id="test-pc", device_name="PC", settle_seconds=0)
                state = companion.CompanionState(self.root / "capture-state.json")
                companion.process_screenshot(args, state, "tesseract", self.image, lambda *_: None)
                imports = self.api("/api/imports?status=pending")[1]["imports"]
                self.assertEqual(len(imports), index + 1)
                self.assertEqual(imports[0]["draft"], preview["draft"])

    def test_learned_location_alias_applies_to_preview(self):
        with backend.get_connection() as connection:
            location = connection.execute("SELECT location_id FROM locations WHERE name = 'Lorville'").fetchone()
            backend.replace_location_aliases(connection, location["location_id"], ["TestOCRLocation"])
            connection.commit()
        with patch.object(ocr, "resolve_tesseract", return_value="tesseract"), patch.object(
            ocr, "prepare_ocr_crop", return_value=None
        ), patch.object(ocr, "run_ocr", return_value=FIXTURES[0]["text"].replace("Lorville", "TestOCRLocation")):
            code, result = self.recognize()
        self.assertEqual(code, 200)
        self.assertEqual(result["draft"]["consignments"][0]["routes"][0]["dropoff"], "Lorville")
        self.assertTrue(result["locationCorrections"])

    def test_generic_ocr_remains_text_only_for_ship_registration(self):
        with patch.object(ocr, "resolve_tesseract", return_value="tesseract"), patch.object(
            ocr, "run_ocr", return_value="REG-123"
        ), patch.object(service, "read_mission_screenshot") as mission:
            code, result = self.api("/api/ocr", b"image", {"Content-Type": "image/png"})
        self.assertEqual((code, result), (200, {"ok": True, "text": "REG-123"}))
        mission.assert_not_called()

    def test_no_contract_is_a_semantic_failure_not_an_ocr_crash(self):
        with patch.object(ocr, "resolve_tesseract", return_value="tesseract"), patch.object(
            ocr, "prepare_ocr_crop", return_value=None
        ), patch.object(ocr, "run_ocr", return_value="Main menu"):
            code, result = self.recognize()
        self.assertEqual((code, result), (200, {"ok": True, "draft": None}))

    def test_ocr_errors_are_reported_and_upload_is_removed(self):
        for failure, expected in [(subprocess.TimeoutExpired("ocr", 30), 504), (RuntimeError("bad image"), 500)]:
            images = []
            def read(_exe, path):
                images.append(path)
                raise failure
            with self.subTest(status=expected), patch.object(ocr, "resolve_tesseract", return_value="tesseract"), patch.object(
                ocr, "prepare_ocr_crop", return_value=None
            ), patch.object(ocr, "run_ocr", side_effect=read):
                code, result = self.recognize()
            self.assertEqual(code, expected)
            self.assertFalse(result["ok"])
            self.assertTrue(images)
            self.assertTrue(all(not path.exists() for path in images))

    def test_missing_runtime_empty_and_oversized_upload(self):
        with patch.object(ocr, "resolve_tesseract", return_value=None):
            self.assertEqual(self.recognize()[0], 501)
        self.assertEqual(self.api("/api/imports/recognize", b"", {"Content-Type": "image/png"})[0], 400)
        self.assertEqual(self.api("/api/imports/recognize", b"x", {
            "Content-Type": "image/png", "Content-Length": str(9 * 1024 * 1024),
        })[0], 413)


if __name__ == "__main__":
    unittest.main()
