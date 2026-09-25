# OCR-Laufzeit und zugehörige Quellen

Citizen Tools 0.1.23 verwendet Tesseract 5.5.3 und Leptonica 1.87.0 aus der
MSYS2-UCRT64-Distribution. Die EXE und DLLs sind unveränderte Auszüge der in
`packaging/ocr-lock.json` festgehaltenen Pakete. Die Lockdatei enthält deren
Versionen, Downloadadressen und SHA-256-Prüfsummen sowie die Zuordnung aller
ausgelieferten OCR-Dateien. Windows-Systembibliotheken sind nicht enthalten.

`CitizenTools-Solo-OCR-Sources.zip` wird neben Installer, Portable-ZIP und
`CitizenTools-Solo-Source.zip` im selben Release bereitgestellt:
https://github.com/Tschensen/CitizenTools/releases
Beim Weitergeben der Binärpakete auch diese beiden Quellpakete anbieten.
Zum normalen Benutzen der App werden die Quellpakete nicht benötigt.

## Inhalt des OCR-Quellpakets

- `sources/`: vollständige MSYS2-Quellarchive für die verwendeten nativen
  Komponenten, einschließlich Originalquellen, Patches, `PKGBUILD` und `.SRCINFO`.
  Mehrere GCC-Laufzeitbibliotheken teilen dasselbe GCC-Quellarchiv.
- `package-metadata/`: originale `.PKGINFO` und `.BUILDINFO` der Binärpakete.
  Letztere dokumentieren Buildumgebung, Abhängigkeiten und den Hash des jeweiligen
  Buildrezepts. Die mitgelieferten Rezepte passen zu diesen Hashes.
- `language-data/`: originale MSYS2-Pakete der englischen und deutschen
  Tesseract-Sprachmodelle (Apache-2.0). Dies sind trainierte Modelle, kein
  vollständiges Trainingskorpus. Weitere Modelle werden nicht ausgeliefert.
- `ocr-lock.json`: unveränderte Kopie der Lockdatei aus dem Projektquellcode.

Das winpthreads-Quellarchiv enthält das originale Git-Repository einschließlich
des im Buildrezept ausgewählten Commits. JBIG-KIT erlaubt laut den Original-
Quellkopfzeilen GPL Version 2 oder später; für diese Kombination wird GPLv3
verwendet. GNU-Laufzeitbibliotheken enthalten ihre GCC Runtime Library Exception.
Alle Original-Lizenztexte sind zusätzlich im Programm abrufbar.

## Vorhandene Binärpakete zusammenstellen

Im Stammverzeichnis des Citizen-Tools-Quellcodes mit Python 3.14:

```powershell
python tools/prepare_ocr.py
```

Die Pakete werden einmal nach `.build/ocr-cache` geladen und anhand ihrer
Prüfsummen geprüft. Weitere Aufrufe verwenden den Cache. `--offline` verhindert
jeden Download. `--cache`, `--output` und `--sources` erlauben andere Zielpfade.
Die Laufzeit liegt danach unter `.build/ocr`, das Quellen-ZIP unter `.build`.
Für die Verwendung eines bereits heruntergeladenen Quellen-ZIPs dessen
`sources/` und `language-data/` nach `ocr-cache/sources/` bzw.
`ocr-cache/packages/` kopieren; fehlende Binärpakete lädt das Skript bei Bedarf.

## Komponenten selbst kompilieren

[MSYS2 mit UCRT64-Buildumgebung](https://www.msys2.org/wiki/Creating-Packages/)
verwenden. Das gewünschte `.src.tar.zst` in ein
eigenes Arbeitsverzeichnis entpacken, in dessen Paketverzeichnis wechseln und
das enthaltene `PKGBUILD` mit `MINGW_ARCH=ucrt64 makepkg-mingw -s` ausführen.
Das Rezept beschreibt alle Quellversionen, Patches, Konfigurationsoptionen und
Installationsschritte. Benötigte Werkzeuge und Bibliotheken sind in `.SRCINFO`
aufgeführt; die ursprünglichen Build-Versionen stehen in `.BUILDINFO`.
Systemeinrichtung und fehlende Buildabhängigkeiten können Downloads benötigen.
Bitidentische Neubauten in einer inzwischen aktualisierten Umgebung sind damit
nicht zugesichert. Ein eigener Neuaufbau aller Bibliotheken wurde nicht getestet.

Die DLLs werden dynamisch aus `_internal/ocr` geladen und sind austauschbar.
Die App prüft zur Laufzeit keine Hersteller-Signatur oder Datei-Hashes.
Der Release-Build prüft dagegen die Lockdatei, damit versehentlich gemischte
oder veraltete Bibliotheken nicht in eine Veröffentlichung gelangen.
