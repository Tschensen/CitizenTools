"""Run the app against isolated preview data; no capture or production data."""
import argparse
from pathlib import Path
import sys
import threading

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from runtime import SoloRuntime

parser = argparse.ArgumentParser()
parser.add_argument('--data-dir', type=Path, required=True)
parser.add_argument('--port', type=int, default=0)
parser.add_argument('--stay', action='store_true')
args = parser.parse_args()
runtime = SoloRuntime(args.data_dir, port=args.port, lan=False)
runtime.start(capture_enabled=False)
print(runtime.url, flush=True)
try:
    if args.stay:
        threading.Event().wait()
    else:
        sys.stdin.read()
except KeyboardInterrupt:
    pass
finally:
    runtime.stop()
