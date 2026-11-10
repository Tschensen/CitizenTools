# Citizen Tools · Flight Deck

Eine Windows-App für Star Citizen: Aufträge, Fracht, Routen und
Screenshot-Erkennung in einer gemeinsamen Oberfläche. Zusätzliche Geräte im
Heimnetz greifen per Browser auf denselben Spielstand zu.

**Ursprüngliches Projekt:** [Tschensen](https://github.com/Tschensen)  
**Lizenz:** GPLv3 oder später

## Funktionen

Diese Übersicht beschreibt den aktuellen Entwicklungsstand. Noch nicht
veröffentlichte Änderungen stehen im [Versionsverlauf](CHANGELOG.md).

- Aufträge aus Screenshots übernehmen, verwalten und ihren Fortschritt verfolgen.
- Fracht in 3D verladen und Routen mit Teillieferungen planen.
- Flotte, Schiffsverluste und Ersatz verwalten.
- Finanzen auswerten und Kontostandsabweichungen als Buchungsvorschläge prüfen.
- Schiff, Standort, Baupläne und Auftragsmeldungen aus der Game.log nutzen.
- Sitzungen, Reisezeiten und geschätzten Kraftstoffbedarf nachvollziehen.
- Gemeinsam im Heimnetz arbeiten und persönliche Daten sichern oder übertragen.

Die Spielfunktionen arbeiten offline. Die optionale Update-Prüfung benötigt
Internetzugriff.

## Installation

Für Windows 10/11 (64 Bit) stehen im
[Releases-Bereich](https://github.com/Tschensen/CitizenTools/releases) ein Setup
und eine portable Ausgabe bereit. Das portable ZIP vollständig entpacken und
`CitizenTools-Solo.exe` starten.

Aktualisierungen sind unter **Einstellungen → Über Citizen Tools → Updates**
verfügbar. Persönliche Daten bleiben dabei erhalten.

## Heimnetz

Unter **Einstellungen → Companion** findest du die Adresse für weitere Geräte.
Diese können im Browser denselben Spielstand bearbeiten, solange die
Windows-App auf dem PC läuft.

## Weitere Informationen

- [Bedienungsanleitung](docs/ANLEITUNG.md)
- [Versionsverlauf](CHANGELOG.md)
- [Entwicklung und Windows-Build](docs/BUILD.md)

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
