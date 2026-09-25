# Entwickeln und Windows-Ausgabe bauen

Alle Befehle werden in PowerShell im Stammverzeichnis dieses Repositorys ausgeführt.
Getestete Entwicklungsumgebung: Windows x64 und Python 3.14.6.
Für die Fensteranzeige wird Microsoft Edge WebView2 benötigt.
Node.js wird nur für die JavaScript-Tests verwendet.

## Python-Umgebung

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe app.py --no-capture --localhost
```

Dieser Start verwendet die normalen Citizen-Tools-Benutzerdaten.
Für getrennte Testdaten stattdessen starten mit:

```powershell
.\.venv\Scripts\python.exe app.py --no-capture --localhost --port 0 --data-dir .build\dev-data
```

Für OCR eine passende Tesseract-Installation einschließlich `eng` und `deu`
verwenden. `TESSERACT_CMD` kann auf deren `tesseract.exe` zeigen.
Binäre OCR-Laufzeiten und der WebView2-Installer sind nicht im Repository enthalten.

## Automatische Prüfungen

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -p test_solo.py -v
.\.venv\Scripts\python.exe -m unittest discover -s tests -p test_build_windows.py -v
.\.venv\Scripts\python.exe -m unittest discover -s tests -p test_source_archive.py -v
node tests\test_solo_connection.js
node tests\test_solo_sync.js
node tests\test_solo_merge.js
```

Die zusätzlichen Integrationstests in `test_personal_transfer.py` benötigen
eine separat eingerichtete Testumgebung. Ohne deren Voraussetzungen werden
sie übersprungen; die oben aufgeführten Prüfungen laufen eigenständig.
Die Skripte `tools/verify_*.py` öffnen native Testfenster und erwarten ein
eigenes `--data-dir`; dafür keine echten Benutzerdaten verwenden.

## Windows-Pakete

Für einen Installer werden zusätzlich Inno Setup 6 unter seinem üblichen
Installationspfad und der vollständige WebView2-Offline-Installer für x64 benötigt.
Die OCR-Laufzeit muss `tesseract.exe`, ihre benötigten Bibliotheken sowie
`tessdata/eng.traineddata` und `tessdata/deu.traineddata` enthalten.

```powershell
.\.venv\Scripts\python.exe tools\build_windows.py --tesseract-dir "Pfad\zur\OCR-Laufzeit" --webview-installer "Pfad\MicrosoftEdgeWebView2RuntimeInstallerX64.exe" --installer
```

Ergebnisse unter `dist/`:

- `CitizenTools-Solo/`: vollständiger Programmordner.
- `CitizenTools-Solo-Setup.exe`: Installer.
- `CitizenTools-Solo-Portable.zip`: vollständige portable Ausgabe.
- `CitizenTools-Solo-Source.zip`: zugehöriger Projektquellcode.
- `release.json`: Versionsnummer, Größen und SHA-256 der drei Download-Dateien.

Versionen werden in `runtime.py`, `release-notes.json`, den Cache-Versionen
in `web/index.html` und `packaging/CitizenTools-Solo.iss` gepflegt.
Der Build aktualisiert den festen Zielordner und bewahrt dessen vorherigen
Stand unter `.build` auf. Die bisherige App vor dem Ersetzen schließen.
Die erstellten Pakete sind nicht codesigniert.

## Drittanbieter vor einer Veröffentlichung

`tools/prepare_licenses.py` übernimmt Lizenztexte der installierten Python-Pakete
und die Einträge aus `packaging/licenses/registry.json`. Bei Änderungen an der
OCR-Laufzeit müssen auch deren genaue Versionen, Lizenzen, Hinweise und zugehörige
Quellen geprüft und angepasst werden. Derzeitige Inventarliste:
`packaging/licenses/OCR-RUNTIME-NOTICES.txt`.

Die vollständige Herkunft und die zugehörigen Quellen aller bisher verwendeten
OCR-DLLs sind noch nicht dokumentiert. Der Lizenzwechsel des eigenen Codes und
sein Quellcode-ZIP schließen diese Lücke nicht. Die vorhandenen Windows-Pakete
sollten erst nach Klärung dieses Punkts öffentlich bereitgestellt werden.
