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
node tests\test_state_services.js
node tests\test_solo_merge.js
.\.venv\Scripts\python.exe -m unittest discover -s tests -p test_updates.py -v
.\.venv\Scripts\python.exe -m unittest discover -s tests -p test_mission_import.py -v
node tests\test_mission_import.js
node tests\test_import_sounds.js
node tests\test_calendar_date.js
node tests\test_statistics_period.js
node tests\test_mission_cargo_edit.js
node tests\test_mission_submit.js
node tests\test_view_renderer.js
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

## Zustand, Speichern und Synchronisation

Die SQLite-Datenbank auf dem PC bleibt der gemeinsame Datenstand. Jede Ansicht
bindet dieselben Dienste ein; ein passives weiteres Gerät schreibt beim Abrufen
keinen Zustand zurück. Der Browser-Cache dient dem Start und der Wiederherstellung.

- `web/scripts/state-storage.js`: Browser-Cache und Wiederherstellungskopien;
  bei nicht verfügbarem Speicher bleibt die Kopie für die laufende Sitzung im RAM.
- `web/scripts/state-store.js`: Zustandskopien, Bereinigung und Normalisierung
  über übergebene Adapter, ohne HTTP oder Oberfläche.
- `web/scripts/state-api.js`: HTTP-Anfragen mit Zeitlimit, Versionsprüfung und
  Prüfung des Antwortformats; verändert selbst keinen Zustand.
- `web/scripts/state-sync.js`: besitzt Revision, Schreibwarteschlange und
  laufende Lese-/Importvorgänge. Verspätete Antworten dürfen neuere Änderungen
  nicht ersetzen. Unabhängige Änderungen werden über `solo-merge.js` vereinigt.
- `web/scripts/solo-sync.js`: verbindet diese Dienste mit der Oberfläche und
  startet das Polling. `state-persistence.js` enthält die bisherigen Einstiege
  `loadState()` und `persist()`, ohne eine zweite Synchronisationsimplementierung.
- `web/scripts/state-normalization.js`: bestehende Datenmigration und
  Platzierungsprüfung; `state-status-ui.js`: Verbindungsanzeige und Konflikthinweis.

Oberflächenänderungen werden weiter mit `persist()` angemeldet. Hintergrundabrufe
laufen über `getSoloSync().refresh()`, sofortiges Speichern über `flush()`.
`status` ist eine schreibgeschützte Momentaufnahme; Revisionen und Sperren dürfen
nicht von Auftragsimport, Updateanzeige oder anderen Ansichten gesetzt werden.
Nach einem externen Wiederherstellen lädt `reset()` den neuen Serverstand und
verwirft Antworten aus der vorherigen Sitzung. Der Auftragsimport verwendet
`checkpoint()`/`canApply()` gegen zwischenzeitliche Änderungen und `commitImports()`
für die atomare Speicherung von Zustand und Inbox-Bestätigung.

Die vorhandenen Ansichten arbeiten noch mit dem gemeinsamen `state`-Objekt.
Der Store kapselt den Zugriff für die Dienste; die Formular- und Fachlogik wird
dadurch nicht vollständig neu geschrieben. Zusätzliche Hintergrundschreiber
sollen ausschließlich den Synchronisationsdienst verwenden.

`test_solo_sync.js` prüft unter anderem verspätete Antworten, parallele Änderungen,
Netzausfälle, Wiederherstellung und atomare Importe. `test_state_services.js` prüft
Transport, Cache und Store unabhängig von DOM und Server. Für die vollständige
Windows-Oberfläche mit getrennten Testdaten:

```powershell
.\.venv\Scripts\python.exe app.py --smoke-window --no-capture --localhost --port 0 --data-dir .build\sync-smoke
.\.venv\Scripts\python.exe tools\verify_route_sync.py --data-dir .build\sync-route
.\.venv\Scripts\python.exe tools\verify_shared_state.py --data-dir .build\sync-shared --state-fixture <synthetischer-Testzustand.json>
.\.venv\Scripts\python.exe tools\verify_version_reload.py --data-dir .build\sync-version
```

Für jeden Durchlauf einen neuen Testordner verwenden. Der gemeinsame Zustands-Test
benötigt einen synthetischen Zustand mit einem aktiven Frachtauftrag und Schiff;
keine persönlichen Daten als Fixture verwenden.

## Aufträge, Ladung und Ansichten

`cargo-ui.js` ist nur noch der gemeinsame Einstieg für Beschriftungen und die
einmalige Registrierung der Ereignisse. Die Funktionen sind nach Verantwortung
aufgeteilt; alle Skripte werden durch `web/index.html` und den vorhandenen Loader
in fester Reihenfolge eingebunden. Es ist kein zusätzlicher Bundler erforderlich.

| Bereich | Dateien unter `web/scripts/` | Verantwortung |
| --- | --- | --- |
| Fracht bearbeiten | `mission-cargo-edit.js` | Übernimmt vorhandenen Fortschritt, schützt verladene/gelieferte Container und erzeugt neue Ladungen über übergebene Abhängigkeiten. Ohne DOM und Speicherung direkt testbar. |
| Auftragseingabe | `mission-form-ui.js`, `mission-service-form-ui.js`, `mission-cargo-form-ui.js`, `mission-quality-ui.js` | Formularzustand, dynamische Eingabezeilen und Prüfmarkierungen. |
| Auftrag speichern | `mission-submit-ui.js` | Liest gemeinsame Felder einmal, validiert je Auftragstyp und führt den gemeinsamen Abschluss mit Speichern und Seitenwechsel aus. |
| Auftragsaktionen | `mission-actions.js` | Ändern, Löschen, Abschließen und Bezahlen. `saveMissionEntry()` erhält Formularauswahl und Importqualität als Parameter. |
| Auftragsdarstellung | `mission-list-ui.js`, `mission-assignment-ui.js`, `mission-service-view-ui.js` | Karten, Gruppen, Zuordnungen und Dienstleistungsdetails. |
| Ladung | `cargo-overview-ui.js`, `cargo-layout-ui.js`, `cargo-grid-ui.js` | Übersicht, Manifest, Layouteingabe sowie bestehende Rasterdarstellung und Platzierungsaktionen. |
| Flugplanung | `run-route-state.js`, `run-mode-ui.js` | Routen-/Fortschrittszustand getrennt von Cockpitdarstellung und Benutzeraktionen. |
| Weitere Ansichten | `hub-ui.js`, `location-picker-ui.js`, `app-navigation.js` | Startseite, gemeinsame Ortsauswahl und Navigation. |

`mission-domain.js` enthält die Auftragsregeln und Bereitschaftsprüfungen;
Dialoge für Abschluss und Zahlung sowie die Dienstleistungskarten liegen in den
Aktions- bzw. Darstellungsdateien. Die bestehenden UI-Adapter verwenden weiterhin
den gemeinsamen Anwendungszustand und die bisherigen Funktionsnamen. Die
Aufteilung ist kein vollständiger Wechsel zu ES-Modulen oder unveränderlichen
Zustandsobjekten.

`view-renderer.js` verwaltet die Aktualisierung unabhängig vom DOM. Der Adapter
`app-render.js` ordnet die sichtbaren Seiten den Darstellungsfunktionen zu:

- `render()` aktualisiert gemeinsame Bedienelemente, markiert Ansichten als
  veraltet und zeichnet die sichtbaren Bereiche neu.
- `persist()` markiert Ansichten ebenfalls als veraltet. Das deckt Aktionen ab,
  die direkt speichern und anschließend navigieren, ohne `render()` aufzurufen.
- `setActivePage()` aktualisiert Navigation und Zielansicht. Versteckte Bereiche
  werden erst beim Öffnen aufgebaut. Beim Wiederbetreten werden auch zeitabhängige
  Angaben wie „Heute“ neu berechnet.
- Raster und isometrische Darstellung werden zwischen `home`, `overview` und
  `load` geteilt. Ihre Vorschauen kopieren dieselbe aktuelle Darstellung.
- Die Formularinhalte werden beim Navigieren nicht zurückgesetzt.

Neue Ansichten in `app-render.js` registrieren und ihre Ereignisse im jeweiligen
UI-Modul bündeln. Neue fachliche Regeln möglichst mit Daten und expliziten
Abhängigkeiten implementieren, damit sie ohne gestartete Oberfläche testbar sind.

`test_mission_cargo_edit.js` prüft Frachtidentität, Fortschrittsschutz und
Routenkorrekturen. `test_mission_submit.js` deckt Anlegen und Bearbeiten aller neun
Auftragstypen sowie Validierung und Abbruch ab. `test_view_renderer.js` prüft
verzögerte Aktualisierung, gemeinsame Ansichten und Fehlerwiederholung.

```powershell
.\.venv\Scripts\python.exe tools\verify_views.py --data-dir .build\views-test
```

Dieser native Test erzeugt seine Fracht- und Schiffsdaten selbst. Er zählt
Darstellungsaufrufe, prüft alle Seiten und nutzt die echten Formulare. Er misst
keine allgemeine Beschleunigung in Millisekunden. Routen- und Mehrgeräteprüfungen
aus dem vorigen Abschnitt zusätzlich ausführen, wenn ihre Module geändert werden.

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
