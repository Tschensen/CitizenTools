"""Custom profile areas and mission bindings survive portable data transfer."""
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import transfer


class CargoAreaTransferTests(unittest.TestCase):
    def test_export_parse_merge_preserves_area_order_and_profile_binding(self):
        state = {
            'shipLibrary': [{'id': 'custom-ship', 'manufacturer': 'Test', 'model': 'Freighter',
                             'gridHeights': {'A1': 2, 'A2': 2}, 'cargoAreas': [
                                 {'id': 'rear', 'name': 'Reserve', 'color': '#ef899d', 'slots': ['A2']},
                                 {'id': 'front', 'name': 'Vorne', 'color': '#58bde8', 'slots': ['A1']},
                             ]}],
            'fleet': [{'id': 'fleet-test', 'shipId': 'custom-ship', 'manufacturer': 'Test',
                       'model': 'Freighter', 'acquiredOn': '2026-09-01'}],
            'missions': [{'id': '54c86cfa-aa2a-4209-9a4a-7dcba37c3180', 'title': 'Fracht',
                          'assignedFleetEntryId': 'fleet-test', 'autoloadArea': 'all',
                          'autoloadAreaId': 'rear', 'autoloadAreaShipId': 'custom-ship'}],
            'ledgerEntries': [], 'contacts': [], 'autoload': {'fillOrder': 'areas'},
        }
        with tempfile.TemporaryDirectory() as directory:
            exported = transfer.export(state, Path(directory))
        incoming, images = transfer.parse(json.loads(json.dumps(exported)))
        self.assertEqual(images, {})
        for mode in ('merge', 'replace'):
            result = transfer.merge({}, incoming, mode)
            self.assertEqual(result['shipLibrary'], state['shipLibrary'])
            self.assertEqual(result['missions'], state['missions'])
            self.assertEqual(result['autoload'], state['autoload'])


if __name__ == '__main__':
    unittest.main()
