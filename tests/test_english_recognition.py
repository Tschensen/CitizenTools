"""English hauling regressions, including OCR from the 2026-10-08 captures."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from companion.app import CompanionState
from shared.mission_import import ocr, service
from shared.mission_import.locations import reconcile_draft_locations
from shared.mission_import.parser import PARSER_VERSION, parse_mission_objectives
from shared.mission_import.text import parse_max_container_scu, parse_refuel_customer

SCREENSHOTS = json.loads((Path(__file__).parent / "fixtures/english-screenshots.json").read_text(encoding="utf-8"))


class EnglishCargoTests(unittest.TestCase):
    def test_delivery_first_keeps_every_destination_and_its_own_pickup(self):
        draft = parse_mission_objectives(
            "PRIMARY OBJECTIVES\nDeliver 0/3 SCU of Stims to Lorville.\nCollect Stims from Area18.\n"
            "Deliver 0/5 SCU of Stims to New Babbage.\nCollect Stims from Baijini Point."
        )
        self.assertEqual(draft["routes"], [
            {"pickup": "Area18", "dropoff": "Lorville", "targetScu": 3},
            {"pickup": "Baijini Point", "dropoff": "New Babbage", "targetScu": 5},
        ])
        self.assertEqual(draft["pickup"], "")

    def test_progress_ocr_digits_and_optional_of(self):
        for quantity in ("15", "0/15", "2 / 15", "O/IS", "15.0", "15,0"):
            for cargo in ("of Titanium", "Titanium", ""):
                with self.subTest(quantity=quantity, cargo=cargo):
                    draft = parse_mission_objectives(
                        f"Deliver {quantity} SCU {cargo} to Lorville\nCollect Titanium from Area18"
                    )
                    self.assertEqual(draft["title"], "Titanium")
                    self.assertEqual(draft["routes"][0]["targetScu"], 15)

    def test_wrapped_cargo_and_locations_preserve_internal_punctuation(self):
        draft = parse_mission_objectives(
            "Deliver 0/10 SCU of Agricultural\nSupplies to Ambitious Dream\n"
            "Station at Crusader's L1 Lagrange point.\n"
            "Collect Agricultural Supplies from HDMS-St. Martin\n"
            "on Hurston.\nReward: 5000 aUEC\nACCEPT OFFER"
        )
        self.assertEqual(draft["title"], "Agricultural Supplies")
        self.assertEqual(draft["routes"][0]["dropoff"], "Ambitious Dream Station at Crusader's L1 Lagrange point")
        self.assertEqual(draft["routes"][0]["pickup"], "HDMS-St. Martin on Hurston")

    def test_multiple_pickups_keep_total_open_for_allocation_in_both_layouts(self):
        delivery = "Deliver 0/13 SCU of Stims to Lorville\n"
        pickups = "Collect Stims from Area18\nCollect Stims from Baijini Point\n"
        for text in (delivery + pickups, pickups + delivery):
            with self.subTest(text=text):
                draft = parse_mission_objectives(text)
                self.assertTrue(draft["allocationRequired"])
                self.assertEqual(draft["consignments"][0]["totalScu"], 13)
                self.assertEqual([route["targetScu"] for route in draft["consignments"][0]["routes"]], [0, 0])

    def test_mixed_cargo_does_not_merge_commodity_quantities(self):
        draft = parse_mission_objectives(
            "Collect Pressurized Ice from Area18\nDeliver 4 SCU to Lorville\n"
            "Collect Processed Food from Baijini Point\nDeliver 7 SCU to New Babbage"
        )
        self.assertEqual([(item["title"], item["totalScu"]) for item in draft["consignments"]],
                         [("Pressurized Ice", 4), ("Processed Food", 7)])

    def test_incomplete_or_unrelated_cargo_is_not_assigned_a_pickup(self):
        for text in (
            "Deliver 8 SCU of Stims to Lorville",
            "Collect Stims from Area18",
            "Collect Titanium from Area18\nDeliver 8 SCU of Hydrogen Fuel to Lorville",
            "Deliver 8 SCU of Quantum Fuel to Lorville\nCollect Hydrogen Fuel from Area18",
            "Collect Stims from Area18\nCollect Titanium from Baijini Point\nDeliver 8 SCU to Lorville",
            "Deliver 0.5 SCU of Stims to Lorville\nCollect Stims from Area18",
            "Deliver 0 SCU of Stims to Lorville\nCollect Stims from Area18",
        ):
            with self.subTest(text=text):
                self.assertIsNone(parse_mission_objectives(text))

    def test_invalid_quantity_does_not_shift_the_following_pickup(self):
        draft = parse_mission_objectives(
            "Deliver 0.5 SCU of Stims to Lorville\nCollect Stims from Area18\n"
            "Deliver 8 SCU of Stims to New Babbage\nCollect Stims from Port Tressler"
        )
        self.assertEqual(draft["routes"], [{"pickup": "Port Tressler", "dropoff": "New Babbage", "targetScu": 8}])

    def test_all_english_container_formats_and_sizes(self):
        for size in (1, 2, 4, 8, 16, 24, 32):
            for text in (
                f"Maximum cargo container size: {size} SCU",
                f"Maximum {size} SCU cargo containers",
                f"Ship capacity:\n{size} SCU SCU",
                f"At most the containers will be {size} SCU in size.",
                f"Containers no bigger than {size} SCU.",
                f"Containers no larger than {size} SCU.",
                f"Containers up to {size} SCU.",
                f"They will be packaged up in containers {size} SCU or smaller.",
                f"It's all cargo {size} SCU or smaller.",
                f"Their ship couldn't handle {size}\nSCU containers.",
                f"A ship capable of transporting {size} SCU cargo containers.",
            ):
                with self.subTest(text=text):
                    self.assertEqual(parse_max_container_scu(text), size)

    def test_english_container_labels_do_not_consume_total_cargo_or_fuel(self):
        for text in (
            "Deliver 0/109 SCU of Aluminum (Ore) to Lorville",
            "Required cargo capacity: 109 SCU",
            "The ship must carry 109 SCU of cargo.",
            "Requesting 7 SCU of Hydrogen Fuel",
            "Maximum container size:\nDeliver 8 SCU to Lorville",
            "Containers no bigger than -8 SCU",
            "Containers no bigger than 0 SCU",
            "Containers no bigger than 0.25 SCU",
        ):
            with self.subTest(text=text):
                self.assertIsNone(parse_max_container_scu(text))
        self.assertEqual(parse_max_container_scu("Ship capacity: 96 SCU\nMaximum container size: 8 SCU"), 8)

    def test_direct_route_prose_recovers_an_obscured_objective_without_using_unrelated_locations(self):
        draft = parse_mission_objectives("Deliver 8 SCU of Stims to Lorville\nCollect Stims from ~~ 3")
        resolved, _ = reconcile_draft_locations(draft, "Cargo haul going from a freight elevator at Area18 to a freight elevator at Lorville.")
        self.assertEqual(resolved["routes"][0]["pickup"], "Area18")
        unresolved, _ = reconcile_draft_locations(draft, "- Freight elevator at Area18\n- Freight elevator at Baijini Point")
        self.assertEqual(unresolved["routes"][0]["pickup"], draft["routes"][0]["pickup"])
        resolved, _ = reconcile_draft_locations(draft, "Cargo haul going from a freight elevator at Area18 to a freight elevator at HDMS-St. Martin on Hurston.")
        self.assertEqual(resolved["routes"][0]["dropoff"], "HDMS-St. Martin on Hurston")

    def test_english_location_list_preserves_known_lagrange_number(self):
        draft = parse_mission_objectives("Collect Stims from Area18\nDeliver 8 SCU to Beautiful Glen Station at Crusader's L5 Lagrange point")
        resolved, _ = reconcile_draft_locations(draft, "- Freight elevator at Beautiful Glen Station at Crusader's LS\nLagrange point")
        self.assertEqual(resolved["routes"][0]["dropoff"], "Beautiful Glen Station at Crusader's L5 Lagrange point")

    def test_contract_customer_is_a_label_not_a_word_in_prose(self):
        self.assertEqual(parse_refuel_customer("As a United Wayfarers Club contractor, you will qualify."), "")
        self.assertEqual(parse_refuel_customer("Contracted By United Wayfarers Club"), "United Wayfarers Club")

    def test_fuel_cargo_does_not_become_a_refuel_service(self):
        draft = parse_mission_objectives("Deliver 7 SCU of Hydrogen Fuel to Lorville\nCollect Hydrogen Fuel from Area18")
        self.assertEqual(draft.get("type", "cargo"), "cargo")

    def test_old_parser_cache_allows_failed_screenshots_to_be_retried(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "state.json"
            path.write_text(json.dumps({"parserVersion": 17, "processed": ["failed-english-image"]}))
            state = CompanionState(path)
            self.assertFalse(state.contains("failed-english-image"))
            state.mark("recognized-image")
            self.assertEqual(json.loads(path.read_text())["parserVersion"], PARSER_VERSION)
            self.assertTrue(CompanionState(path).contains("recognized-image"))


class EnglishScreenshotTests(unittest.TestCase):
    def test_all_ten_real_ocr_samples_keep_mission_totals_and_container_sizes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            image = root / "original.png"
            image.touch()

            def crop(_source, region):
                path = root / (region + ".png")
                path.touch()
                return path

            for sample in SCREENSHOTS:
                with self.subTest(source=sample["source"]), patch.object(ocr, "prepare_ocr_crop", side_effect=crop), patch.object(
                    ocr, "run_ocr", side_effect=lambda _exe, path: sample[path.stem]
                ):
                    draft, error = service.read_mission_screenshot("tesseract", image, lambda *_: None)
                    self.assertIsNone(error)
                    self.assertIsNotNone(draft)
                    expected = sample["expected"]
                    self.assertEqual(draft.get("type", "cargo"), expected["type"])
                    self.assertEqual(draft.get("maxContainerScu"), expected["maxContainerScu"])
                    self.assertEqual(list(root.iterdir()), [image])
                    if expected["type"] == "refuel":
                        details = draft["serviceDetails"]
                        self.assertEqual(details["hydrogenAmount"], 7)
                        self.assertEqual(details["hydrogenRate"], 950)
                        self.assertEqual(details["location"], "a debris field above Daymar")
                        self.assertEqual(details["customer"], "United Wayfarers Club")
                        self.assertEqual(draft["payout"], 20750)
                        continue
                    consignments = draft.get("consignments", [])
                    routes = draft["routes"] + [route for item in consignments for route in item["routes"]]
                    total = sum(item["totalScu"] for item in consignments) if consignments else sum(route["targetScu"] for route in routes)
                    self.assertEqual(len(routes), expected["routeCount"])
                    self.assertEqual(total, expected["totalScu"])
                    self.assertEqual(draft["serviceDetails"]["customer"], "Covalex Independent Contractors")
                    if expected["totalScu"] in (100, 109) and len(routes) == 1:
                        self.assertEqual(routes[0]["pickup"], "Seraphim Station above Crusader")
                    if expected["totalScu"] == 13:
                        self.assertTrue(draft["allocationRequired"])
                        self.assertEqual([route["targetScu"] for route in routes], [0, 0])


if __name__ == "__main__":
    unittest.main()
