# Incident Briefing: Incident #INC-2026-1012

You are an incident response analyst investigating a recurring network issue at a government facility.

### Incident Brief (`#INC-2026-1012`)
* **Facility:** Carling Campus Government Complex (`FAC-OTT-01`)
* **Office Location Coordinates:** `45.3507° N, -75.8518° W` (60 Moodie Drive / Carling Avenue, Ottawa, ON)
* **Access Points:** Outdoor guest Wi-Fi coverage is provided across three access points (`AP-West-Gate`, `AP-Central-Courtyard`, and `AP-East-Pavilion`), all collocated at the main office facility grounds (`45.3507° N, -75.8518° W`). Their coordinates do not differ from one AP to the next.
* **Issue:** Over the past two weeks, the outdoor public guest Wi-Fi network (`GOV_GUEST_WIFI`) across our three access points has experienced brief, recurring packet-collision spikes and connection drops ("flapping") before recovering on its own within about a minute.
* **Current Status:** Individual IT and security monitoring dashboards show no critical alerts ("everything is green").

### Initial Evidence & Sensor Feeds Provided:
The following operational datasets have been collected for this investigation:

| File Name | Description |
| :--- | :--- |
| `ottawa_tech_forums.json` | Scraped local tech & engineering forums |
| `road_traffic.json` | City of Ottawa & DND perimeter road traffic speed & congestion telemetry |
| `wlc_syslog.log` | Campus wireless controller syslogs |
| `yow_tower_radar.xml` | Airport tower primary & secondary radar |

### Note for Analysts:
Investigate the issue iteratively. Inspect the initial sensor feeds and correlate anomalous timestamps across the syslogs, radar records, technical forums, and road telemetry to determine the root cause.
