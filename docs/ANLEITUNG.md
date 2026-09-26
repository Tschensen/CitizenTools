# Citizen Tools · Flight Deck · 0.1.25

Eigenständige Offline-Ausgabe der lokalen Citizen-Tools-Python-Suite für Windows 10/11 (64 Bit). Ein Programm startet das App-Fenster, die lokale SQLite-Datenbank und den Screenshot-Companion. Es benötigt im Betrieb keine Internetverbindung.

Enthalten: Aufträge, Frachtplanung und Cargo-Grids, Routen, Flotte, Schiffsdatenbank, Systemdaten und OCR-Aliase, Finanzen, Statistik, Screenshot-OCR sowie Backup und Wiederherstellung. Organisationen, Einsatzgruppen, Rollen und Benutzerverwaltung sind nicht Bestandteil dieser Ausgabe.

## Statistik nach Zeitraum

Ab Version 0.1.25 steht über allen Statistikbereichen eine gemeinsame Zeitraumwahl:
**Gesamter Verlauf**, **Heute**, **Letzte 7 Tage**, **Dieser Monat** und **Eigener Zeitraum**.
Eigene Start- und Enddaten werden mit **Anwenden** übernommen; beide Tage zählen mit.
Die Auswahl wird pro App bzw. Browser gespeichert und verändert keine Aufträge oder Buchungen.

Erledigte Aufträge werden nach Abschlussdatum ausgewertet, offene nach Anlagedatum.
Bei älteren erledigten Aufträgen dienen Zahlungs- oder Anlagedatum als Ersatz.
Die Fracht eines erledigten Auftrags wird dessen Auswertungsdatum zugerechnet.
Buchungen verwenden ihren Buchungstag (ersatzweise Anlagedatum), Stopps ihr Abschlussdatum.
Zeitstempel werden in der Ortszeit des jeweiligen Geräts ausgewertet; reine Buchungsdaten behalten ihren Kalendertag.
Einträge ohne gültiges Datum sind im gesamten Verlauf weiterhin enthalten und werden bei begrenzten Zeiträumen mit einem Hinweis ausgelassen.

**Ergebnis im Verlauf** zeigt die tatsächlich gebuchten Einnahmen und Ausgaben sowie deren Differenz als Betriebsergebnis.
Schiffskauf, Schiffsverkauf und Upgrades bleiben wie bei den Schiffsauswertungen unberücksichtigt.
Noch nicht gebuchte Auftragsvergütungen gehören nicht zum Diagramm. Eine spätere Zahlung verschiebt das Abschlussdatum eines vorhandenen Auftrags nicht.
Einzelne Zeitpunkte lassen sich durch Antippen des Diagramms oder über den Schieberegler auswählen; dieser ist auch per Tastatur bedienbar.
**Werte als Tabelle** enthält die genauen Werte aller angezeigten Zeitabschnitte.
Längere Zeiträume werden automatisch in Abschnitte von sieben Tagen, Monate oder Jahre zusammengefasst.
Datumslose Buchungen fließen im gesamten Verlauf in die Summen ein, können aber nicht eingezeichnet werden; die Ansicht weist darauf hin.

Der Zeitfilter gilt ebenfalls für Auftraggeber, Orte, Schiffsauswertungen und Stop-Historie.
Eine kompakte Erklärung lässt sich direkt am Filter unter **So wird gerechnet** aufklappen.

Version 0.1.19 ergänzt die Aufnahme des Screenshot-Tastenkürzels per Tastendruck: unter Einstellungen → Companion & Heimnetz das Feld oder **Aufnehmen** anklicken, Kombination drücken und **Einstellungen speichern** wählen. **Esc**, Abbrechen oder Verlassen des Feldes behält den vorherigen Wert. Währenddessen bleibt laufende OCR aktiv; nur der bisherige Hotkey wird vorübergehend freigegeben. Bei einem geschlossenen oder getrennten Browser endet die Freigabe automatisch.

Version 0.1.21 korrigiert den gemeinsamen Spielstand von Windows-App und Webansicht im Heimnetz. OCR-Aufträge werden zentral und genau einmal übernommen. Bearbeiten, Löschen und Abschließen auf dem Tablet werden in derselben PC-Datenbank gespeichert; unabhängige Änderungen bleiben auch bei parallelen Importen erhalten. Nur widersprüchliche Änderungen an denselben Daten benötigen weiterhin eine Wiederherstellungskopie. Nach dem Update die App neu starten und die Webansicht auf den anderen Geräten neu laden.

Version 0.1.22 zeigt **UTC** und **LOCAL** nebeneinander im Kopfbereich. Beide Uhren verwenden denselben sekündlich laufenden, mit der Windows-Suite abgeglichenen Zeitpunkt. LOCAL zeigt die Ortszeit der Gerätezeitzone einschließlich Sommer-/Winterzeit. Bei getrennter Verbindung laufen beide mit dem letzten Abgleich weiter.

Version 0.1.23 verhindert, dass die Windows-App nach einem Update eine alte zwischengespeicherte Oberfläche öffnet. Die Startadresse enthält die Programmversion; HTML, JavaScript und CSS werden frisch ausgeliefert. Gespeicherte Browser-Einstellungen und Spielstände bleiben erhalten. Die Uhrbeschriftungen folgen der Sprache: **Schiffszeit / UTC** und **Ortszeit**, auf Englisch **Ship time / UTC** und **Local time**.

## Lizenzen und Versionsverlauf

Unter **Einstellungen → Über Citizen Tools** stehen die aktuelle Version, der Versionsverlauf ab 0.1.0 und eine durchsuchbare Liste lokal mitgelieferter Lizenztexte. Lizenztexte und Release Notes lassen sich speichern. Die Windows-Ausgabe enthält außerdem ein herunterladbares Quellcode-ZIP mit eigenem Programmcode und Build-Anleitung, ohne Laufzeit-Binärdateien oder Benutzerdaten.

Ursprüngliches Projekt: **Tschensen** · [Citizen Tools auf GitHub](https://github.com/Tschensen/CitizenTools).

Der eigene Code steht ab 0.1.23 unter **GNU GPLv3 oder später (`GPL-3.0-or-later`)**; siehe `LICENSE` und `NOTICE.md`. Nutzung und Weitergabe sind auch kommerziell erlaubt. Copyright- und Lizenzhinweise bleiben erhalten, Änderungen werden gekennzeichnet, und bei Weitergabe gelten die GPL-Pflichten einschließlich Bereitstellung des zugehörigen Quellcodes. Zusatzsoftware, Microsoft-Laufzeiten, Marken und Spielinhalte behalten ihre eigenen Bedingungen; siehe `NOTICE.md`. Die verwendete OCR-Laufzeit ist mit Versionen und Prüfsummen festgehalten; ihre zugehörigen Quellen werden im Release als `CitizenTools-Solo-OCR-Sources.zip` mitgeliefert. Siehe [OCR-Quellen](OCR-SOURCES.md).

Neue Versionen werden in `release-notes.json` eingetragen. Oberfläche, herunterladbarer Verlauf und `RELEASE-NOTES.md` im Paket verwenden dieselbe Datei. Der Build prüft, dass der neueste Eintrag zur Programmversion passt, und sammelt die Lizenztexte der tatsächlich installierten Python-Abhängigkeiten.

## Starten

Den Installer `CitizenTools-Solo-Setup.exe` ausführen oder das gesamte portable ZIP entpacken und `CitizenTools-Solo.exe` starten. Die EXE benötigt den benachbarten Ordner `_internal`; sie darf nicht allein kopiert werden. Python und Tesseract mit deutschen und englischen Sprachdaten werden mitgeliefert.

Der feste Programmordner ist `dist/CitizenTools-Solo`. Künftige Builds aktualisieren diesen Ordner; die Versionsnummer steht in der Anwendung und in `release.json`. Bei der portablen Verwendung Updates immer in denselben gewählten Ordner entpacken. Die App vorher schließen. Dadurch bleibt der EXE-Pfad für die Windows-Firewall unverändert. Der Installer aktualisiert ebenfalls denselben Installationsordner.

Das eigene App-Fenster verwendet Microsoft WebView2. Der vollständige Installer enthält dessen Offline-Installationsprogramm und richtet es bei Bedarf ein. Bei der portablen Ausgabe kann die mitgelieferte Datei unter `prerequisites` manuell ausgeführt werden, falls WebView2 auf dem PC fehlt. Die Anwendung lädt keine Laufzeiten aus dem Internet nach.

Beim Schließen des Fensters werden Server und Erfassung beendet. Minimieren lässt beides weiterlaufen. Das Symbol im Infobereich bietet Öffnen, Erfassung starten/stoppen und Beenden. Standard-Hotkey: `Ctrl+Shift+F12`. Bei fehlender oder belegter Erfassung bleibt die normale Verwaltung nutzbar; der Status wird unter Einstellungen → Companion angezeigt.

Version 0.1.1 behebt einen unvollständigen Start, bei dem die Oberfläche sichtbar war, die Schaltflächen aber nicht reagierten. Benötigte Dateien werden geordnet geladen und bei einem Verbindungsfehler erneut abgerufen. Falls das Laden dauerhaft scheitert, erscheint eine Fehlermeldung mit **Erneut laden**.

Version 0.1.2 bringt das Flight-Deck-Design mit Orbitgrafik, UTC-Uhr, Navigationssymbolen und direkten Aktionen auf der Startseite. Die Grafiken und Schriften benötigen keine Internetverbindung; die Orbitbewegung berücksichtigt die Systemeinstellung für reduzierte Animationen.

Version 0.1.3 fasst Port und aktuelle Erreichbarkeit in einem kompakten Bereich zusammen. Der Netzwerkzugriff funktioniert auch mit anderen Geräten als Tablets.

Version 0.1.5 entfernt die wirkungslosen Vollbild-Schaltflächen aus der Windows-Suite. Das App-Fenster lässt sich weiterhin über die Windows-Titelleiste maximieren.

Version 0.1.6 ergänzt weiches Einblenden beim Bereichswechsel, einen gestaffelten Einstieg auf der Startseite, eine animierte Navigationsmarkierung und sanft öffnende Dialoge. Schnellaktionen und Karten reagieren mit dezenten Hover- und Druckeffekten. Die Systemeinstellung für reduzierte Bewegung schaltet Animationen und Übergänge ab.

Version 0.1.7 ergänzt unter **Einstellungen → Profil** optionale Interface-Sounds mit Lautstärke und Probehören. Die Töne werden lokal synthetisiert und benötigen weder Audiodateien noch Internet. Standardmäßig ausgeschaltet; die Auswahl wird nur in der jeweiligen App bzw. im jeweiligen Browser gespeichert und nicht zwischen Geräten synchronisiert. Probehören funktioniert auch bei ausgeschalteten Interface-Sounds; 0 % bleibt stumm. Navigation, Bestätigungstasten, Dialoge und ungültige Formulare erhalten kurze Signale. Texteingabe und Hintergrundsynchronisierung bleiben still.

Version 0.1.8 ergänzt austauschbare WAV-Dateien und Signale für Einlesen, OCR-Verarbeitung, erkannte Aufträge und fehlgeschlagene Erkennung. Unter **Einstellungen → Profil** kann jeder Klang einzeln vorgehört werden. Der zusätzliche Schalter **Auftragsimport begleiten (auch im Hintergrund)** steuert Importmeldungen; der Hauptschalter und die Lautstärke gelten weiterhin. Wiederholte Statusabfragen, alte Ergebnisse beim Öffnen und abgebrochene Importe erzeugen keine nachträglichen Erfolgstöne. Der Erfolgston bedeutet: OCR hat einen Auftrag erkannt; die angezeigte Importvorschau bzw. der Speicherstatus bleibt maßgeblich für die Übernahme.

Version 0.1.9 ergänzt für jeden der neun Töne eine Dateiauswahl, die Auswahl **Standard**, einen eigenen Lautstärkeregler und Probehören. Die Gesamtlautstärke gilt zusätzlich für alle Töne. Ein Formathinweis ersetzt den bisherigen Beschreibungstext.

Version 0.1.10 stellt die Vollbild-Schaltflächen im Browser wieder her, auch in der kompakten Routenansicht. Nur im eigenen Windows-App-Fenster bleiben sie ausgeblendet. Browser ohne verfügbare Vollbild-Funktion zeigen keine wirkungslose Schaltfläche.

Version 0.1.11 fasst die Startseite zusammen: **Aktive Aufträge** zeigt jetzt Anzahl, aktuellen Auftrag und Route. **Heute wichtig** bündelt nächsten Halt samt Aktion, Verladung, Zahlungen und die Standortauswahl. Die separaten Bereiche **Aktueller Auftrag** und **Nächste Ziele** entfallen. Begrüßung und Abstände sind flacher; die Startseite wurde im Tablet-Querformat auch mit gefülltem Spielstand bei 1280 × 640 Pixeln ohne Scrollen geprüft. Bei schmalen Ansichten werden die Karten weiterhin untereinander angeordnet.

Version 0.1.12 ergänzt dezente Import-Effekte: eine Scanlinie in der Screenshot-Vorschau, ein laufendes Signal während der Verarbeitung sowie farbliche Rückmeldungen bei erkannter bzw. fehlgeschlagener Texterkennung. Auf der Startseite leuchten tatsächlich geänderte Werte kurz auf. Wiederholte Abfragen und der erste Datenabruf lösen keine Hervorhebungen aus; Hintergrundmeldungen werden beim Zurückkehren nicht als Animation nachgeholt. Die Effekte funktionieren unabhängig vom Sound-Schalter und berücksichtigen die Systemeinstellung für reduzierte Bewegung.

Version 0.1.13 zeigt das Bild des aktiven Schiffs dezent in dessen Startseitenkarte: zuerst das eigene Flottenbild, ansonsten das Bild aus der Schiffsdatenbank. Ohne verfügbares Bild erscheint eine neutrale Silhouette. Bilder lassen sich wie bisher in der Flotte bzw. Schiffsdatenbank hinterlegen; hochgeladene Bilder sind lokal verfügbar. Kleine Balken zeigen erledigte Routenstopps und belegten Frachtraum, Statuspunkte und ein Zahlungssymbol ergänzen die vorhandenen Angaben. Balken bewegen sich bei tatsächlichen Änderungen; wiederholte Abfragen und reduzierte Bewegung bleiben ruhig. Die Startseite benötigt dafür keinen zusätzlichen Bereich.

Version 0.1.14 erweitert die Schiffsbilder auf die aktive Schiffsübersicht, Auftragsköpfe und die Verladeliste. In der Statistik erscheinen sie beim meistgenutzten Modell, in der Modellauswertung und bei den einzelnen Flottenschiffen. Aufträge zeigen ihr tatsächlich zugewiesenes Schiff, auch wenn inzwischen ein anderes aktiv ist. Modellstatistiken verwenden das Datenbankbild; einzelne Flottenschiffe bevorzugen ihr eigenes Bild. Nicht zugeordnete oder nicht mehr vorhandene Schiffe erhalten kein fremdes Bild. Alle Bilder bleiben dezent im vorhandenen Kartenbereich.

Version 0.1.15 nutzt unter **Auftrag anlegen** die volle verfügbare Seitenbreite. Titel- und Streckenfelder ordnen sich auf mittelbreiten Tablets in zwei Spalten an; das Formular wird nicht mehr durch überbreite innere Raster abgeschnitten. Die vorhandene Karte **Aktuelles Schiff** zeigt dessen Flotten- bzw. Datenbankbild. Beim Ausfüllen bleibt das Bildelement erhalten; beim Wechsel des aktiven Schiffs wird es aktualisiert. Ohne aktives Schiff wird kein fremdes Bild angezeigt.

Version 0.1.16 ergänzt in der Modellstatistik und beim meistgenutzten Schiffsmodell ein Flottenbild als Ersatz, wenn das Datenbankbild fehlt. Verwendet wird ausschließlich ein Schiff desselben Modells, bevorzugt das aktuell aktive Schiff, danach weitere aktive und archivierte Einträge mit Bild. Einzelbewertungen behalten ihre individuellen Bilder.

Version 0.1.17 ergänzt den Routenfortschritt mit Prozentangabe und einer kompakten Vorschau für erledigtes Ziel, aktuellen Halt und kommende Ziele. Gezählt werden vollständig erledigte Routenziele: mehrere Aktionen am selben Ort zählen erst nach Abschluss aller Aktionen als erledigt. Abgeschlossene Aufträge bleiben in der laufenden Route enthalten, auch nach Zahlung, Neustart oder Schiffswechsel. Neue Aufträge nach Abschluss beginnen eine neue Route; zusätzliche Aufträge während einer laufenden Route erweitern sie. Abgebrochene, gelöschte oder einem anderen Schiff zugewiesene Aufträge gehören nicht mehr zur bisherigen Route. Unter **Einstellungen → Profil → Akzentfarbe** stehen fünf Farbvorschläge, eine freie Farbauswahl und **Standard** bereit. Die Wahl gilt pro App bzw. Browser und wird sofort übernommen. Sehr dunkle Farben werden für lesbare Hervorhebungen aufgehellt; Warn-, Erfolgs- und Auftragsfarben bleiben unabhängig.

Version 0.1.18 prüft die Erreichbarkeit der Windows-Suite unabhängig vom Datenabgleich alle fünf Sekunden, auch bei geöffneten Formularen. Eine ausgebliebene Antwort wird nach 3,5 Sekunden als Verbindungsunterbrechung angezeigt. Nach Rückkehr der Suite verbindet sich die offene Seite automatisch wieder; beim Zurückkehren zu einem pausierten Tab wird sofort erneut geprüft. Offene Eingaben bleiben erhalten. Zwischengespeicherte Änderungen werden mit dem bestehenden Schutz vor gleichzeitigen Änderungen erneut übertragen. Auch ein beim ersten Laden fehlgeschlagener Datenabruf wird wiederholt. Die UTC-Anzeige wird mit der PC-Zeit abgeglichen und läuft bei unterbrochener Verbindung mit dem letzten Zeitabgleich weiter; eine externe Zeitquelle wird nicht verwendet.

### Eigene Sounddateien

Unter **Einstellungen → Profil → Interface-Sounds** hat jeder Ton eine eigene Zeile. **Datei wählen** übernimmt eine WAV-Datei und aktiviert sie für diesen Ton. **Standard** verwendet jederzeit den mitgelieferten Originalton; die eigene Datei bleibt zur erneuten Auswahl erhalten. **Probehören** spielt den gewählten Ton mit seiner eingestellten Lautstärke. Der Regler je Ton wirkt zusätzlich zur Gesamtlautstärke; 0 % schaltet diesen Ton stumm.

Unterstützt werden **WAV-Dateien mit unkomprimiertem PCM**, Mono oder Stereo, 8–96 kHz, maximal 2 MB und 3 Sekunden pro Datei. Ungültige Dateien werden abgewiesen; die vorherige Datei und Auswahl bleiben erhalten.

Die Dateien werden auf dem PC unter `%LOCALAPPDATA%\CitizenToolsSolo\Sounds` gespeichert und bei Updates nicht überschrieben. Hochgeladene Dateien liegen unter `custom`, die Zuordnung in `library.json`. Sie sind auch auf verbundenen Geräten verfügbar. **Sounddateien neu laden** aktualisiert dort die Dateiliste. Ein/Aus, Standard/eigene Datei und alle Lautstärken bleiben pro App bzw. Browser gespeichert. Aus Version 0.1.8 manuell ersetzte WAV-Dateien werden weiterhin erkannt, solange für den jeweiligen Ton keine ausdrückliche Auswahl gespeichert wurde.

| Datei | Signal |
| --- | --- |
| `tap.wav` | Taste |
| `navigation.wav` | Bereich wechseln |
| `confirm.wav` | Bestätigen |
| `dialog.wav` | Dialog öffnen |
| `error.wav` | Eingabefehler / Hinweis |
| `import-read.wav` | Screenshot eingelesen / Warteschlange |
| `import-processing.wav` | Texterkennung läuft |
| `import-success.wav` | Auftrag erkannt |
| `import-failure.wav` | Erkennung fehlgeschlagen |

Fehlende oder unlesbare Dateien verwenden den eingebauten Syntheseklang. Der Soundordner gehört nicht zum Datenbank-Backup oder persönlichen Datentransfer; für eine Sicherung eigener Sounds den gesamten Ordner `Sounds` separat kopieren.

## Tablet im Heimnetz

Unter **Einstellungen → Companion** steht die lokale Adresse, beispielsweise `http://192.168.1.20:4174`. Diese im Tablet-Browser öffnen. Beide Geräte müssen im selben Netz sein, und Citizen Tools Solo muss auf dem PC laufen. Bei der Windows-Firewall-Abfrage den Zugriff im privaten Netzwerk erlauben. Gast-WLAN oder Client-Isolation können die Verbindung verhindern. Es wird keine Portweiterleitung am Router benötigt.

Den **Server-Port** direkt am PC unter **Einstellungen → Companion** ändern (1024–65535, Standard 4174). Einstellungen speichern, das Programm schließen und neu öffnen. Anschließend am Tablet die neue Adresse verwenden. Bis zum Neustart bleiben der bisherige Port und die angezeigten aktuellen Adressen aktiv. Ein bereits belegter Port wird beim Speichern abgewiesen. Der vorhandene Spielstand bleibt beim Portwechsel erhalten.

Der Zugriff hat bewusst kein Kontensystem: Geräte im freigegebenen Heimnetz bearbeiten denselben Solo-Spielstand. Nur in einem eigenen, vertrauenswürdigen Netzwerk verwenden. Die Freigabe kann unter Einstellungen → Companion ausgeschaltet werden; eine Änderung gilt nach dem nächsten Start. Screenshot-Hotkeys werden direkt auf dem PC eingestellt.

PC und Tablet gleichen gespeicherte Änderungen regelmäßig ab. Formulare und offene Dialoge werden beim Tippen nicht durch Hintergrundaktualisierungen ersetzt. Bei gleichzeitigen Änderungen lädt die App den bereits gespeicherten Stand und bewahrt die abgewiesene Änderung im Browser als herunterladbare JSON-Wiederherstellungskopie auf. Diese JSON-Datei ist eine manuell auswertbare Änderungskopie, kein vollständiges Datenbank-Backup. Vor dem Beenden auf den erfolgreichen Speicherstatus achten.

## Daten und Sicherungen

Die Benutzerdaten liegen getrennt von der Programmdatei unter `%LOCALAPPDATA%\CitizenToolsSolo`:

- `data/cargo_planner.sqlite3`: gemeinsamer Spielstand.
- `data/ship-images`: eigene Bilder.
- `data/*pre-restore*`: automatische Sicherungen vor Wiederherstellungen.
- `Captures`: vom Companion erzeugte Screenshots.
- `settings.json`, `capture-state.json`: lokale Einstellungen und OCR-Importstatus.
- `WebView`: Cache des App-Fensters; `solo.log`: rotierendes Diagnoseprotokoll.

Updates und Deinstallation entfernen diesen Datenordner nicht. Datenbank und Bilder unter **Einstellungen → Datenbank** sichern. Es werden keine vorhandenen Benutzerkonten, Token, Datenbanken oder persönlichen Schiffe mit ausgeliefert.

## Persönlicher Datentransfer

Unter **Einstellungen → Datentransfer** lassen sich persönliche Daten als JSON-Datei speichern. Zum Einlesen die JSON-Datei auswählen, die Vorschau prüfen und **Importieren** bestätigen.

Übertragen werden Schiffsprofile, Flotte, persönliche Aufträge und Buchungen, persönliche Kontakte, Piloten- und Routenverlauf sowie hochgeladene Schiffsbilder.

**Zusammenführen** aktualisiert Einträge mit derselben Kennung und behält andere Einträge sowie die aktuelle Schiffs-/Routenauswahl. **Ersetzen** übernimmt den persönlichen Dateiinhalt. Vor jedem Import wird der vorherige persönliche Stand samt Bildern gespeichert; **Stand vor letztem Import speichern** lädt ihn als erneut importierbare Transferdatei herunter. Eine inzwischen geänderte Datenbasis erfordert eine neue Vorschau.

Nicht enthalten sind Organisationen, Gruppen, Konten, Berechtigungen, Zugangsdaten, die Standortdatenbank, Screenshots und PC-/Netzwerkeinstellungen. Extern verlinkte Bilder bleiben Links und benötigen weiterhin Internet; hochgeladene PNG-/JPG-/WebP-Bilder sind eingebettet. Ältere persönliche JSON-Exporte werden ebenfalls angenommen, enthalten jedoch keine eingebetteten Bilder. Maximal 32 MB pro Datei, 500 Schiffsprofile/Flotteneinträge/Aufträge/Kontakte und 1.000 Buchungen. Der Dateiaustausch ist manuell und keine laufende Synchronisierung.

## Entwicklung

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe app.py
.\.venv\Scripts\python.exe -m unittest discover -s tests -p test_solo.py -v
node tests\test_solo_sync.js
```

Die OCR-Laufzeit vor dem Windows-Build mit `python tools/prepare_ocr.py` vorbereiten; siehe [Build-Anleitung](BUILD.md). Im Quellbetrieb `TESSERACT_CMD` auf die eigene `tesseract.exe` setzen. Zur Diagnose gibt es `--headless`, `--no-capture`, `--localhost`, `--port` und `--data-dir`. Damit lassen sich Tests vollständig in getrennten Datenordnern ausführen.

```powershell
.\.venv\Scripts\python.exe tools\build_windows.py --tesseract-dir .build\ocr --ocr-sources .build\CitizenTools-Solo-OCR-Sources.zip --webview-installer "Pfad\MicrosoftEdgeWebView2RuntimeInstallerX64.exe" --installer
```

Der Build bereitet die vollständige Ausgabe zunächst unter `.build` vor und aktualisiert dann den festen Zielordner `dist`. Installer und ZIP behalten ebenfalls ihre Dateinamen. Die vorherige Ausgabe bleibt als Sicherung im Build-Verzeichnis erhalten; schlägt das Ersetzen fehl, wird sie wiederhergestellt. Mit `--output` lässt sich ein anderer fester Ausgabeordner wählen. Kopiert werden nur Programmcode, Web-Assets, Lizenzen und Laufzeiten. `release.json` enthält Version, Dateigrößen und SHA-256-Prüfsummen. Der Build ist nicht codesigniert.

Die WebView2-Verteilung folgt der [Microsoft-Anleitung zur Offline-Bereitstellung](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution#offline-deployment). Fensteranbindung: [pywebview](https://pywebview.flowrl.com/guide/installation).

## Cockpit und Einrichtungsassistent (0.1.24)

Auf der Startseite öffnet **Cockpit anpassen** die Kartenauswahl. Häkchen blenden
Karten ein oder aus; die Pfeile ändern ihre Reihenfolge innerhalb von „Übersicht“
und „Heute wichtig“. **Übernehmen** speichert die Ansicht nur für diese App bzw.
diesen Browser. **Abbrechen** verwirft Änderungen; **Standardansicht** setzt die
Auswahl im Dialog zurück. Die Frachtkarte erscheint bei einem frachtfähigen Schiff.
PC und Tablet können dadurch verschiedene Cockpits verwenden.

Ein frischer Spielstand bietet auf der Startseite **Jetzt einrichten** an.
Der Assistent führt durch Pilot, erstes Schiff, Screenshot-Taste und Heimnetz.
Ein Schiff kann später gewählt werden; eine vorhandene Flotte wird nicht ersetzt.
Mit **Einrichtung speichern** werden die Angaben gespeichert. Port und Freigabe
werden nach einem Neustart wirksam. **Später** blendet den Hinweis aus.
Unter **Einstellungen → Profil → Einrichtungsassistent** ist er erneut aufrufbar.
Screenshot- und Netzwerkeinstellungen können nur direkt am PC geändert werden.
