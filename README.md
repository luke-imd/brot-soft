# Garagen-Tool

WG-Tool für 23 Garagenplätze: freigeben, buchen, Schulden-Ledger (stundengenau, 3 €-Tagespauschale).
Spec: `docs/superpowers/specs/2026-08-03-hourly-booking-redesign-design.md`
(historisch: `docs/superpowers/specs/2026-07-23-garage-management-design.md`)

## Stack

Ein Docker-Container: Node (Express) + SQLite (`node:sqlite`) liefert API und das React/TS/Tailwind-Frontend
(Vite) aus. Läuft auf der Synology NAS — **Betriebsanleitung: [`docs/SYNOLOGY.md`](docs/SYNOLOGY.md)**.
(Bis Oktober 2026 lief die App auf Supabase + Vercel.)

## Lokal entwickeln

```bash
npm install
npm run server    # API auf :3000 (DB in ./data/garage.db, startet bei Änderungen neu)
npm run dev       # Vite-Frontend, leitet /api an :3000 weiter
npm test          # Unit-Tests (Slot-/Preis-Logik) + API-Tests (In-Memory-DB)
```

Beim ersten Start steht im Server-Log ein `?join=…`-Link — der erste registrierte User wird Admin.
Mails (Passwort vergessen, Zahltag) brauchen `SMTP_*`-Variablen (siehe `.env.example`), lokal optional.

Production-Build lokal: `npm run build && npm start` → http://localhost:3000

## Betrieb (Admin-Aufgaben) — alles in der App, Tab "Admin"

- **User einladen:** "Einladungs-Link" kopieren und teilen. Wer den Link hat, registriert
  sich selbst (Name/E-Mail/Passwort) und ist sofort drin — keine E-Mail nötig, max. 50 User.
  Bei Verdacht auf Leak: "Neuen Link erzeugen" (alter wird ungültig).
- **Platz zuordnen:** unter "Plätze zuweisen" pro Platz (1–23, außer den inaktiven
  Fahrrad-/Traktorplätzen 5/7/9/19) den Besitzer wählen.
- **User verwalten:** zum Admin machen / Admin entziehen / löschen (Löschen geht nur, wenn der
  User keine Buchungen oder Schulden(-Historie) hat).
- **Tagessatz ändern / Zahltag-Mail:** unter "Tagessatz & Zahltag".

Notfall ohne UI/Mail (Passwort setzen, Admin machen, Backup): `node server/cli.js` im Container,
siehe `docs/SYNOLOGY.md`.
