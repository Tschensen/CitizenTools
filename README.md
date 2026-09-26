# Citizen Tools · Flight Deck

Eine Windows-App für Star-Citizen-Solospieler: Aufträge, Fracht, Routen und
Screenshot-Erkennung in einer gemeinsamen Oberfläche. Zusätzliche Geräte im
Heimnetz greifen per Browser auf denselben Spielstand zu.

**Ursprüngliches Projekt:** [Tschensen](https://github.com/Tschensen)  
**Quellcode-Stand:** 0.1.25 · **Lizenz:** GPLv3 oder später

## Funktionen

- Aufträge anlegen, bearbeiten und aus Screenshots per OCR übernehmen.
- Fracht und Verladung mit Cargo-Grids planen.
- Routen, nächste Ziele und Fortschritt verfolgen.
- Flotte, Schiffsdaten, Finanzen und Statistiken verwalten.
- Statistik nach Zeitraum filtern und gebuchte Einnahmen, Ausgaben und Betriebsergebnis im Diagramm verfolgen.
- Interface-Sounds und Akzentfarbe individuell einstellen.
- Auf PC, Tablet und anderen Geräten im Heimnetz denselben Stand bearbeiten.
- Daten sichern sowie persönliche Daten als Datei exportieren und importieren.

Windows-App, lokaler Server und Screenshot-Companion starten gemeinsam. Keine Internetverbindung erforderlich!

## Windows verwenden

Zielplattform: Windows 10/11, 64 Bit. Fertige Downloads gehören in den
[Releases-Bereich](https://github.com/Tschensen/CitizenTools/releases).
Eine EXE benötigt den zugehörigen Ordner `_internal`; für die portable Nutzung
immer das vollständige ZIP entpacken.

Für die Installation `CitizenTools-Solo-Setup.exe` verwenden; für die portable
Nutzung `CitizenTools-Solo-Portable.zip`. Die beiden Quellpakete im Release
enthalten den Projektcode und die zugehörigen OCR-Quellen. Zum Benutzen der App
werden sie nicht benötigt. Details stehen in [NOTICE.md](NOTICE.md).

## Heimnetz

Die Windows-App auf dem PC starten. Unter **Einstellungen → Companion** steht
die Adresse für den Browser der weiteren Geräte. Der PC muss eingeschaltet sein
und die App muss laufen. Die Geräte bearbeiten denselben Spielstand. Es gibt
kein Kontensystem; die Freigabe ist für das eigene, vertrauenswürdige Heimnetz gedacht.

## Entwickeln und selbst bauen

Siehe [Build-Anleitung](docs/BUILD.md) für Python-Umgebung, Tests, OCR und Windows-Build.
Die [Bedienungsanleitung](docs/ANLEITUNG.md) beschreibt Funktionen, Einstellungen und Datensicherung.
Der [Versionsverlauf](CHANGELOG.md) enthält auch die bisherigen internen Entwicklungsstände.

| Ordner / Datei | Inhalt |
| --- | --- |
| `app.py`, `runtime.py` | Windows-App und lokaler Server |
| `web/` | Oberfläche, Übersetzungen, Grafiken und Standardtöne |
| `companion/` | Screenshot-Erfassung und OCR-Anbindung |
| `server/`, `shared/` | Datenbank, lokale API und gemeinsame Hilfsfunktionen |
| `tools/`, `packaging/` | Build-Skripte, Installer und Lizenztexte |
| `tests/` | Automatische Prüfungen |
| `release-notes.json`, `project.json` | Versionsverlauf und Projektangaben |

Spielstände, Zugangsdaten, Screenshots, Python-Umgebungen und fertige
Build-Ergebnisse gehören nicht in das Quellcode-Repository. Die `.gitignore`
berücksichtigt die üblichen lokalen Dateien.

## Lizenz und Herkunft

Copyright (c) 2026 Tschensen and Citizen Tools contributors.
Der eigene Code steht unter **GNU GPL Version 3 oder jeder späteren Version**
(`GPL-3.0-or-later`). Nutzung, Änderungen und Weitergabe sind auch kommerziell
erlaubt. Copyright- und Lizenzhinweise bleiben erhalten; bei Weitergabe gelten
die GPL-Bedingungen einschließlich Kennzeichnung von Änderungen und Bereitstellung
des zugehörigen Quellcodes. Vollständiger Lizenztext: [LICENSE](LICENSE).

Zusatzkomponenten, Marken und Spielinhalte behalten ihre eigenen Bedingungen:
[NOTICE.md](NOTICE.md), [Lizenztexte](packaging/licenses/).
Citizen Tools ist ein unabhängiges Fanprojekt ohne offizielle Zugehörigkeit zu
Cloud Imperium Games oder Roberts Space Industries.
