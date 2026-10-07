# Citizen Tools · Flight Deck — Versionsverlauf

## 0.4.0 — Citizen Tools

### Deutsch

- Die Anwendung heißt sichtbar jetzt Citizen Tools. Tray, Ladehinweise, Installer und Windows-Verknüpfungen wurden angepasst. Bestehende EXE-Namen und Datenpfade bleiben für die Kompatibilität erhalten.
- Companion und manueller Screenshot-Import verwenden eine gemeinsame Auftragserkennung. Auch die Berechnung lokaler Kalendertage für Formulare, Buchungen und Statistik ist vereinheitlicht.
- Speicherung und Geräteabgleich wurden intern getrennt und mit parallelen Änderungen, Verbindungsabbrüchen und verzögerten Antworten geprüft. Der PC bleibt der gemeinsame Datenstand für alle verbundenen Geräte.
- Auftrags- und Frachtansichten sind in kleinere Module aufgeteilt. Aufwendige Ansichten werden bei Bedarf aktualisiert; Formularentwürfe bleiben beim Seitenwechsel erhalten.
- Für künftige Updates stehen kleinere Installer- und Portable-Pakete bereit: Sie enthalten das vollständige Programm samt OCR, aber keinen zusätzlichen WebView2-Installer. Erstinstallationspakete enthalten ihn weiterhin.
- Beim Wechsel von 0.3.0 auf 0.4.0 lädt der bisherige Updater noch das vollständige Paket. Erst nach diesem Update kann die Anwendung bei späteren Releases die kleineren Pakete auswählen. Prüfsummen, Datensicherungen und das Rücksetzen bei Installationsfehlern bleiben erhalten.
- Der Windows-Build bietet getrennte Profile für Testprogramme, Updates und vollständige Releases. Unveränderte native Builds werden geprüft wiederverwendet; Webdateien, Dokumentation und Ressourcen werden frisch zusammengestellt.

### English

- The visible application name is now Citizen Tools. Tray text, loading messages, the installer and Windows shortcuts have been updated. Existing executable names and data paths are retained for compatibility.
- The Companion and manual screenshot import now share the same mission recognition pipeline. Local calendar date calculations for forms, ledger entries and statistics have also been unified.
- Persistence and device synchronization have been separated internally and tested with concurrent changes, lost connections and delayed responses. The PC remains the shared data source for all connected devices.
- Mission and cargo views have been split into smaller modules. Expensive views refresh when needed, while form drafts survive page navigation.
- Smaller installer and portable packages are available for future updates: they include the complete application and OCR, but omit the additional WebView2 installer. First-install packages still include it.
- When upgrading from 0.3.0 to 0.4.0, the existing updater still downloads the full package. After this upgrade, the app can select smaller packages for later releases. Checksums, data backups and rollback on installation failure remain in place.
- The Windows build provides separate profiles for test applications, updates and complete releases. Unchanged native builds are verified and reused; web files, documentation and resources are assembled fresh.

## 0.3.0 — Updates direkt in Citizen Tools

### Deutsch

- Citizen Tools prüft beim Start und alle sechs Stunden, ob ein neues öffentliches GitHub-Release verfügbar ist. Die Prüfung lässt sich unter Einstellungen → Über Citizen Tools abschalten oder manuell starten.
- Ein dezenter Hinweis öffnet „Was ist neu?“ mit den Änderungen auf Deutsch oder Englisch. Download und Installation erfolgen erst nach deiner Auswahl.
- Installierte und portable Windows-Ausgaben können sich selbst aktualisieren. Downloads werden anhand der veröffentlichten Größe und SHA-256-Prüfsumme geprüft; abgebrochene oder beschädigte Dateien werden nicht installiert.
- Vor dem Austausch werden der bisherige Programmstand, die Datenbank und lokale Einstellungen gesichert. Die portable Ausgabe behält ihren Ordner; persönliche Daten und Sounds bleiben erhalten.
- Die Installation startet ausschließlich in der Windows-App. Weitere Geräte können die Versionshinweise sehen und verbinden sich nach dem Neustart wieder.
- 0.3.0 einmal wie bisher installieren oder entpacken. Die integrierte Aktualisierung steht anschließend für künftige Releases zur Verfügung.

### English

- Citizen Tools checks for a new public GitHub release at startup and every six hours. Disable automatic checks or check manually under Settings → About Citizen Tools.
- A discreet notice opens “What’s new?” with changes in English or German. Downloads and installation only start after you choose them.
- Installed and portable Windows editions can update themselves. Downloads are verified against the published file size and SHA-256 checksum; cancelled or damaged files are never installed.
- The previous program version, database and local settings are backed up before replacement. The portable edition keeps its folder; personal data and sounds are preserved.
- Installation starts exclusively in the Windows app. Additional devices can view release notes and reconnect after the restart.
- Install or extract 0.3.0 once using the usual method. Built-in updating will then be available for future releases.

## 0.2.3 — Webansichten automatisch aktualisieren

### Deutsch

- Eine externe Webansicht lädt bei einem Versionswechsel der Windows-Suite automatisch neu, sobald sie nur als Anzeige genutzt wird. Die zuletzt angezeigte Seite, etwa der Flugplan, bleibt geöffnet.
- Ungespeicherte Änderungen, Formulareingaben, geöffnete Dialoge und laufende Vorgänge verhindern den automatischen Reload. In diesem Fall bleibt die Schaltfläche „Ansicht neu laden“ verfügbar.
- Der Versionsvergleich läuft mit der Verbindungsprüfung alle fünf Sekunden und beim Zurückkehren zur Ansicht. Eine Sicherung verhindert endlose Reloads bei veralteten Browserinhalten.
- Für dieses Update bereits geöffnete ältere Webansichten einmal manuell neu laden. Danach ist die automatische Aktualisierung für künftige Versionswechsel aktiv.

### English

- An external web view automatically reloads when the Windows suite version changes and the view is only being used as a display. The last displayed page, such as the flight plan, stays open.
- Unsaved changes, form drafts, open dialogs and ongoing operations prevent the automatic reload. The “Reload view” button remains available in these cases.
- The version check runs with the connection check every five seconds and when returning to the view. A safeguard prevents endless reloads when stale browser content is returned.
- For this update, manually reload existing older web views once. Automatic updates will then apply to future version changes.

## 0.2.2 — Geöffnete Webansichten nach Updates absichern

### Deutsch

- Der Server nimmt Spielstandänderungen nur noch von der passenden Oberfläche an. Eine ältere, offen gebliebene Webansicht kann dadurch neue Felder wie die manuelle Stoppreihenfolge nicht mehr entfernen.
- Die Verbindungsprüfung erkennt künftige Versionswechsel und zeigt „Ansicht neu laden“. Zurückgewiesene lokale Änderungen bleiben als Wiederherstellungskopie erhalten.
- Nach diesem Update die Windows-App neu starten und bereits geöffnete Webansichten auf allen weiteren Geräten einmal neu laden. Ältere Ansichten kennen den neuen Update-Hinweis noch nicht.

### English

- The server only accepts state changes from the matching interface version. An older web view left open during an update can no longer remove new fields such as the manual stop order.
- The connection check detects future version changes and displays “Reload view”. Rejected local edits remain available as a recovery copy.
- After this update, restart the Windows app and reload existing web views on every additional device once. Older views do not yet know the new update notice.

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
