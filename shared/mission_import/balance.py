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


def read_number(tesseract, image, psm):
    environment = os.environ.copy()
    environment['TESSDATA_PREFIX'] = str(Path(tesseract).resolve().parent / 'tessdata')
    result = subprocess.run([tesseract, str(image), 'stdout', '-l', 'eng', '--psm', str(psm),
                             '-c', 'tessedit_char_whitelist=0123456789,.', 'tsv'],
                            capture_output=True, text=True, encoding='utf-8', errors='replace',
                            timeout=20, env=environment, **hidden_subprocess_options())
    if result.returncode:
        return None
    words = [row for row in csv.DictReader(io.StringIO(result.stdout), delimiter='\t') if row.get('text', '').strip()]
    if len(words) != 1 or float(words[0].get('conf') or -1) < 90:
        return None
    return parse_amount(words[0]['text'])


def read_balance(tesseract, image, handle):
    paths = []
    try:
        context = ocr.prepare_ocr_crop(image, 'balancecontext')
        if context:
            paths.append(context)
        if not context or not handle or not re.search(r'\b' + re.escape(handle) + r'\b', ocr.run_ocr(tesseract, context), re.I):
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
