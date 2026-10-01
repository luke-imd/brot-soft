# Garage auf der Synology NAS betreiben

Die App läuft als **ein Docker-Container** (Node-Server liefert API + Frontend aus). Die Daten liegen in
einer SQLite-Datei im Ordner `data/` neben der `docker-compose.yml`. Kein Supabase, kein Vercel.

## 1. Voraussetzungen

- DSM 7.2 oder neuer mit **Container Manager** (Paket-Zentrum). Funktioniert auf Intel/AMD- und ARM-Modellen.
- RAM: der Container braucht rund 60–100 MB.
- Für Zugriff von unterwegs: eine Adresse (kostenlos über Synology-DDNS `xyz.synology.me` oder eine eigene Domain).

## 2. Code auf die NAS bringen

1. In der **File Station** einen Ordner anlegen, z. B. `/docker/garage`.
2. Auf GitHub beim Repo **Code → Download ZIP**, entpacken und den Inhalt in `/docker/garage` hochladen
   (es muss dort direkt `Dockerfile` und `docker-compose.yml` liegen).
3. `.env.example` kopieren, in **`.env`** umbenennen und ausfüllen (Texteditor-Paket oder lokal bearbeiten
   und hochladen):
   - `APP_URL` – die spätere öffentliche Adresse, z. B. `https://garage.xyz.synology.me`
   - `SMTP_*` – Mailzugang für „Passwort vergessen" und die Zahltag-Mail (siehe Abschnitt 6)

## 3. Container starten

1. **Container Manager → Projekt → Erstellen**
2. Projektname `garage`, Pfad `/docker/garage`, „Vorhandene docker-compose.yml verwenden".
3. Weiter → Fertig. Der Container Manager baut das Image (dauert beim ersten Mal ein paar Minuten) und startet es.
4. Test im Heimnetz: `http://<NAS-IP>:3000` öffnen → Login-Seite erscheint.

## 4. Ersten Admin anlegen

Beim allerersten Start gibt es noch keine User. **Container Manager → Container → garage → Protokoll**
zeigt eine Zeile:

```
Noch keine User. Ersten Admin anlegen über: https://garage.xyz.synology.me/?join=…
```

Diesen Link öffnen und registrieren — **der erste registrierte User wird automatisch Admin**. Danach im Tab
**Admin** den Einladungs-Link kopieren und an die WG schicken.

## 5. Zugriff von außen (HTTPS)

1. **DDNS**: Systemsteuerung → Externer Zugriff → DDNS → Hinzufügen, Anbieter *Synology*, z. B. `xyz.synology.me`.
2. **Zertifikat**: Systemsteuerung → Sicherheit → Zertifikat → Hinzufügen → *Let's Encrypt*,
   Domain `garage.xyz.synology.me` (bzw. als alternativer Name im bestehenden Zertifikat).
3. **Reverse Proxy**: Systemsteuerung → Anmeldeportal → Erweitert → Reverse Proxy → Erstellen
   - Quelle: `HTTPS`, Hostname `garage.xyz.synology.me`, Port `443`
   - Ziel: `HTTP`, `localhost`, Port `3000`
   - Danach unter Zertifikat → Einstellungen dem Dienst das Let's-Encrypt-Zertifikat zuweisen.
4. **Router**: Port `443` (TCP) auf die NAS-IP weiterleiten (bei Let's Encrypt zur Ausstellung auch kurz `80`).
5. Port `3000` **nicht** am Router freigeben — von außen nur über den Reverse Proxy.

Alternative ohne Portfreigabe: **Cloudflare Tunnel** (`cloudflared` als zweiter Container) auf `http://garage:3000`.

## 6. E-Mail (SMTP)

Ohne SMTP läuft alles außer „Passwort vergessen" und der Zahltag-Mail. Beispiele für `.env`:

| Anbieter | `SMTP_HOST` | `SMTP_PORT` | `SMTP_USER` | `SMTP_PASS` |
|---|---|---|---|---|
| Resend | `smtp.resend.com` | `465` | `resend` | API-Key (Domain bei Resend verifiziert) |
| Gmail | `smtp.gmail.com` | `465` | Gmail-Adresse | App-Passwort (2FA nötig) |

`SMTP_FROM` muss zu dem Konto/der Domain passen, sonst landen Mails im Spam. Nach Änderungen an `.env`
das Projekt im Container Manager neu starten.

## 7. Backup

Die komplette Datenbank ist der Ordner `/docker/garage/data`. Zwei Wege, am besten beide:

- **Hyper Backup** auf den Ordner `/docker/garage` (extern oder C2).
- **Tägliche konsistente Kopie** per Systemsteuerung → Aufgabenplaner → Erstellen → Geplante Aufgabe →
  Benutzerdefiniertes Script, Benutzer `root`, täglich:
  ```sh
  docker exec garage sh -c 'rm -f /data/backup-$(date +%u).db && node server/cli.js backup /data/backup-$(date +%u).db'
  ```
  Ergibt 7 rollierende Kopien (`backup-1.db` … `backup-7.db`). Zum Wiederherstellen Container stoppen,
  die gewünschte Kopie in `garage.db` umbenennen (vorher `garage.db-wal`/`-shm` löschen) und starten.

## 8. Updates

Neue Version als ZIP herunterladen, Dateien in `/docker/garage` überschreiben (`data/` und `.env` bleiben),
dann **Container Manager → Projekt → garage → Aktion → Erstellen** (baut neu und startet).

## 9. Notfall-Befehle

Container Manager → Container → garage → Aktion → **Terminal öffnen** → Erstellen → `sh`:

```sh
node server/cli.js invite                         # aktuellen Einladungs-Code anzeigen
node server/cli.js set-password <email> <neu>     # Passwort ohne Mail zurücksetzen
node server/cli.js make-admin <email>             # User zum Admin machen
node server/cli.js backup /data/manuell.db        # Backup jetzt
```

## 10. Alte Infrastruktur abschalten

Erst wenn die NAS-Version läuft und alle umgezogen sind: Vercel-Projekt löschen (oder die Git-Verbindung
trennen) und das Supabase-Projekt `dvdasdgduhfalrtcjrdb` pausieren bzw. löschen.
