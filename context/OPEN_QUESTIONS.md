# OPEN QUESTIONS — TODOs, Limitierungen, offene Punkte

## Offene manuelle Setup-Schritte (Umzug auf die Synology NAS)

Anleitung: `docs/SYNOLOGY.md`.

- [x] **Container auf der NAS starten** — läuft (zunächst aus einem ZIP mit lokalem Build).
- [ ] **Auf GitHub-Image umstellen**: `main` mergen, damit die Action das erste Image baut (Lauf unter
      *Actions* prüfen — der Workflow wurde ohne echten Lauf geschrieben), dann auf der NAS `docker login ghcr.io`
      (oder Package public) und den Umstieg aus `docs/SYNOLOGY.md` §8 machen, Aufgabenplaner-Update-Script anlegen.
- [ ] **`.env` anlegen**: `APP_URL` + `SMTP_*`.
- [ ] **Ersten Admin registrieren** über den `?join=`-Link aus dem Container-Protokoll.
- [ ] **Externer Zugriff**: DDNS, Let's-Encrypt-Zertifikat, DSM-Reverse-Proxy auf Port 3000, Router 443 → NAS.
- [ ] **SMTP testen**: einmal „Passwort vergessen" und einmal Zahltag auslösen.
- [ ] **Backup** einrichten (Hyper Backup + Aufgabenplaner-Script).
- [ ] **WG umziehen**: neuen Einladungs-Link teilen, alle registrieren sich neu, Plätze neu zuordnen
      (Altdaten werden bewusst nicht übernommen; offene Supabase-Schulden vorher begleichen oder notieren).
- [ ] **Alt abschalten**: Vercel-Projekt löschen/Git-Verbindung trennen, Supabase-Projekt
      `dvdasdgduhfalrtcjrdb` pausieren bzw. löschen. **Achtung:** Solange Vercel mit `main` verbunden ist,
      baut ein Merge dieses Umbaus dort ein Frontend ohne API → Vercel vor dem Merge trennen.

## Bekannte kleinere Limitierungen (bewusst akzeptiert für diese Größe)

- **Storno-Fenster bleibt tagesbasiert, auch bei Stundenbuchung**: Storno nur, wenn `min(date) > heute`,
  nicht nach tatsächlicher Uhrzeit. Bei dieser Nutzung akzeptiert.
- **`join`-`list` gibt Platz-IDs an jeden mit gültigem Invite-Code** (nur IDs, keine Namen) — akzeptiert.
- **Einladungs-Link ist ein geteiltes Geheimnis**: wer ihn hat, kann sich registrieren (bis zum 50-Deckel).
  Bei Leak im Admin-Tab „Neuen Link erzeugen". E-Mail-Besitz wird bei der Registrierung nicht geprüft.
- **Rate-Limit ist In-Memory** (pro IP, 30 Versuche / 15 min auf Login/Reset/Registrierung) und wird bei
  Container-Neustart zurückgesetzt. Hinter dem Reverse Proxy kommt die echte Client-IP über
  `X-Forwarded-For` (`trust proxy`).
- **User löschen** geht nur für User **ohne** Buchungs-/Ledger-Historie; Platz-Besitz wird dabei gelöst.
- **`node:sqlite`** ist in Node 24 noch als „experimental" markiert (Warnung per `NODE_OPTIONS` stummgeschaltet).
  API ist seit Node 22.13 stabil genug; bei Node-Updates im Dockerfile kurz die Release-Notes prüfen.
- **Container läuft als root**, damit er in den Synology-Bind-Mount schreiben darf (DSM-User-UIDs passen
  sonst nicht). Der Port ist nur über den Reverse Proxy erreichbar.
- **Kein Mail-Bestätigungslink beim Ändern der E-Mail** — es gibt (noch) keine Möglichkeit, die eigene
  E-Mail zu ändern. Bei Bedarf über die CLI/DB.

## Fragen an den Auftraggeber

- Sollen offene Schulden aus der Supabase-Zeit übernommen werden? (Aktuell: nein, Neustart.)
