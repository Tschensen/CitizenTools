# Citizen Tools · Flight Deck — Versionsverlauf

## 0.2.1 — Routen zuverlässig speichern

### Deutsch

- Das reine Aktualisieren einer Ansicht erzeugt keine Speicheranfragen mehr durch die automatische Fracht- oder Schiffsauswahl. Ein weiteres Gerät kann den gemeinsamen Stand anzeigen, ohne dadurch eine eigene Änderung auszulösen.
- Verspätete Antworten der Auftragsprüfung im Hintergrund werden verworfen, wenn inzwischen ein neuerer Stand übernommen oder gespeichert wurde. Bereits gespeicherte Stoppreihenfolgen werden dadurch nicht mehr zurückgesetzt; Folgekonflikte beim weiteren Umsortieren werden vermieden.
- Tatsächliche Änderungen von weiteren Geräten bleiben möglich. Nach dem Update die Windows-App und die Webansichten auf allen Geräten neu laden.

### English

- Refreshing a view no longer submits state changes caused by automatic cargo or ship selection. An additional device can display the shared state without creating an edit of its own.
- Delayed background import-poll responses are discarded when a newer state has already been applied or saved. Saved stop orders are no longer rolled back, avoiding subsequent conflicts when reordering again.
- Intentional edits from additional devices remain supported. After updating, restart the Windows app and reload the web views on every device.

## 0.2.0 — Zeitraumvergleich, Flugplan und Beladung

### Deutsch

- Offene Stopps per Drag & Drop, Pfeiltasten oder Chevron-Schaltflächen umsortieren. Die Reihenfolge gilt pro Schiff und wird mit weiteren Geräten geteilt; Abholungen bleiben vor ihren Lieferungen. Automatische Sortierung jederzeit wiederherstellen.
- Ladebereiche im Schiffsprofil frei benennen, einfärben, im Grid markieren und in die gewünschte Füllreihenfolge bringen. Standardbereiche für 315p, Hermes und Starlancer MAX; weitere Profile erhalten Vorschläge anhand getrennter Gridflächen.
- Autoload folgt der Bereichsfolge des Schiffs oder lädt reihenweise. Pro Auftrag lässt sich ein benannter Bereich wählen – in der Beladungsansicht und im Cockpit. Container bleiben vollständig innerhalb eines Bereichs; bestehende Platzierungen bleiben unverändert. Alte Links-/Rechts-Einstellungen werden erhalten. Ein gelöschter oder auf einem anderen Schiff fehlender Bereich muss neu gewählt werden.

- Automatischer Vergleich für Heute, letzte sieben Tage, diesen Monat und eigene Zeiträume; der Vergleichszeitraum ist direkt am Filter sichtbar.
- Unterschiede bei gebuchten Einnahmen, Ausgaben, Betriebsergebnis und erledigten Aufträgen direkt an den vorhandenen Kennzahlen anzeigen, inklusive bisherigem Wert und Prozentänderung bei positivem Vergleichswert.
- Niedrigere Ausgaben als Verbesserung kennzeichnen; bei null oder negativem Vergleichswert auf irreführende Prozentangaben verzichten. Deutsch und Englisch unterstützen.

### English

- Reorder pending stops by dragging, arrow keys or chevron buttons. Custom order is stored per ship and shared with other devices; pickups stay before their deliveries. Automatic sorting can be restored at any time.
- Name, color, paint and reorder cargo areas in the ship profile. Preset areas for the 315p, Hermes and Starlancer MAX; other profiles receive suggestions based on disconnected grid sections.
- Autoload follows the ship's area order or fills row by row. Each contract can target a named area in the loading view and cockpit. Containers stay entirely within one area; existing placements and legacy left/right preferences are preserved. Deleted areas or areas unavailable on another ship require a new selection.
- Automatically compare today, the last seven days, this month and custom periods with the preceding period. Show previous values and changes for booked income, expenses, operating result and completed contracts. Lower expenses count as an improvement; percentages are omitted for zero or negative baselines.

## 0.1.25 — Deine Einsätze im Zeitverlauf

- Zeitraum für die gesamte Statistik wählen: Heute, letzte sieben Tage, dieser Monat, eigener Zeitraum oder gesamter Verlauf. Die Auswahl bleibt pro App bzw. Browser gespeichert.
- Gebuchte Einnahmen, Ausgaben und Betriebsergebnis als interaktives Diagramm mit genauen Werten und aufklappbarer Tabelle anzeigen. Größere Zeiträume werden automatisch gebündelt.
- Auftraggeber, Orte, Schiffe und Stop-Historie berücksichtigen denselben Filter. Ältere Einträge ohne Datum bleiben im gesamten Verlauf erhalten; Hinweise machen fehlende Datumsangaben sichtbar.
- Deutsche und englische Beschriftungen sowie eine angepasste Darstellung für schmale Bildschirme.

## 0.1.24 — Dein Cockpit & erster Start

- Cockpit-Karten pro App oder Browser ein-/ausblenden, innerhalb ihrer Bereiche umsortieren und auf die Standardansicht zurücksetzen.
- Ein optionaler Assistent führt durch Pilot, erstes Schiff, Screenshot-Taste und Heimnetz. Vorhandene Spielstände bleiben erhalten; erneut aufrufbar unter Einstellungen → Profil.

- Gleichzeitige Erststarts auf PC und weiteren Geräten erzeugen keine Konfliktmeldung durch Standarddaten.

## 0.1.23 — GPL-Lizenz & aktuelle Oberfläche

- Die Windows-App umgeht nach einem Update veraltete Oberflächen im Browsercache; Einstellungen und Spielstände bleiben erhalten.
- Deutsche Uhrbeschriftungen: Schiffszeit / UTC und Ortszeit.
- Eigener Code unter GPLv3 oder später
- Veröffentlichungspakete mit Tesseract 5.5.3, dokumentierter OCR-Laufzeit und zugehörigen Quellpaketen.

## 0.1.22 — Ortszeit neben UTC

- UTC und LOCAL stehen gemeinsam im Kopfbereich, auch auf schmalen Geräten.
- Beide Uhren laufen sekündlich mit demselben PC-Zeitabgleich; die Ortszeit berücksichtigt die Zeitzone des Geräts sowie Sommer- und Winterzeit.

## 0.1.21 — Gemeinsamer Spielstand im Heimnetz

- Windows-App und Webansicht übernehmen OCR-Aufträge gemeinsam, ohne doppelte Importe oder unnötige Konfliktmeldungen.
- Bearbeiten, Löschen und Abschließen auf dem Tablet bleiben auch bei unabhängigen Änderungen auf dem PC erhalten.

## 0.1.20 — Lizenzen & Versionsverlauf

- Neuer Bereich Über Citizen Tools mit aktueller Version, Lizenztexten und Versionsverlauf.
- Lizenzhinweise für eigenen Programmcode und Drittanbieterbedingungen separat abrufbar.

## 0.1.19 — Tastenkürzel per Tastendruck

- Screenshot-Tastenkürzel anklicken, Kombination drücken und speichern.
- Esc und Abbrechen behalten die bisherige Kombination; während der Aufnahme löst der alte Hotkey keinen Screenshot aus.

## 0.1.18 — Verbindung & UTC-Zeit

- Website prüft die Erreichbarkeit der Windows-Suite und verbindet sich nach einem Ausfall automatisch wieder.
- UTC-Uhr wird mit der PC-Zeit abgeglichen; offene Eingaben bleiben bei Unterbrechungen erhalten.

## 0.1.17 — Routenfortschritt & Akzentfarbe

- Erledigte Routenziele mit Prozentangabe und kompakter Vorschau.
- Eigene Akzentfarbe oder fünf Farbvorschläge unter Profil.

## 0.1.16 — Schiffsbilder in der Modellstatistik

- Fehlende Datenbankbilder werden durch ein Flottenbild desselben Modells ergänzt.

## 0.1.15 — Mehr Platz beim Anlegen

- Auftrag anlegen nutzt die volle Seitenbreite und zeigt das aktive Schiff mit Bild.
- Verbesserte Feldanordnung für mittelbreite Tablets.

## 0.1.14 — Schiffsbilder in weiteren Karten

- Schiffsbilder in Auftragsköpfen, Verladung und Statistik.
- Aufträge zeigen das tatsächlich zugewiesene Schiff.

## 0.1.13 — Schiffsbild & lebendige Anzeigen

- Aktives Schiff mit Flotten- oder Datenbankbild auf der Startseite.
- Kompakte Anzeigen für Routenziele, Frachtraum und Zahlungen.

## 0.1.12 — Rückmeldungen beim Import

- Scanlinie und Verarbeitungssignal beim Screenshot-Import.
- Dezente Hervorhebung tatsächlich geänderter Werte auf der Startseite.

## 0.1.11 — Kompakte Startseite

- Aktueller Auftrag und aktive Aufträge zusammengefasst.
- Heute wichtig bündelt nächsten Halt, Verladung, Zahlungen und Standort.

## 0.1.10 — Vollbild im Browser

- Vollbild-Schaltflächen wieder im Browser verfügbar; im Windows-App-Fenster ausgeblendet.

## 0.1.9 — Eigene Sounds & Lautstärken

- Für jeden Sound eigene WAV-Datei oder Standardton wählen.
- Einzelne Lautstärkeregler und Probehören.

## 0.1.8 — Sounds für die Auftragserkennung

- Austauschbare WAV-Signale für Einlesen, Verarbeitung, Erfolg und Fehler.
- Importtöne lassen sich gesondert schalten.

## 0.1.7 — Interface-Sounds

- Optionale Töne für Bedienung, Navigation und Rückmeldungen.
- Gesamtlautstärke und Probehören unter Profil.

## 0.1.6 — Übergänge & Animationen

- Weiche Bereichswechsel und animierte Navigation, Karten und Dialoge.
- Systemeinstellung für reduzierte Bewegung wird berücksichtigt.

## 0.1.5 — Windows-Fensterbedienung

- Wirkungslose Vollbild-Schaltflächen aus der Windows-Suite entfernt.

## 0.1.4 — Persönlicher Datentransfer

- Persönliche Daten als Datei exportieren und mit Vorschau importieren.
- Zusammenführen oder Ersetzen mit Wiederherstellungskopie.

## 0.1.3 — Kompaktes Heimnetz & fester Ordner

- Port und aktuelle Erreichbarkeit nebeneinander.
- Updates verwenden denselben Programmordner und feste Paketnamen.

## 0.1.2 — Flight Deck

- Neue Gestaltung mit UTC-Uhr, Orbitgrafik, Navigationssymbolen und Schnellaktionen.
- Server-Port in der Anwendung einstellbar.

## 0.1.1 — Zuverlässiger Start

- Geordnetes Laden der Oberfläche behebt nicht reagierende Schaltflächen.
- Erneutes Laden bei vorübergehenden Verbindungsproblemen.

## 0.1.0 — Erste Windows-Ausgabe

- App-Fenster, lokaler Server und Screenshot-Companion in einem Programm.
- Persönlicher Spielstand ohne Konten, Organisationen oder Gruppen; Zugriff im Heimnetz.
