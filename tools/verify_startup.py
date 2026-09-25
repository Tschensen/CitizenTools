"""Exercise native startup with a missing script, using isolated test data."""
import argparse
import json
from pathlib import Path
import sys
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import app
from runtime import SoloHandler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir', type=Path, required=True)
    parser.add_argument('--permanent', action='store_true')
    args = parser.parse_args()
    original = SoloHandler.do_GET
    attempts = []

    def fail_script_once(handler):
        if urlparse(handler.path).path == '/scripts/mission-import-ui.js':
            attempts.append(handler.path)
            if args.permanent or len(attempts) == 1:
                # Match a required resource failing to reach the browser.
                handler.send_error(503, 'Simulated startup resource failure')
                return
        original(handler)

    SoloHandler.do_GET = fail_script_once
    sys.argv = ['app.py', '--smoke-window', '--no-capture', '--localhost',
                '--port', '0', '--data-dir', str(args.data_dir)]
    result = app.main()
    report = json.loads((args.data_dir / 'window-result.json').read_text(encoding='utf-8'))
    if args.permanent:
        assert result == 1 and report['startup'] == 'failed', report
        assert len(attempts) == 3, attempts
    else:
        assert result == 0 and report['clicks'] == 21 and not report['errors'], report
        assert len(attempts) == 2 and report['loadErrors'], report
    print(json.dumps({'mode': 'permanent' if args.permanent else 'retry', 'attempts': len(attempts), 'report': report}, ensure_ascii=False))


if __name__ == '__main__': main()
