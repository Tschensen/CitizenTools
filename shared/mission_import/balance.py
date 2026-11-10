"""Conservative mobiGlas balance reading; never interprets contract rewards."""
from __future__ import annotations

import csv
import io
import os
import re
import subprocess
from pathlib import Path

from . import ocr
from shared.processes import hidden_subprocess_options


def parse_amount(text):
    text = text.strip()
    if not re.fullmatch(r'(?:\d{1,3}(?:,\d{3})+|\d{1,3}(?:\.\d{3})+|\d{1,12})', text):
        return None
    amount = int(text.replace(',', '').replace('.', ''))
    return amount if amount <= 999_999_999_999 else None


def read_number(tesseract, image, psm, *, refine=True):
    environment = os.environ.copy()
    environment['TESSDATA_PREFIX'] = str(Path(tesseract).resolve().parent / 'tessdata')
    # Set the output variable directly: the bundled runtime has traineddata,
    # but not Tesseract's optional "tsv" config file. A digit whitelist also
    # joins the currency glyph to the amount, producing a false leading digit.
    result = subprocess.run([tesseract, str(image), 'stdout', '-l', 'eng', '--psm', str(psm),
                             '-c', 'tessedit_create_tsv=1'],
                            capture_output=True, text=True, encoding='utf-8', errors='replace',
                            timeout=20, env=environment, **hidden_subprocess_options())
    if result.returncode:
        return None
    words = [row for row in csv.DictReader(io.StringIO(result.stdout), delimiter='\t') if row.get('text', '').strip()]
    def is_number_row(amount):
        if parse_amount(amount['text']) is None:
            return False
        # Only a small, uncertain, clearly separated currency glyph may precede
        # the number. Never drop another number or join separate digit groups.
        for row in words:
            if row is amount:
                continue
            height = float(amount.get('height') or 0)
            gap = float(amount.get('left') or 0) - float(row.get('left') or 0) - float(row.get('width') or 0)
            if height <= 0 or float(row.get('conf') or -1) >= 90 or len(row['text'].strip()) != 1 \
                    or float(row.get('width') or 0) > height * .65 or gap < height * .25:
                return False
        return True
    candidates = [row for row in words if is_number_row(row)]
    if len(candidates) != 1:
        return None
    amount = candidates[0]
    expected = parse_amount(amount['text'])
    if float(amount.get('conf') or -1) >= 90:
        return expected
    if not refine:
        return None
    # Isolate the detected number and give it a clean margin. It still has to
    # match the original reading with high confidence; uncertainty is no value.
    rectangle = tuple(int(amount.get(key) or 0) for key in ('left','top','width','height'))
    crop = ocr.prepare_ocr_crop(image, 'balanceword', rectangle=rectangle)
    if not crop:
        return None
    try:
        confirmed = read_number(tesseract, crop, psm, refine=False)
        return confirmed if confirmed == expected else None
    finally:
        crop.unlink(missing_ok=True)


def read_balance(tesseract, image, username):
    paths = []
    try:
        context = ocr.prepare_ocr_crop(image, 'balancecontext')
        if context:
            paths.append(context)
        if not context or not username or not re.search(r'(?<![\w-])' + re.escape(username) + r'(?![\w-])', ocr.run_ocr(tesseract, context), re.I):
            return None
        amount = ocr.prepare_ocr_crop(image, 'balance')
        if not amount:
            return None
        paths.append(amount)
        readings = [read_number(tesseract, amount, psm) for psm in (6, 7, 13)]
        # Block and line segmentation must agree at high confidence. Raw-line
        # segmentation may fail on HUD graphics; any confident disagreement vetoes.
        return readings[0] if readings[0] is not None and readings[0] == readings[1] \
            and readings[2] in (None, readings[0]) else None
    finally:
        for path in paths:
            path.unlink(missing_ok=True)
