# Citizen Tools · Flight Deck

Eine Windows-App für Star Citizen: Aufträge, Fracht, Routen und
Screenshot-Erkennung in einer gemeinsamen Oberfläche. Zusätzliche Geräte im
Heimnetz greifen per Browser auf denselben Spielstand zu.

**Ursprüngliches Projekt:** [Tschensen](https://github.com/Tschensen)  
**Quellcode-Stand:** 0.4.0 · **Lizenz:** GPLv3 oder später

## Funktionen

- Aufträge anlegen, bearbeiten und aus Screenshots per OCR übernehmen.
- Fracht mit Cargo-Grids planen, eigene Ladebereiche festlegen und Aufträge gezielt automatisch verladen.
- Routen, nächste Ziele und Fortschritt verfolgen; Stopps per Drag & Drop oder Pfeilen sortieren.
- Flotte, Schiffsdaten, Finanzen und Statistiken verwalten.
- Statistik nach Zeitraum filtern, mit dem vorherigen Zeitraum vergleichen und gebuchte Einnahmen, Ausgaben und Betriebsergebnis im Diagramm verfolgen.
- Interface-Sounds und Akzentfarbe individuell einstellen.
- Auf PC, Tablet und anderen Geräten im Heimnetz denselben Stand bearbeiten.
- Daten sichern sowie persönliche Daten als Datei exportieren und importieren.

Windows-App, lokaler Server und Screenshot-Companion starten gemeinsam. Alle Spielfunktionen arbeiten offline. Die optionale Update-Prüfung benötigt Internetzugriff auf GitHub.

## Windows verwenden

Zielplattform: Windows 10/11, 64 Bit. Fertige Downloads gehören in den
[Releases-Bereich](https://github.com/Tschensen/CitizenTools/releases).
Eine EXE benötigt den zugehörigen Ordner `_internal`; für die portable Nutzung
immer das vollständige ZIP entpacken.

Für die Installation `CitizenTools-Solo-Setup.exe` verwenden; für die portable
Nutzung `CitizenTools-Solo-Portable.zip`. Dateien mit `Update` im Namen sind für
die integrierte Aktualisierung vorgesehen. Der Projektquellcode ist am Release-Tag
und im Programm abrufbar; die OCR-Quellen stehen als eigener Release-Anhang bereit.
Zum Benutzen der App werden die Quellarchive nicht benötigt. Details stehen in
[NOTICE.md](NOTICE.md).

## Updates

Unter **Einstellungen → Über Citizen Tools → Updates** kannst du nach neuen Versionen suchen und die automatische Prüfung ein- oder ausschalten. Sie läuft beim Start und alle sechs Stunden. **Was ist neu?** zeigt vor dem Download die Änderungen auf Deutsch oder Englisch. Danach kannst du die neue Version herunterladen und **Installieren und neu starten** wählen – auch bei der portablen Ausgabe.

Die Installation erfolgt direkt in der Windows-App. Persönliche Daten und Sounds bleiben erhalten; Programmstand, Datenbank und Einstellungen werden vorher gesichert. Die portable Ausgabe behält ihren Ordner. Schließe weitere Fenster derselben Ausgabe und speichere offene Formulare vor dem Neustart. Der Programmordner muss beschreibbar sein; ein Datenordner innerhalb des Programmordners ist für automatische Updates nicht unterstützt.

Version 0.3.0 einmal wie bisher installieren oder entpacken. Danach ist die integrierte Aktualisierung für künftige Releases nutzbar. Ohne Internet bleibt die Suite verwendbar.

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
| `companion/` | Screenshot-Erfassung, Warteschlange und Import-Übertragung |
| `shared/mission_import/` | Gemeinsame OCR-Pipeline und Auftragserkennung für Companion und manuellen Import |
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
