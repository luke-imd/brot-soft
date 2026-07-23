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

WG-Tool für **24 Garagenplätze** und **max. 50 User**. Platzbesitzer geben ihren Platz bei Abwesenheit halbtags frei, andere buchen ihn. Wer bucht, schuldet dem Besitzer 5 €/Tag (2,50 €/Halbtag) — ein Ledger hält fest, wer wem was schuldet, mit einseitigem „Beglichen"-Button (wir glauben dem Klicker, loggen aber wer/wann). Geschlossene Community: Der Admin lädt User ein und ordnet Plätze zu.

## Tech Stack

- **Frontend**: React 19 + TypeScript + Tailwind v4, Vite-SPA, gehostet auf Vercel.
- **Backend**: Supabase — Postgres (Auth, RLS, RPCs) + eine Edge Function (Deno). Kein eigener API-Server; das SPA spricht via `supabase-js` direkt mit Postgres.
- **Auth**: E-Mail + Passwort (`signInWithPassword`). Kein Self-Signup — nur eingeladene User. Invite-/Reset-Link öffnet ein „Passwort setzen"-Formular in der App.
- **Zugriffskontrolle**: Row Level Security. Alle authenticated User dürfen **lesen** (Transparenz gewollt); Schreiben nur über enge Policies bzw. `security definer`-RPCs.
- **Tests**: Vitest (Slot-/Preis-Logik). DB-Smoke-Test als SQL (`scripts/db-smoke.sql`).
- **Supabase-Projekt-Ref**: `dvdasdgduhfalrtcjrdb`.

## Project Structure

```
src/
├── main.tsx                 # React entrypoint
├── App.tsx                  # Auth-Gate + Tab-Shell (Garage/Kalender/Ledger) + Passwort-Formular
├── Login.tsx                # E-Mail+Passwort-Login, "Passwort vergessen"
├── index.css                # @import "tailwindcss"
├── components/
│   └── RangeForm.tsx        # Wiederverwendbares Datum-von-bis + Halbtag-Formular (Garage & Kalender)
├── lib/
│   ├── supabase.ts          # Typisierter Supabase-Client
│   ├── database.types.ts    # Aus dem DB-Schema generiert (mcp generate_typescript_types)
│   ├── slots.ts             # Reine Logik: slotRange, priceCents, fmtEur, localDate, Half, Slot
│   └── slots.test.ts        # Vitest-Tests dazu
└── pages/
    ├── Garage.tsx           # Vogelperspektive (2×12 Grid), buchen/freigeben/stornieren
    ├── Calendar.tsx         # Monatsansicht, freie Plätze pro Tag, buchen
    └── Ledger.tsx           # Schulden-Liste, einseitiges Begleichen, Admin-Bereich

supabase/
├── migrations/              # Schema + RLS + RPCs (nur additiv, nie editieren)
└── functions/zahltag/       # Edge Function: Zahltag-Mail an alle (admin-only, Resend)

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

- **Beträge immer in Cents** (int) speichern; Anzeige via `fmtEur`. Tagessatz global in `settings.day_rate_cents` (initial 500), Halbtag = halber Tagessatz.
- **Halbtage**: `am` (00–12 Uhr) / `pm` (12–24 Uhr). Ein ganzer Tag = beide Slots.
- **Datum** immer `YYYY-MM-DD` lokal (`localDate`), nie `toISOString()` für Anzeige. (UTC-Arithmetik nur intern in `slotRange` zur Datums-Iteration.)
- **`free_slots` ist die Wahrheit**: eine Zeile pro freigegebenem Halbtag; `booking_id null` = frei, gesetzt = gebucht. Der Primärschlüssel `(spot_id, date, half)` macht Doppelbuchungen DB-seitig unmöglich.
- **Geld-Logik lebt in der DB**, nicht im Frontend: `book_spot`/`cancel_booking`/`settle_ledger` sind `security definer`-RPCs; das Frontend ruft sie nur auf. Client- und Server-Preisformel müssen übereinstimmen (`Math.round(n*rate/2)` ↔ `round(count*rate/2.0)`).
- **UI-Sprache Deutsch, Code/Identifier Englisch.**
