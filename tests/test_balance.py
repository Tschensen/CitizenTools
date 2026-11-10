"""Balance OCR confidence, ambiguous amounts and shared screenshot processing."""
import argparse
import csv
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from companion import app as companion
from shared.mission_import import balance, ocr, service


def tsv(*words):
    output = io.StringIO()
    writer = csv.writer(output, delimiter='\t')
    writer.writerow(['text','conf','left','top','width','height'])
    writer.writerows(words)
    return Mock(returncode=0, stdout=output.getvalue())


class BalanceNumberTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.image = Path(self.temp.name) / 'amount.png'
        self.image.touch()

    def test_bundled_runtime_without_tsv_config_still_provides_confidence(self):
        def run(command, **options):
            # The standalone config name produces plain text in our minimal bundle.
            return tsv(('4,527,079',96,40,10,355,70)) if 'tessedit_create_tsv=1' in command else Mock(returncode=0,stdout='4,527,079\n')
        with patch.object(balance.subprocess,'run',side_effect=run):
            self.assertEqual(balance.read_number('tesseract',self.image,6),4527079)

    def test_uncertain_currency_glyph_is_separate_but_extra_numbers_are_rejected(self):
        amount=('4,527,079',96,80,10,355,70)
        cases=[([amount],4527079), ([('0',96,40,10,35,70)],0),
               ([('4',40,0,10,20,40),amount],4527079),
               ([('4',96,0,10,20,40),amount],None),
               ([('4',40,50,10,20,40),amount],None),
               ([('50,250',98,0,10,60,70),amount],None),
               ([('Belohnung',95,0,10,60,70),amount],None)]
        for rows,expected in cases:
            with self.subTest(rows=rows), patch.object(balance.subprocess,'run',return_value=tsv(*rows)):
                self.assertEqual(balance.read_number('tesseract',self.image,6),expected)

    def test_tight_crop_requires_same_value_at_high_confidence_and_is_cleaned(self):
        for text,confidence,expected in [('4,447,829',96,4447829),('4,447,829',65,None),('4,447,879',96,None)]:
            crop=Path(self.temp.name)/'word.png'; crop.touch()
            with self.subTest(text=text,confidence=confidence), \
                    patch.object(balance.subprocess,'run',side_effect=[tsv(('4,447,829',43,24,59,395,68)),tsv((text,confidence,24,24,355,70))]), \
                    patch.object(ocr,'prepare_ocr_crop',return_value=crop) as prepare:
                self.assertEqual(balance.read_number('tesseract',self.image,6),expected)
                prepare.assert_called_once_with(self.image,'balanceword',rectangle=(24,59,395,68))
                self.assertFalse(crop.exists())

    def test_other_username_with_matching_prefix_is_not_the_same_player(self):
        for username in ['Pilot-Other','Pilot_Other','OtherPilot','Pilot2']:
            with self.subTest(username=username), patch.object(ocr,'prepare_ocr_crop',return_value=self.image), \
                    patch.object(ocr,'run_ocr',return_value=username), patch.object(balance,'read_number') as number:
                self.assertIsNone(balance.read_balance('tesseract',self.image,'Pilot'))
                number.assert_not_called()


class ScreenshotBalanceTests(unittest.TestCase):
    def test_one_capture_reads_contract_and_balance_and_balance_only_creates_no_import(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            args=argparse.Namespace(settle_seconds=0,scope='solo',server='http://localhost',token='',user_token='',
                device_id='pc',device_name='PC',pilot_name='Pilot',balance_observer=Mock(return_value=True))
            state=companion.CompanionState(root/'state.json')
            for index,draft in enumerate([{'title':'Cargo'},None]):
                image=root/f'capture-{index}.png'; image.write_bytes(str(index).encode())
                progress=Mock()
                with patch.object(service,'read_mission_screenshot',return_value=(draft,None)), \
                        patch.object(companion,'submit_import',return_value={'id':'import','scope':'solo'}) as submit:
                    companion.process_screenshot(args,state,'tesseract',image,Mock(),job_id='job',report_progress=progress)
                    args.balance_observer.assert_called_with('tesseract',image)
                    self.assertEqual(submit.call_count,1 if draft else 0)
                    self.assertEqual(progress.call_args.args,('job','completed'))
                    self.assertIn('Kontostand erkannt',progress.call_args.kwargs['message'])
                    calls=args.balance_observer.call_count
                    companion.process_screenshot(args,state,'tesseract',image,Mock())
                    self.assertEqual(args.balance_observer.call_count,calls)

    def test_failed_balance_ocr_does_not_prevent_contract_import(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder); image=root/'capture.png'; image.touch()
            args=argparse.Namespace(settle_seconds=0,scope='solo',server='http://localhost',token='',user_token='',
                device_id='pc',device_name='PC',pilot_name='Pilot',balance_observer=Mock(side_effect=RuntimeError('OCR failed')))
            with patch.object(service,'read_mission_screenshot',return_value=({'title':'Cargo'},None)), \
                    patch.object(companion,'submit_import',return_value={'id':'import','scope':'solo'}) as submit:
                companion.process_screenshot(args,companion.CompanionState(root/'state.json'),'tesseract',image,Mock())
                submit.assert_called_once()


if __name__ == '__main__': unittest.main()
