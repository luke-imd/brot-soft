# ARCHITECTURE — Server, DB, API, Frontend

## Prinzip

Ein Node-Prozess (Express 5) in einem Docker-Container: liefert das gebaute React-SPA (`dist/`) aus und
stellt unter `/api` eine JSON-API bereit. Daten in **SQLite** (eingebautes `node:sqlite`, keine nativen
Abhängigkeiten), eine Datei im Volume `/data/garage.db`. Alle Schreib-Regeln (früher RLS-Policies und
`security definer`-RPCs in Supabase) stehen jetzt in genau einem Endpunkt in `server/app.js`.

Race-Sicherheit: `node:sqlite` ist synchron und der Server ein einzelner Prozess — jede Transaktion
(`tx()` in `server/db.js`, `begin immediate`) läuft komplett durch, bevor der nächste Request
drankommt. Zusätzlich verhindern PK `(spot_id, date, hour)` und bedingte `UPDATE ... WHERE booking_id is null`
Doppelbuchungen auf DB-Ebene.

## Datenmodell (`server/db.js`)

Schema wird beim Start per `create table if not exists` angelegt, Seed beim ersten Start (23 Plätze,
5/7/9/19 inaktiv, Tagessatz 300, zufälliger Einladungs-Code). Alle Beträge in **Cents (int)**, Datum als
Text `YYYY-MM-DD`, Zeitstempel als ISO-String, Booleans als 0/1 (API liefert `true/false`).
`pragma foreign_keys = on`, WAL-Modus.

| Tabelle | Spalten (wesentlich) | Zweck |
|---|---|---|
| `users` | `id` (uuid), `email` (unique, lowercase), `name`, `password_hash` (scrypt), `is_admin`, `seeker`, `created_at` | Ersetzt `auth.users` + `profiles` |
| `sessions` | `token_hash` (sha256 des Cookie-Tokens), `user_id` (cascade), `expires_at` | Login-Sessions, 180 Tage |
| `password_resets` | `token_hash`, `user_id` (cascade), `expires_at` | Einmal-Reset-Tokens, 60 Minuten |
| `spots` | `id` (1–23), `owner_id` (nullable), `active` | 5/7/9/19 inaktiv, `owner_id` dort dauerhaft null |
| `settings` | `id = 1`, `day_rate_cents` | Single-Row, Tagespauschale |
| `invites` | `id = 1`, `code` | Single-Row, geheimer `?join=`-Code |
| `bookings` | `id` (uuid), `spot_id`, `borrower_id`, `created_at` | Eine Buchung |
| `free_slots` | **PK `(spot_id, date, hour)`**, `hour` 0–23, `booking_id` (FK `on delete set null`) | Eine Zeile pro freigegebener Stunde `[hour, hour+1)`; `booking_id null` = frei |
| `ledger` | `id`, `booking_id` (unique, FK `on delete cascade`), `debtor_id`, `creditor_id`, `amount_cents`, `created_at`, `settled_at`, `settled_by` | Eine Schuldposition pro Buchung |

FK-Verhalten trägt die Storno-Semantik: Buchung löschen → Slots wieder frei, Ledger-Eintrag gelöscht.
Schema-Änderungen: `server/db.js` additiv erweitern (`create ... if not exists`, bei neuen Spalten ein
`alter table` mit Existenz-Check), weil bestehende NAS-Datenbanken nicht neu angelegt werden.

## Auth (`server/auth.js`)

- Passwort: `scrypt` mit Salt (`scrypt$salt$hash`), Vergleich `timingSafeEqual`.
- Session: zufälliges Token im Cookie `garage_sid` (`HttpOnly`, `SameSite=Lax`, `Secure` hinter HTTPS
  via `trust proxy`), in der DB nur der sha256-Hash.
- CSRF: schreibende `/api`-Requests müssen `Content-Type: application/json` haben (sonst 415) — fremde
  Seiten können das ohne CORS-Preflight nicht senden; CORS ist nicht freigegeben.
- Rate-Limit (In-Memory, pro IP, 30 / 15 min) auf Login, Passwort vergessen/Reset, Registrierung.
- Passwort ändern meldet alle anderen Sessions ab; Reset meldet alle Sessions ab.

## API (`server/app.js`)

Fehler immer als `{ error: "<deutsche Meldung>" }` mit 4xx (Business-Regel 400, nicht eingeloggt 401,
kein Recht 403).

| Methode + Pfad | Wer | Was (früheres Supabase-Gegenstück) |
|---|---|---|
| `GET /api/health` | alle | Healthcheck für Docker |
| `GET /api/auth/me` | eingeloggt | `{id,email,name,is_admin}` |
| `POST /api/auth/login` · `/logout` | alle | `signInWithPassword` / `signOut` |
| `POST /api/auth/password` | eingeloggt | `updateUser({password})` |
| `POST /api/auth/forgot` | alle | Reset-Mail mit `APP_URL/?reset=TOKEN` (gleiche Antwort auch für unbekannte Adressen) |
| `POST /api/auth/reset` | Token | neues Passwort + direkt eingeloggt |
| `POST /api/join` | Invite-Code | `join`-Edge-Function: `{code, list:true}` → freie Plätze; sonst Registrierung (50-Deckel, Wunsch-Platz bedingt, **erster User wird Admin**), loggt direkt ein |
| `GET /api/spots` · `/profiles` · `/settings` · `/ledger` | eingeloggt | `read_all` (Transparenz) |
| `GET /api/free-slots?from&to` | eingeloggt | ungebuchte Stunden im Zeitraum |
| `GET /api/my-bookings` | eingeloggt | eigene Buchungen `{id, spot_id, slots[]}` |
| `POST /api/free-slots` | Besitzer | `owner_frees` (Duplikate ignoriert) |
| `POST /api/free-slots/retract` | Besitzer | `owner_retracts` (nur ungebuchte Stunden) |
| `POST /api/bookings` | eingeloggt | `book_spot`: atomar Buchung + Stunden + Ledger, Preis = `distinct Tage × Tagessatz`, nur `date >= heute` |
| `POST /api/bookings/:id/cancel` | Bucher | `cancel_booking`: nur bis Vortag, nicht wenn beglichen |
| `POST /api/ledger/:id/settle` | Schuldner/Gläubiger | `settle_ledger` |
| `POST /api/spots/:id/claim` | eingeloggt | `claim_spot` (besitzerlos + aktiv, erster gewinnt) |
| `PUT /api/admin/spots/:id` | Admin | Besitzer setzen (nur aktive Plätze) |
| `PUT /api/admin/profiles/:id` | Admin | Admin-Recht (nicht für sich selbst) |
| `DELETE /api/admin/profiles/:id` | Admin | `delete-user`: nur ohne Buchungs-/Ledger-Historie, nie sich selbst, Plätze werden frei |
| `PUT /api/admin/settings` | Admin | Tagessatz |
| `GET` / `POST /api/admin/invite` | Admin | Code lesen / rotieren |
| `POST /api/admin/zahltag` | Admin | Zahltag-Mail per SMTP (`to` Admin, `bcc` alle anderen) |

„Heute" ist das **lokale** Datum des Containers (`TZ=Europe/Vienna`), nicht mehr UTC.

## Mail (`server/mail.js`)

nodemailer, konfiguriert über `SMTP_HOST/PORT/USER/PASS/FROM`. Ohne `SMTP_HOST` antworten
`/auth/forgot` und `/admin/zahltag` mit 503 und klarer Meldung; alles andere läuft.

## CLI (`server/cli.js`)

Notfall im Container: `invite`, `set-password <email> <pw>`, `make-admin <email>`, `backup <datei>`
(`vacuum into`, konsistent im laufenden Betrieb).

## Frontend

- **`lib/api.ts`** — `fetch`-Wrapper (`api.get/post/put/del`, wirft `ApiError` mit Server-Meldung) und
  `attempt()` für `[data, error]`-Tupel. Session läuft übers Cookie, kein Token im JS.
- **`App.tsx`** — Auth-Gate über `GET /auth/me`, Routing: `?reset=TOKEN` → `ResetPassword`,
  `?join=CODE` ohne Login → `Join`, sonst `Login` bzw. Tab-Shell (**Kalender** / Garage / Meine Buchungen /
  Anleitung / Admin) mit Sticky-Header und „Passwort ändern"-Modal. Logout setzt den Tab auf Kalender zurück.
- **`Login.tsx`** — Login, „Passwort vergessen" (`/auth/forgot`).
- **`pages/ResetPassword.tsx`** — Landeseite des Reset-Links: neues Passwort zweimal, danach eingeloggt.
- **`pages/Calendar.tsx`** — Startseite. Monatsansicht (Wochenstart Montag); grünes „n frei"-Badge für fremde
  freie Plätze, blaues „meins"-Badge für eigene Freigaben; Tagesliste mit gemergten Stundenbereichen
  (`hourSpans`/`fmtSpan`), `RangeForm` bucht; Card „Mein Platz": freigeben/zurückziehen bzw. Platz beanspruchen.
- **`pages/Garage.tsx`** — statischer CSS-Grundriss (`SPOT_POS`) + Besitzerliste, keine Aktionen.
- **`pages/MyBookings.tsx`** — künftige eigene Buchungen mit Storno (bis Vortag) + offene Ledger-Posten mit
  „Schulden beglichen" (nur Beteiligte) + aufklappbare Beglichen-Historie.
- **`pages/Help.tsx`** — statische Anleitung.
- **`pages/Admin.tsx`** — Plätze zuweisen, Einladungs-Link, User verwalten, Tagessatz & Zahltag.
- **`pages/Join.tsx`** — Registrierung über `?join=CODE` mit optionaler Platz-Wahl; Server loggt direkt ein.
- **`components/RangeForm.tsx`**, **`lib/slots.ts`** — unverändert (Zeitraum-Formular, reine Slot-/Preis-Logik).

## Tests

`npm test` (Vitest): `src/lib/slots.test.ts` (Slot-/Preis-Logik) und `server/api.test.js` — startet den
echten Server mit In-Memory-SQLite und Fake-Mailer und prüft Registrierung/Admin-Bootstrap, Rechte
(401/403), Login/Logout, Freigeben/Zurückziehen, Buchen (Tagespauschale, Eigen-/Doppelbuchung, Rollback),
Storno (Fremd, Same-Day, beglichen), Begleichen, Claim, Admin-Funktionen, User löschen, Passwort-Reset
(Einmal-Token, Session-Abmeldung), Zahltag und CSRF-Schutz.

## Deploy

Docker-Image (`Dockerfile`, multi-stage, `node:24-alpine`), `docker-compose.yml` mit Bind-Mount `./data:/data`
und `.env`. Auf der Synology über Container Manager → Projekt, davor DSM-Reverse-Proxy mit Let's Encrypt.
Vollständige Anleitung: `docs/SYNOLOGY.md`.
