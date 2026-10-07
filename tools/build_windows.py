"""Command-line entry point for the Windows build pipeline."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools.build_pipeline import build, parse_args
from tools.build_publish import publish_release


if __name__ == "__main__":
    build(parse_args())
