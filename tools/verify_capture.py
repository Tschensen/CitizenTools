"""Explicit OCR/worker check with isolated data; does not take a screenshot."""
import argparse
import json
import os
from pathlib import Path
import sys
import tempfile
import time
from urllib import request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from runtime import SoloRuntime


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--tesseract', required=True)
    parser.add_argument('--image', type=Path, required=True)
    parser.add_argument('--expect', default='Titanium')
    args = parser.parse_args()
    os.environ['TESSERACT_CMD'] = str(Path(args.tesseract).resolve())
    with tempfile.TemporaryDirectory(prefix='citizen-solo-capture-') as folder:
        runtime = SoloRuntime(Path(folder), port=0, lan=False)
        try:
            runtime.start()
            deadline = time.monotonic() + 15
            while not runtime.capture_ready and not runtime.capture_error and time.monotonic() < deadline:
                time.sleep(.1)
            if not runtime.capture_ready: raise RuntimeError(runtime.capture_error or 'Capture worker did not become ready')
            req = request.Request(runtime.url+'/api/ocr', data=args.image.read_bytes(), headers={'Content-Type':'image/png'})
            with request.urlopen(req, timeout=30) as response: payload = json.load(response)
            if args.expect not in payload.get('text',''): raise AssertionError(payload)
            runtime.stop_capture()
            assert not runtime.status()['captureRunning']
            assert not list((Path(folder)/'Captures').glob('*'))
            print('Capture worker start/stop and HTTP OCR passed; no desktop screenshot taken.')
        finally: runtime.stop()


if __name__ == '__main__': main()
