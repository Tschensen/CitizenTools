Citizen Tools - eigene Interface-Sounds

Eigene Dateien unter Einstellungen > Profil > Interface-Sounds mit
Datei waehlen uebernehmen. Jeder Ton hat eine Auswahl Standard/eigene Datei,
einen eigenen Lautstaerkeregler und Probehören. Standard verwendet immer den
mitgelieferten Originalton. Die eigene Datei bleibt zur Auswahl erhalten.

Die folgenden Dateien sind die urspruenglichen Standards bzw. manuell
ausgetauschte Dateien aus Version 0.1.8:

tap.wav                 Allgemeine Taste
navigation.wav          Bereich wechseln
confirm.wav             Bestaetigung
dialog.wav              Dialog oeffnen
error.wav               Eingabefehler / Hinweis
import-read.wav         Screenshot eingelesen / in Warteschlange
import-processing.wav   Texterkennung laeuft
import-success.wav      Auftrag erkannt
import-failure.wav      Erkennung fehlgeschlagen

Format: WAV mit unkomprimiertem PCM, Mono oder Stereo, 8-96 kHz,
maximal 2 MB und 3 Sekunden je Datei.

Hochgeladene Dateien liegen unter custom, ihre Zuordnung in library.json.
Updates ueberschreiben diese Dateien nicht. Auf anderen verbundenen Geraeten
Sounddateien neu laden waehlen, um die Dateiliste zu aktualisieren.
Auswahl und Lautstaerke werden pro App/Browser gespeichert.
Den gesamten Ordner Sounds separat sichern; er ist nicht im Datenbank-Backup
oder persoenlichen Datentransfer enthalten.

Fehlende, unlesbare oder ungeeignete Dateien verwenden den eingebauten Klang.
Die Standardklaenge sind eigene, lokal erzeugte Synthese-Signale.
