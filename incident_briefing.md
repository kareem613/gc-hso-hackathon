# Incident Briefing: Incident #INC-2026-1012

You are an incident response analyst investigating a recurring network issue at a government facility.

### Incident Brief (`#INC-2026-1012`)
* **Facility:** Carling Campus Government Complex (`FAC-OTT-01`)
* **Office Location Coordinates:** `45.3507° N, -75.8518° W` (60 Moodie Drive / Carling Avenue, Ottawa, ON)
* **Access Points:** Outdoor guest Wi-Fi coverage is provided across three access points (`AP-West-Gate`, `AP-Central-Courtyard`, and `AP-East-Pavilion`), all collocated at the main office facility grounds (`45.3507° N, -75.8518° W`). Their coordinates do not differ from one AP to the next.
* **Issue:** Over the past two weeks, the outdoor public guest Wi-Fi network (`GOV_GUEST_WIFI`) across our three access points has experienced brief, recurring packet-collision spikes and connection drops ("flapping") before recovering on its own within about a minute.
* **Current Status:** Individual IT and security monitoring dashboards show no critical alerts ("everything is green").

### Initial Evidence & Sensor Feeds Provided:
1. `wlc_syslog.log` (`wlc_syslog_core.log`): Campus wireless controller syslog stream recording 802.11 association requests, signal-to-noise ratios (SNR), and deauth timeouts.
2. `yow_tower_radar.xml` (`yow_tower_radar_core.xml`): Primary & secondary radar track log from Ottawa Macdonald-Cartier International Airport (CYOW) tower covering regional airspace.
3. `ottawa_tech_forums.json` (`ottawa_tech_forums_core.json`): Scraped local engineering and maker forum discussions.
4. `road_traffic.json` (`road_traffic_core.json`): City of Ottawa & DND perimeter road traffic monitoring feed recording traffic flow speeds and congestion levels along Moodie Drive and campus access roads.
