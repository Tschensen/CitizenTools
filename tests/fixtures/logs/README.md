# Ortsbestimmung

`stanton-roundtrip.txt` enthält die für die Ortsbestimmung relevanten Meldungen
des Rundflugs vom 1. November 2026: Orison → CRU-L4 → CRU-L1 → Orison.
Spielername, Spieler-/Schiffsinstanz-ID und Netzwerkdaten wurden anonymisiert.
Zeitstempel, Inventar-/Bereichs-IDs und Meldungsformate bleiben erhalten.

Besonders wichtig ist der Wechsel der untergeordneten Location auf `2875148748`
um 16:04:32 UTC bei unveränderter Landing-ID `1510935576`: CRU-L1 bleibt gültig.
Die Quantum-Ankünfte bei CRU-L4/CRU-L1 liegen vor den bestätigten Inventarorten.

Die Bereichszuordnungen in `shared/log_location.py` wurden zusätzlich mit
Flügen vom 10., 11., 29. und 31. Oktober 2026 abgeglichen (Builds 12881860 und
12913470). Benannte Ortsmeldungen und wiederkehrende Ein-/Austrittsfolgen liefern
die Zuordnung; sie sind keine universelle, vom Spiel veröffentlichte ID-Liste.
Beispielsweise teilen Orison und Seraphim den Crusader-Bereich `2493660041`,
Aston Ridge und Area 157 den Cellin-Bereich `1988372641`. `1902223495` tritt
zwischen mehreren unterschiedlichen Planeten- und Lagrange-Bereichen auf.
Neue IDs bleiben ohne Zuordnung. Ein Landeort von `0` allein beweist kein All.

Die Tests lesen ausschließlich diese Fixture und synthetische temporäre Logs.
Die Anwendung durchsucht keine Backups: Sie liest weiterhin nur die konfigurierte
Game.log. Benannte Inventar-IDs werden je Verbindung neu gelernt.
