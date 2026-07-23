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
| `invites` | `id` (bool-PK, immer true), `code` | Single-Row: geheimer Registrierungs-Code für den `?join=`-Link. Nur Admins lesen/rotieren (RLS) |
| `bookings` | `id` (uuid), `spot_id`, `borrower_id`, `created_at` | Eine Buchung; zugehörige Halbtage referenzieren sie |
| `free_slots` | **PK `(spot_id, date, half)`**, `booking_id` (FK→bookings, `on delete set null`) | Eine Zeile pro freigegebenem Halbtag; `booking_id null`=frei, gesetzt=gebucht |
| `ledger` | `id` (uuid), `booking_id` (unique, FK `on delete cascade`), `debtor_id`, `creditor_id`, `amount_cents`, `created_at`, `settled_at`, `settled_by` | Eine Schuldposition pro Buchung; Settled-Felder = Log |

`half` ist `check (half in ('am','pm'))`. FK-Verhalten trägt die Storno-Semantik: beim Löschen einer Buchung werden ihre Slots via `on delete set null` wieder frei und der Ledger-Eintrag via `on delete cascade` gelöscht.

## RLS-Policies

Quelle: `supabase/migrations/20260723000002_rls_rpc.sql`. RLS auf allen 6 Tabellen aktiv.

- **`read_all`** (SELECT, alle Tabellen, `authenticated`): jeder eingeloggte User liest alles (Transparenz).
- **`owner_frees`** (INSERT auf `free_slots`): nur wenn `booking_id is null` **und** der Platz dem User gehört → Besitzer gibt eigene Plätze frei.
- **`owner_retracts`** (DELETE auf `free_slots`): gleiche Bedingung → Freigabe zurückziehen, nur ungebuchte Slots.
- **`admin_updates`** (UPDATE auf `spots`/`settings`/`profiles`): nur `is_admin()`. → trägt die Admin-Seite (Plätze zuweisen, Tagessatz, Admin-Rechte toggeln).
- **`admin_reads`/`admin_updates`** auf `invites`: nur `is_admin()` — Einladungs-Code lesen/rotieren.
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
| `...0005_invites.sql` | `invites`-Tabelle (Registrierungs-Code) + admin-only RLS |

Anwenden per Supabase-MCP `apply_migration` (Name = Dateiname ohne `.sql`). DB-Typen nach Schema-Änderungen neu generieren (`generate_typescript_types` → `src/lib/database.types.ts`).

## Edge Functions

Alle drei: CORS auf allen Pfaden, top-level `try/catch`, Deno.

- **`zahltag`** (`verify_jwt: true`) — vom Admin-Button aufgerufen. Prüft Admin (sonst 403) **vor** Service-Role-Arbeit; listet Auth-User, verschickt via **Resend** eine Mail an alle (`bcc`), Antwort `{ sent: number }`. Braucht Secret `RESEND_API_KEY`.
- **`join`** (`verify_jwt: false`) — öffentliche Selbstregistrierung, aufgerufen von der Join-Seite. Validiert Eingaben (E-Mail, Passwort ≥6, Name), prüft den geheimen `invites.code` (Service-Role-Read), deckelt bei `MAX_USERS = 50` (Count auf `profiles`), legt den User mit `email_confirm: true` an (keine Bestätigungs-Mail; Profil kommt per `handle_new_user`-Trigger). Antwort `{ ok, error? }` (200 auch bei Logikfehlern, 500 nur bei Exceptions).
- **`delete-user`** (`verify_jwt: true`) — Admin löscht einen User. Prüft Admin, verhindert Selbstlöschung, löst zuerst `spots.owner_id`, dann `admin.deleteUser`. Schlägt (mit klarer Meldung) fehl, wenn der User Buchungen/Ledger-Historie hat (FK RESTRICT).

## Frontend

- **`App.tsx`** — Auth-Gate (`getSession` + `onAuthStateChange`), Join-Routing (bei `?join=CODE` und ohne Session → `Join`-Seite), `is_admin`+`name`-Abfrage (Admin-Tab, User-Chip mit Initialen im Header), Tab-Shell (Garage/Kalender/Ledger/Anleitung/Admin) mit Sticky-Header (Ink-„P"-Logo, Pill-Tabs), Passwort-Dialog als Modal („Passwort ändern"; öffnet automatisch bei Invite-/Recovery-Link via URL-Hash, dann als „Neues Passwort setzen").
- **`Login.tsx`** — E-Mail + Passwort (`signInWithPassword`), „Passwort vergessen" (`resetPasswordForEmail`).
- **`pages/Garage.tsx`** — Grundriss-Ansicht (Design aus claude.ai/design übernommen): dunkles Asphalt-Panel mit CSS-Grid 2×12 aus `grid_row`/`grid_col`, Kacheln mit Platznummer + Besitzer-Initialen („ICH" für eigene), Status pro Tag/Halbtag inkl. `unowned` (gestrichelt, Platz ohne Besitzer). Toolbar: Tages-Navigation (‹/›/Heute + Date-Input) und Vormittag/Nachmittag-Segmentschalter. Sidebar: Auswahl-Karte (Besitzer → Freigeben/Zurückziehen; frei → Buchen mit Preis; meine → Stornieren; sonst Info-Box), Empty-State und „Meine Buchungen"-Liste (alle eigenen künftigen Buchungen via PostgREST-Embed `bookings→free_slots`, mit Kosten und Storno bis Vortag). Erfolgs-/Fehler-Feedback als Toast. Buchen/Stornieren via RPC, Freigeben/Zurückziehen direkt auf `free_slots`. `RangeForm`-Instanzen tragen `key` (Reset bei Platz-/Datumswechsel).
- **`pages/Calendar.tsx`** — Monatsansicht (Wochenstart Montag), freie Plätze pro Tag, Tag-Klick listet freie Plätze mit Buchen-Form.
- **`pages/Ledger.tsx`** — offene Posten „X schuldet Y n €" mit Beglichen-Button (nur Beteiligte), aufklappbare Beglichen-Historie, Admin-Karte (Tagessatz €↔Cents, Zahltag-Button).
- **`pages/Help.tsx`** — statische Bedienungsanleitung (Tab „Anleitung"): Farben, Halbtage, buchen/freigeben/stornieren/begleichen, Passwort. Kein Datenzugriff, keine Props.
- **`pages/Admin.tsx`** — nur für Admins sichtbar (Tab „Admin"). Vier Sektionen: Plätze zuweisen (`spots.owner_id` via UPDATE), Einladungs-Link (anzeigen/kopieren/rotieren via `invites`), User verwalten (Admin-Toggle via `profiles`, Löschen via `delete-user`-Function), Tagessatz & Zahltag (aus dem Ledger hierher gezogen).
- **`pages/Join.tsx`** — Selbstregistrierung: Name/E-Mail/Passwort → `join`-Function, danach direkter `signInWithPassword` und Redirect auf `origin` (entfernt `?join`).
- **`lib/slots.ts`** — reine Logik, TDD-getestet: `slotRange`, `priceCents`, `fmtEur`, `localDate`, Typen `Half`/`Slot`. `Slot` ist ein Type-Alias (nicht Interface), damit es an den generierten `Json`-RPC-Parametertyp zuweisbar ist.

## Deploy

Frontend auf Vercel (Vite, Repo-Root, Env `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`). Details + einmalige Supabase-Setup-Schritte im `README.md`.
