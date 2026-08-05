# Garagen-Tool — Project Context

## KRITISCH: Context Folder — Fundament der Zusammenarbeit

Die `context/` Dokumentation ist **absolut essenziell** und muss immer aktuell sein. Sie bildet das Fundament, auf dem alle Arbeit — sowohl mit echten Devs als auch mit Claude Code — aufbaut. **Veraltete Doku führt zu falschen Annahmen und schlechtem Code.**

**Beim Start JEDER neuen Session — ZUERST, bevor irgendetwas anderes passiert:**

> **PFLICHT, nicht optional, kein Escape-Hatch.** Lies den **kompletten** `context/` Folder (ALLE unten gelisteten Files) durch, **bevor** du auf die erste Anfrage antwortest, Code liest, suchst, editierst oder eine Rückfrage stellst — auch bei scheinbar trivialen Fragen. NICHT "falls du ihn noch nicht kennst": Code und Doku ändern sich zwischen Sessions, also **jede Session komplett neu einlesen**. Erst wenn du den `context/` Folder gelesen hast, beginnst du mit der eigentlichen Aufgabe.

Danach, in derselben Reihenfolge:
1. Prüfe ob die Dokumentation mit dem aktuellen Code übereinstimmt (Schema in `supabase/migrations/`, Frontend in `src/`).
2. Falls nicht, update die relevanten Files **sofort**.

**Bei Commits:**
- Update den `context/` Folder wenn sich etwas Wesentliches ändert.
- Besonders: APPLICATION.md (neue Features/Business Rules), ARCHITECTURE.md (neue Tabellen/RLS-Policies/RPCs/Views).
- **Niemals Code-Änderungen committen ohne die betroffenen Context-Files zu prüfen und ggf. zu updaten.**
- **DB-Änderungen NUR als neue Migration** unter `supabase/migrations/` (nie bestehende editieren) und via Supabase-MCP `apply_migration` aufs Remote-Projekt anwenden.

**Context Files:**
- `context/APPLICATION.md` — Use Cases, Workflow, Business Rules (freigeben, buchen, stornieren, Ledger, Zahltag).
- `context/ARCHITECTURE.md` — DB-Schema, RLS-Policies, RPCs, Edge Function, Frontend-Struktur.
- `context/OPEN_QUESTIONS.md` — TODOs, bekannte Limitierungen, offene manuelle Setup-Schritte.

## Overview

WG-Tool für **23 Garagenplätze** und **max. 50 User**. Platzbesitzer geben ihren Platz bei Abwesenheit stundengenau frei, andere buchen ihn. Wer bucht, schuldet dem Besitzer **3 €/Tag Pauschale** (pro angefangenem Kalendertag, unabhängig von der gebuchten Stundenzahl) — ein Ledger hält fest, wer wem was schuldet, mit einseitigem „Beglichen"-Button (wir glauben dem Klicker, loggen aber wer/wann). Geschlossene Community: Der Admin lädt User ein und ordnet Plätze zu.

## Tech Stack

- **Frontend**: React 19 + TypeScript + Tailwind v4, Vite-SPA, gehostet auf Vercel.
- **Backend**: Supabase — Postgres (Auth, RLS, RPCs) + drei Edge Functions (Deno). Kein eigener API-Server; das SPA spricht via `supabase-js` direkt mit Postgres.
- **Auth**: E-Mail + Passwort (`signInWithPassword`). Kein offener Self-Signup in Supabase. Registrierung nur über den geheimen Einladungs-Link `?join=CODE` (Admin erzeugt/rotiert ihn auf der Admin-Seite; die `join`-Edge-Function legt den User mit `email_confirm:true` an → keine Bestätigungs-Mail). Passwort-Reset-Link öffnet ein „Passwort setzen"-Formular.
- **Zugriffskontrolle**: Row Level Security. Alle authenticated User dürfen **lesen** (Transparenz gewollt); Schreiben nur über enge Policies bzw. `security definer`-RPCs.
- **Tests**: Vitest (Slot-/Preis-Logik). DB-Smoke-Test als SQL (`scripts/db-smoke.sql`).
- **Supabase-Projekt-Ref**: `dvdasdgduhfalrtcjrdb`.

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
│   ├── supabase.ts          # Typisierter Supabase-Client
│   ├── database.types.ts    # Aus dem DB-Schema generiert (mcp generate_typescript_types)
│   ├── slots.ts             # Reine Logik: hourRange, priceCents, hourSpans, fmtEur, localDate, Slot
│   └── slots.test.ts        # Vitest-Tests dazu
└── pages/
    ├── Calendar.tsx         # Startseite: Monatsansicht, Buchen/Freigeben/Zurückziehen/Platz eintragen (claim_spot)
    ├── Garage.tsx           # Garagenplan als CSS-Grundriss (SPOT_POS nach echtem Plan) + Besitzer-Liste, keine Aktionen
    ├── MyBookings.tsx       # (ex Ledger.tsx) Künftige Buchungen mit Storno + offene/beglichene Schulden
    ├── Help.tsx             # Statische Bedienungsanleitung für User (Tab "Anleitung")
    ├── Admin.tsx            # Admin-Seite: Plätze zuweisen, Einladungs-Link, User verwalten, Tagessatz/Zahltag
    └── Join.tsx             # Selbstregistrierung über ?join=CODE-Link (Sucher/Platz-Wahl)

supabase/
├── migrations/              # Schema + RLS + RPCs (nur additiv, nie editieren)
└── functions/
    ├── zahltag/             # Edge Function: Zahltag-Mail an alle (admin-only, Resend)
    ├── join/               # Edge Function: Selbstregistrierung (verify_jwt=false, gated durch invites.code)
    └── delete-user/        # Edge Function: User löschen (admin-only)

scripts/db-smoke.sql         # Transaktionaler DB-Smoke-Test (rollt selbst zurück)
docs/superpowers/            # Spec + Implementierungsplan (Design-Historie)
README.md                    # Setup, Admin-Aufgaben, Vercel-Deploy
```

## Commands

```bash
npm run dev       # Vite Dev-Server
npm run build     # tsc --noEmit && vite build
npm test          # Vitest (Slot-/Preis-Logik)
npm run preview   # Production-Build lokal ansehen
```

DB-Migrationen und die Edge Function werden über den **Supabase-MCP** angewendet/deployed (`apply_migration`, `deploy_edge_function`), nicht über einen lokalen Supabase-Stack.

## Wichtige Hinweise

- **Beträge immer in Cents** (int) speichern; Anzeige via `fmtEur`. Tagessatz global in `settings.day_rate_cents` (aktuell 300 = 3 €), Preis = Anzahl **distinct Kalendertage** × Tagessatz (Tagespauschale, keine Halbierung — Stundenzahl pro Tag ist egal).
- **Stunden**: `hour` 0–23, ein Slot deckt `[hour, hour+1)` ab (Ende exklusiv, `endHour = 24` = bis Mitternacht).
- **Datum** immer `YYYY-MM-DD` lokal (`localDate`), nie `toISOString()` für Anzeige. (UTC-Arithmetik nur intern in `hourRange` zur Datums-Iteration.)
- **`free_slots` ist die Wahrheit**: eine Zeile pro freigegebener Stunde; `booking_id null` = frei, gesetzt = gebucht. Der Primärschlüssel `(spot_id, date, hour)` macht Doppelbuchungen DB-seitig unmöglich.
- **Geld-Logik lebt in der DB**, nicht im Frontend: `book_spot`/`cancel_booking`/`settle_ledger`/`claim_spot` sind `security definer`-RPCs; das Frontend ruft sie nur auf. Client- und Server-Preisformel müssen übereinstimmen (`new Set(slots.map(date)).size * rate` ↔ `count(distinct date) * rate`, keine Division mehr).
- **UI-Sprache Deutsch, Code/Identifier Englisch.**
