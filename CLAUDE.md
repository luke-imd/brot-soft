# Garagen-Tool — Project Context

## KRITISCH: Context Folder — Fundament der Zusammenarbeit

Die `context/` Dokumentation ist **absolut essenziell** und muss immer aktuell sein. Sie bildet das Fundament, auf dem alle Arbeit — sowohl mit echten Devs als auch mit Claude Code — aufbaut. **Veraltete Doku führt zu falschen Annahmen und schlechtem Code.**

**Beim Start JEDER neuen Session — ZUERST, bevor irgendetwas anderes passiert:**

> **PFLICHT, nicht optional, kein Escape-Hatch.** Lies den **kompletten** `context/` Folder (ALLE unten gelisteten Files) durch, **bevor** du auf die erste Anfrage antwortest, Code liest, suchst, editierst oder eine Rückfrage stellst — auch bei scheinbar trivialen Fragen. NICHT "falls du ihn noch nicht kennst": Code und Doku ändern sich zwischen Sessions, also **jede Session komplett neu einlesen**. Erst wenn du den `context/` Folder gelesen hast, beginnst du mit der eigentlichen Aufgabe.

Danach, in derselben Reihenfolge:
1. Prüfe ob die Dokumentation mit dem aktuellen Code übereinstimmt (Schema in `server/db.js`, API in `server/app.js`, Frontend in `src/`).
2. Falls nicht, update die relevanten Files **sofort**.

**Bei Commits:**
- Update den `context/` Folder wenn sich etwas Wesentliches ändert.
- Besonders: APPLICATION.md (neue Features/Business Rules), ARCHITECTURE.md (neue Tabellen/Endpunkte/Rechte-Regeln).
- **Niemals Code-Änderungen committen ohne die betroffenen Context-Files zu prüfen und ggf. zu updaten.**
- **DB-Änderungen nur additiv** in `server/db.js` (`create ... if not exists`, neue Spalten per `alter table` mit Existenz-Check) — die Datenbank auf der NAS wird nie neu angelegt.

**Context Files:**
- `context/APPLICATION.md` — Use Cases, Workflow, Business Rules (freigeben, buchen, stornieren, Ledger, Zahltag).
- `context/ARCHITECTURE.md` — DB-Schema, Auth, API-Endpunkte, Frontend-Struktur, Deploy.
- `context/OPEN_QUESTIONS.md` — TODOs, bekannte Limitierungen, offene manuelle Setup-Schritte.

## Overview

WG-Tool für **23 Garagenplätze** und **max. 50 User**. Platzbesitzer geben ihren Platz bei Abwesenheit stundengenau frei, andere buchen ihn. Wer bucht, schuldet dem Besitzer **3 €/Tag Pauschale** (pro angefangenem Kalendertag, unabhängig von der gebuchten Stundenzahl) — ein Ledger hält fest, wer wem was schuldet, mit einseitigem „Beglichen"-Button (wir glauben dem Klicker, loggen aber wer/wann). Geschlossene Community: Der Admin lädt User ein und ordnet Plätze zu.

## Tech Stack

- **Frontend**: React 19 + TypeScript + Tailwind v4, Vite-SPA. Spricht über `src/lib/api.ts` (`fetch`) mit der eigenen API.
- **Backend**: Node (Express 5, plain JavaScript ESM) in `server/`, Datenbank SQLite über das eingebaute `node:sqlite` (eine Datei, `/data/garage.db`). Server liefert API (`/api`) und das gebaute Frontend aus.
- **Hosting**: ein Docker-Container auf der Synology NAS (Container Manager + DSM-Reverse-Proxy), siehe `docs/SYNOLOGY.md`. Supabase + Vercel sind abgelöst.
- **Auth**: E-Mail + Passwort (scrypt), Session-Cookie (HttpOnly). Registrierung nur über den geheimen Einladungs-Link `?join=CODE`; der erste registrierte User wird Admin. Passwort vergessen per SMTP-Mail mit `?reset=TOKEN`.
- **Zugriffskontrolle**: im Server pro Endpunkt. Alle eingeloggten User dürfen **lesen** (Transparenz gewollt); Schreiben nur über die Endpunkte mit ihren Regeln.
- **Tests**: Vitest — Slot-/Preis-Logik (`src/lib/slots.test.ts`) und API-Tests gegen den echten Server mit In-Memory-DB (`server/api.test.js`).

## Project Structure

```
src/
├── main.tsx                 # React entrypoint
├── App.tsx                  # Auth-Gate + Join-Routing + Tab-Shell (Kalender/Garage/Meine Buchungen/Anleitung/Admin) + Passwort-Formular
├── Login.tsx                # E-Mail+Passwort-Login, "Passwort vergessen"
├── index.css                # @import "tailwindcss"
├── components/
│   └── RangeForm.tsx        # Wiederverwendbares Datum+Stunde-von-bis-Formular mit Preisanzeige (Kalender)
├── lib/
│   ├── api.ts               # fetch-Wrapper für /api (api.get/post/put/del, attempt)
│   ├── slots.ts             # Reine Logik: hourRange, priceCents, hourSpans, fmtEur, localDate, Slot
│   └── slots.test.ts        # Vitest-Tests dazu
└── pages/
    ├── Calendar.tsx         # Startseite: Monatsansicht, Buchen/Freigeben/Zurückziehen/Platz eintragen
    ├── Garage.tsx           # Garagenplan als CSS-Grundriss (SPOT_POS nach echtem Plan) + Besitzer-Liste, keine Aktionen
    ├── MyBookings.tsx       # (ex Ledger.tsx) Künftige Buchungen mit Storno + offene/beglichene Schulden
    ├── Help.tsx             # Statische Bedienungsanleitung für User (Tab "Anleitung")
    ├── Admin.tsx            # Admin-Seite: Plätze zuweisen, Einladungs-Link, User verwalten, Tagessatz/Zahltag
    ├── Join.tsx             # Selbstregistrierung über ?join=CODE-Link (optionale Platz-Wahl)
    └── ResetPassword.tsx    # Landeseite des Passwort-Reset-Links (?reset=TOKEN)

server/
├── index.js                 # Start: DB öffnen, API + dist/ ausliefern, Bootstrap-Hinweis ins Log
├── app.js                   # Alle API-Endpunkte inkl. Geschäftsregeln (ersetzt RLS/RPCs/Edge Functions)
├── db.js                    # SQLite-Schema, Seed, tx()-Helper
├── auth.js                  # scrypt, Sessions, Reset-Tokens, Cookies, Rate-Limit
├── mail.js                  # SMTP via nodemailer
├── cli.js                   # Notfall: invite | set-password | make-admin | backup
└── api.test.js              # API-Tests (Vitest)

Dockerfile, docker-compose.yml, .env.example   # Container für die Synology
docs/SYNOLOGY.md             # Betriebsanleitung NAS (Setup, Reverse Proxy, SMTP, Backup, Updates)
docs/superpowers/            # Spec + Implementierungsplan (Design-Historie)
README.md                    # Lokal entwickeln, Admin-Aufgaben
```

## Commands

```bash
npm run server    # API-Server auf :3000 mit --watch (DB: ./data/garage.db)
npm run dev       # Vite Dev-Server, /api wird an :3000 weitergeleitet
npm run build     # tsc --noEmit && vite build
npm start         # Production: Server liefert dist/ + API aus
npm test          # Vitest (Slot-/Preis-Logik + API-Tests)
docker compose up -d --build   # Container wie auf der NAS
```

## Wichtige Hinweise

- **Beträge immer in Cents** (int) speichern; Anzeige via `fmtEur`. Tagessatz global in `settings.day_rate_cents` (aktuell 300 = 3 €), Preis = Anzahl **distinct Kalendertage** × Tagessatz (Tagespauschale, keine Halbierung — Stundenzahl pro Tag ist egal).
- **Stunden**: `hour` 0–23, ein Slot deckt `[hour, hour+1)` ab (Ende exklusiv, `endHour = 24` = bis Mitternacht).
- **Datum** immer `YYYY-MM-DD` lokal (`localDate`), nie `toISOString()` für Anzeige. (UTC-Arithmetik nur intern in `hourRange` zur Datums-Iteration.)
- **Datum „heute"** im Server ist das lokale Datum (`TZ=Europe/Vienna` im Container), nicht UTC.
- **`free_slots` ist die Wahrheit**: eine Zeile pro freigegebener Stunde; `booking_id null` = frei, gesetzt = gebucht. Der Primärschlüssel `(spot_id, date, hour)` macht Doppelbuchungen DB-seitig unmöglich.
- **Geld-Logik lebt im Server**, nicht im Frontend: Buchen/Stornieren/Begleichen/Beanspruchen sind Endpunkte in `server/app.js` mit Transaktion (`tx()`); das Frontend ruft sie nur auf. Client- und Server-Preisformel müssen übereinstimmen (`new Set(slots.map(date)).size * rate` in beiden).
- **UI-Sprache Deutsch, Code/Identifier Englisch.**
