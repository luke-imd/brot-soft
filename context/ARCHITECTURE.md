# ARCHITECTURE — DB, RLS, RPCs, Frontend

## Prinzip

Kein eigener Backend-Server. Das React-SPA spricht via `supabase-js` **direkt** mit Postgres. Sicherheit = Row Level Security + `security definer`-RPCs, nicht App-Code. Eine einzige Edge Function (Zahltag-Mail) ist die Ausnahme, weil sie Service-Role-Rechte (User-Liste) und einen externen Mailversand braucht.

## Datenmodell

Quelle: `supabase/migrations/20260723000001_schema.sql`. Alle Beträge in **Cents (int)**.

| Tabelle | Spalten (wesentlich) | Zweck |
|---|---|---|
| `profiles` | `id` (PK, FK→`auth.users`), `name`, `is_admin` | 1:1 zu Auth-User; per Trigger `handle_new_user` bei Auth-Insert angelegt |
| `spots` | `id` (PK, int), `owner_id` (FK→profiles, nullable), `grid_row` (1–2), `grid_col` (1–12) | 24 Plätze, per Seed erzeugt; Position = Vogelperspektive-Layout |
| `settings` | `id` (bool-PK, immer true), `day_rate_cents` (default 500) | Single-Row-Konfiguration (Tagessatz) |
| `bookings` | `id` (uuid), `spot_id`, `borrower_id`, `created_at` | Eine Buchung; zugehörige Halbtage referenzieren sie |
| `free_slots` | **PK `(spot_id, date, half)`**, `booking_id` (FK→bookings, `on delete set null`) | Eine Zeile pro freigegebenem Halbtag; `booking_id null`=frei, gesetzt=gebucht |
| `ledger` | `id` (uuid), `booking_id` (unique, FK `on delete cascade`), `debtor_id`, `creditor_id`, `amount_cents`, `created_at`, `settled_at`, `settled_by` | Eine Schuldposition pro Buchung; Settled-Felder = Log |

`half` ist `check (half in ('am','pm'))`. FK-Verhalten trägt die Storno-Semantik: beim Löschen einer Buchung werden ihre Slots via `on delete set null` wieder frei und der Ledger-Eintrag via `on delete cascade` gelöscht.

## RLS-Policies

Quelle: `supabase/migrations/20260723000002_rls_rpc.sql`. RLS auf allen 6 Tabellen aktiv.

- **`read_all`** (SELECT, alle Tabellen, `authenticated`): jeder eingeloggte User liest alles (Transparenz).
- **`owner_frees`** (INSERT auf `free_slots`): nur wenn `booking_id is null` **und** der Platz dem User gehört → Besitzer gibt eigene Plätze frei.
- **`owner_retracts`** (DELETE auf `free_slots`): gleiche Bedingung → Freigabe zurückziehen, nur ungebuchte Slots.
- **`admin_updates`** (UPDATE auf `spots`/`settings`/`profiles`): nur `is_admin()`.
- **Kein** direktes INSERT/UPDATE/DELETE auf `bookings`/`ledger` für User — der einzige Weg führt über die RPCs. Dadurch können Beträge nicht clientseitig gefälscht werden.

Helper: `is_admin()` — `security definer`, liest `profiles.is_admin` für `auth.uid()`.

## RPCs (`security definer`, alle `set search_path = public`)

- **`book_spot(p_spot_id int, p_slots jsonb) → uuid`** — `p_slots` = `[{"date":"YYYY-MM-DD","half":"am"|"pm"}]`. Prüft Auth/Besitzer/Eigenplatz, legt Buchung an, setzt `booking_id` auf die passenden freien, zukünftigen Slots, prüft dass die Trefferzahl der erwarteten entspricht (sonst Exception → Rollback), legt Ledger-Eintrag mit `round(count*rate/2.0)` an. Atomar + race-sicher.
- **`cancel_booking(p_booking_id uuid) → void`** — nur eigene Buchung, nur vor Beginn (`min(date) > current_date`), **nicht** wenn bereits beglichen (Migration `...0004`). Löscht die Buchung; FKs geben Slots frei und löschen die Schuld.
- **`settle_ledger(p_ledger_id uuid) → void`** — setzt `settled_at`/`settled_by`, nur durch Schuldner **oder** Gläubiger, nur wenn noch offen.

**Grants**: Execute ist von `public`/`anon` entzogen und explizit an `authenticated` erteilt (Migration `...0003` — behebt die Postgres-Falle, dass EXECUTE per Default an PUBLIC geht).

## Migrationen (nur additiv, nie editieren)

| Datei | Inhalt |
|---|---|
| `...0001_schema.sql` | Tabellen, Seed (24 spots, settings-Zeile), `handle_new_user`-Trigger |
| `...0002_rls_rpc.sql` | RLS-Policies, `is_admin()`, die drei RPCs |
| `...0003_fix_rpc_grants.sql` | Execute-Grants: `public`/`anon` revoke, `authenticated` grant |
| `...0004_cancel_settled_guard.sql` | `cancel_booking` neu: verbietet Storno beglichener Schulden |

Anwenden per Supabase-MCP `apply_migration` (Name = Dateiname ohne `.sql`). DB-Typen nach Schema-Änderungen neu generieren (`generate_typescript_types` → `src/lib/database.types.ts`).

## Edge Function

- **`zahltag`** (`supabase/functions/zahltag/index.ts`, Deno) — vom Ledger-Admin-Button via `supabase.functions.invoke('zahltag')` aufgerufen. Prüft, dass der Aufrufer Admin ist (sonst 403), **bevor** Service-Role-Arbeit passiert; listet Auth-User, verschickt via **Resend** eine Mail an alle (`bcc`), Antwort `{ sent: number }`. CORS auf allen Pfaden inkl. top-level `try/catch` (500 mit CORS bei unerwarteten Fehlern). `verify_jwt: true`. Braucht Secret `RESEND_API_KEY`.

## Frontend

- **`App.tsx`** — Auth-Gate (`getSession` + `onAuthStateChange`), Tab-Shell (Garage/Kalender/Ledger/Anleitung), globales „Passwort setzen"-Formular (öffnet automatisch bei Invite-/Recovery-Link via URL-Hash).
- **`Login.tsx`** — E-Mail + Passwort (`signInWithPassword`), „Passwort vergessen" (`resetPasswordForEmail`).
- **`pages/Garage.tsx`** — Vogelperspektive: CSS-Grid 2×12 aus `grid_row`/`grid_col`, Farb-Status pro Tag/Halbtag, Detail-Panel mit Buchen (Nicht-Besitzer) / Freigeben+Zurückziehen (Besitzer) / Stornieren (eigene Buchung). Buchen/Stornieren via RPC, Freigeben/Zurückziehen direkt auf `free_slots`. `RangeForm`-Instanzen tragen `key` (Reset bei Platz-/Datumswechsel).
- **`pages/Calendar.tsx`** — Monatsansicht (Wochenstart Montag), freie Plätze pro Tag, Tag-Klick listet freie Plätze mit Buchen-Form.
- **`pages/Ledger.tsx`** — offene Posten „X schuldet Y n €" mit Beglichen-Button (nur Beteiligte), aufklappbare Beglichen-Historie, Admin-Karte (Tagessatz €↔Cents, Zahltag-Button).
- **`pages/Help.tsx`** — statische Bedienungsanleitung (Tab „Anleitung"): Farben, Halbtage, buchen/freigeben/stornieren/begleichen, Passwort. Kein Datenzugriff, keine Props.
- **`lib/slots.ts`** — reine Logik, TDD-getestet: `slotRange`, `priceCents`, `fmtEur`, `localDate`, Typen `Half`/`Slot`. `Slot` ist ein Type-Alias (nicht Interface), damit es an den generierten `Json`-RPC-Parametertyp zuweisbar ist.

## Deploy

Frontend auf Vercel (Vite, Repo-Root, Env `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`). Details + einmalige Supabase-Setup-Schritte im `README.md`.
