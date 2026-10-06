# Entwickeln und Windows-Ausgabe bauen

Alle Befehle werden in PowerShell im Stammverzeichnis dieses Repositorys ausgeführt.
Getestete Entwicklungsumgebung: Windows x64 und Python 3.14.6.
Für die Fensteranzeige wird Microsoft Edge WebView2 benötigt.
Node.js wird nur für die JavaScript-Tests verwendet.

## Python-Umgebung

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-build.txt
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
.\.venv\Scripts\python.exe -m unittest discover -s tests -p test_updates.py -v
.\.venv\Scripts\python.exe -m unittest discover -s tests -p test_mission_import.py -v
node tests\test_mission_import.js
node tests\test_import_sounds.js
node tests\test_calendar_date.js
node tests\test_statistics_period.js
```

Die zusätzlichen Integrationstests in `test_personal_transfer.py` benötigen
eine separat eingerichtete Testumgebung. Ohne deren Voraussetzungen werden
sie übersprungen; die oben aufgeführten Prüfungen laufen eigenständig.
Die Skripte `tools/verify_*.py` öffnen native Testfenster und erwarten ein
eigenes `--data-dir`; dafür keine echten Benutzerdaten verwenden.

## Gemeinsame Auftragserkennung

`shared/mission_import/service.py` ist der gemeinsame Screenshot-Einstieg für
Companion und manuellen Upload. `ocr.py` kapselt Tesseract und Bildausschnitte;
`parser.py` wählt die Erkennungsregeln in `cargo.py`, `parcels.py` und
`services.py`. Textfelder, Ortsabgleich und Feldqualität haben eigene Module.
Diese Module kennen weder HTTP noch Datenbank oder Oberfläche. Neue Regeln
gehören hierher und werden mit Beispielen in `tests/fixtures/mission-texts.json`
abgesichert.

`POST /api/imports/recognize` liefert einen Entwurf und gelernte Ortskorrekturen
für die Vorschau, ohne einen Auftrag oder Inbox-Eintrag zu speichern.
Companion-Import und Vorschau verwenden dieselbe Normalisierung und denselben
Ortsabgleich. `POST /api/ocr` liefert weiterhin reinen Text, etwa für
Schiffsregistrierungen. Die HTTP-Tests vergleichen beide Auftragseingänge mit
denselben OCR-Texten; sie benötigen keine installierte OCR-Laufzeit.

`web/scripts/calendar-date.js` enthält die gemeinsamen lokalen Kalendertage
für Buchungen, Formulare und Statistik. Zeitstempel bleiben davon getrennt.
Die Datumstests prüfen Mitternacht, Jahreswechsel und Sommerzeit in mehreren
Zeitzonen. Bereits gespeicherte Buchungstage werden nicht umgeschrieben.

## Windows-Pakete

Für einen Installer werden zusätzlich Inno Setup 6 unter seinem üblichen
Installationspfad und der vollständige WebView2-Offline-Installer für x64 benötigt.
Die festgehaltene OCR-Laufzeit und ihr Quellenarchiv einmal vorbereiten.
Das Skript verwendet bei weiteren Aufrufen vorhandene Downloads aus dem Cache;
mit `--offline` ist keinerlei Netzwerkzugriff möglich.

```powershell
.\.venv\Scripts\python.exe tools\prepare_ocr.py
.\.venv\Scripts\python.exe tools\build_windows.py --tesseract-dir .build\ocr --ocr-sources .build\CitizenTools-Solo-OCR-Sources.zip --webview-installer "Pfad\MicrosoftEdgeWebView2RuntimeInstallerX64.exe" --installer
```

Ergebnisse unter `dist/`:

- `CitizenTools-Solo/`: vollständiger Programmordner.
- `CitizenTools-Solo/CitizenTools-Updater.exe`: separater Updater, der außerhalb des Programmordners auf das Ende der App wartet.
- `CitizenTools-Solo/installation.json`: Versions- und Dateiliste für die überprüfte portable Aktualisierung.
- `CitizenTools-Solo-Setup.exe`: Installer.
- `CitizenTools-Solo-Portable.zip`: vollständige portable Ausgabe.
- `CitizenTools-Solo-Source.zip`: zugehöriger Projektquellcode.
- `CitizenTools-Solo-OCR-Sources.zip`: Quellen, Patches und Build-Rezepte der OCR-Komponenten.
- `release.json`, `SHA256SUMS.txt`: Version, Größen und SHA-256 der vier Download-Dateien.
- `RELEASE-NOTES.md`: Versionsverlauf.

Versionen werden in `runtime.py`, `release-notes.json`, den Cache-Versionen
in `web/index.html` und `packaging/CitizenTools-Solo.iss` gepflegt.
Der Build aktualisiert den festen Zielordner und bewahrt dessen vorherigen
Stand unter `.build` auf. Die bisherige App vor dem Ersetzen schließen.
Die erstellten Pakete sind nicht codesigniert.

## Veröffentlichung

Installer, Portable-ZIP und **beide** Quellpakete zusammen in dasselbe GitHub-Release
hochladen; Prüfsummen und Versionshinweise ebenfalls beilegen. Die großen
Binär- und OCR-Quellpakete sind Release-Anhänge und gehören nicht ins Git-Repository.
Den aktuellen Projektcode vor dem Anlegen des Release-Tags committen und pushen.

Der Updater fragt ausschließlich das neueste öffentliche stabile Release von `Tschensen/CitizenTools` ab. Verwende einen Tag wie `v0.3.0`, passend zu `runtime.py`. Entwürfe und Vorabversionen werden nicht installiert. Alle Dateien erst an einen Entwurf anhängen und danach veröffentlichen, damit niemand ein unvollständiges Update angeboten bekommt.

Die Dateinamen müssen unverändert bleiben. `release.json` enthält zusätzlich den zweisprachigen Versionsverlauf; daraus zeigt der Updater alle Änderungen seit der installierten Version. Für alte Manifeste verwendet er den GitHub-Release-Text. Kein GitHub-Token wird benötigt oder mitgeliefert. Prüfsummen werden vor der Übergabe an den separaten Updater und dort erneut geprüft.

`tools/verify_updates.py --data-dir <leerer-Testordner>` prüft die Oberfläche mit lokalen Test-Releases ohne Netzwerk oder Installation. `tools/verify_update_helper.py --helper <CitizenTools-Updater.exe> --data-dir <leerer-Testordner>` prüft den gebauten Updater mit getrennten Miniaturpaketen einschließlich Warten auf das Programmende und Neustart.

## Drittanbieter

`tools/prepare_licenses.py` übernimmt Lizenztexte der installierten Python-Pakete
und die Einträge aus `packaging/licenses/registry.json`. Bei Änderungen an der
OCR-Laufzeit müssen auch deren genaue Versionen, Lizenzen, Hinweise und zugehörige
Quellen geprüft und angepasst werden. Derzeitige Inventarliste:
`packaging/licenses/OCR-RUNTIME-NOTICES.txt`.

`packaging/ocr-lock.json` hält die verwendeten MSYS2-Pakete und alle ausgelieferten
OCR-Dateien mit SHA-256 fest. Der Build lehnt abweichende Laufzeiten und unpassende
Quellpakete ab. Einzelheiten und Anleitungen zum Neubau einzelner Komponenten:
[OCR-SOURCES.md](OCR-SOURCES.md). Python-Paketversionen des Release-Builds stehen
in `requirements-build.txt`; die enthaltenen Lizenztexte stammen aus diesen Paketen.
