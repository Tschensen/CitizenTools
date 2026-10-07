"""Publish a complete build transactionally at the stable output path."""
from pathlib import Path


def publish_release(stage: Path, output: Path, names: list[str], *, obsolete=()):
    """Keep the installed path stable; retain the old files for rollback."""
    output.mkdir(parents=True, exist_ok=True)
    previous = stage / 'previous'
    if previous.exists() and any(previous.iterdir()):
        raise RuntimeError('Dieser Build enthält bereits eine vorherige Ausgabe. Bitte einen neuen Build verwenden.')
    previous.mkdir(exist_ok=True)
    backed_up, installed = [], []
    try:
        # Rename on the same volume before installing anything. If Windows
        # locks the running program, its current files remain together.
        for name in dict.fromkeys([*names, *obsolete]):
            destination = output / name
            if destination.exists():
                destination.rename(previous / name)
                backed_up.append(name)
        for name in names:
            (stage / name).rename(output / name)
            installed.append(name)
    except OSError as error:
        for name in reversed(installed):
            (output / name).rename(stage / name)
        for name in reversed(backed_up):
            (previous / name).rename(output / name)
        raise RuntimeError('Ausgabe konnte nicht aktualisiert werden. Citizen Tools und geöffnete Paketdateien schließen und den Build erneut starten. Die bisherige Ausgabe wurde wiederhergestellt.') from error
