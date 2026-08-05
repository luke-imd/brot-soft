# ARCHITECTURE — DB, RLS, RPCs, Frontend

## Prinzip

Kein eigener Backend-Server. Das React-SPA spricht via `supabase-js` **direkt** mit Postgres. Sicherheit = Row Level Security + `security definer`-RPCs, nicht App-Code. Drei Edge Functions (Zahltag-Mail, Selbstregistrierung, User löschen) sind die Ausnahme, weil sie Service-Role-Rechte oder externen Mailversand brauchen.

## Datenmodell

Quelle: `supabase/migrations/20260723000001_schema.sql`, Stunden-Umstellung in `...0006_hourly_spots.sql`. Alle Beträge in **Cents (int)**.

| Tabelle | Spalten (wesentlich) | Zweck |
|---|---|---|
| `profiles` | `id` (PK, FK→`auth.users`), `name`, `is_admin`, `seeker` | 1:1 zu Auth-User; per Trigger `handle_new_user` bei Auth-Insert angelegt; `seeker` = informativer „sucht Platz"-Marker, bei der Registrierung optional gesetzt |
| `spots` | `id` (PK, int, 1–23), `owner_id` (FK→profiles, nullable), `active` (bool, default true) | 23 Plätze; 5/7/9/19 sind `active = false` (Fahrrad-/Traktor-Abstellplätze), `owner_id` dort dauerhaft `null` |
| `settings` | `id` (bool-PK, immer true), `day_rate_cents` (aktuell 300 = 3 €) | Single-Row-Konfiguration (Tagespauschale) |
| `invites` | `id` (bool-PK, immer true), `code` | Single-Row: geheimer Registrierungs-Code für den `?join=`-Link. Nur Admins lesen/rotieren (RLS) |
| `bookings` | `id` (uuid), `spot_id`, `borrower_id`, `created_at` | Eine Buchung; zugehörige Stunden referenzieren sie |
| `free_slots` | **PK `(spot_id, date, hour)`**, `hour` (int, `check between 0 and 23`), `booking_id` (FK→bookings, `on delete set null`) | Eine Zeile pro freigegebener Stunde; deckt `[hour, hour+1)` ab (Ende exklusiv); `booking_id null`=frei, gesetzt=gebucht |
| `ledger` | `id` (uuid), `booking_id` (unique, FK `on delete cascade`), `debtor_id`, `creditor_id`, `amount_cents`, `created_at`, `settled_at`, `settled_by` | Eine Schuldposition pro Buchung; Settled-Felder = Log |

FK-Verhalten trägt die Storno-Semantik: beim Löschen einer Buchung werden ihre Slots via `on delete set null` wieder frei und der Ledger-Eintrag via `on delete cascade` gelöscht.

## RLS-Policies

Quelle: `supabase/migrations/20260723000002_rls_rpc.sql`. RLS auf allen 7 Tabellen aktiv (`invites` inklusive), durch die Stunden-Migration unverändert.

- **`read_all`** (SELECT, alle Tabellen, `authenticated`): jeder eingeloggte User liest alles (Transparenz).
- **`owner_frees`** (INSERT auf `free_slots`): nur wenn `booking_id is null` **und** der Platz dem User gehört → Besitzer gibt eigene Plätze frei.
- **`owner_retracts`** (DELETE auf `free_slots`): gleiche Bedingung → Freigabe zurückziehen, nur ungebuchte Slots.
- **`admin_updates`** (UPDATE auf `spots`/`settings`/`profiles`): nur `is_admin()`. → trägt die Admin-Seite (Plätze zuweisen, Tagessatz, Admin-Rechte toggeln). `profiles.seeker` wird bei der Registrierung per Service-Role (Edge Function, umgeht RLS) gesetzt; danach nur noch über diese Admin-Policy änderbar.
- **`admin_reads`/`admin_updates`** auf `invites`: nur `is_admin()` — Einladungs-Code lesen/rotieren.
- **Kein** direktes INSERT/UPDATE/DELETE auf `bookings`/`ledger` für User — der einzige Weg führt über die RPCs. Dadurch können Beträge nicht clientseitig gefälscht werden. `spots.owner_id` kann außerdem per `claim_spot`-RPC (statt RLS) vom User selbst gesetzt werden, solange der Platz besitzerlos und aktiv ist.

Helper: `is_admin()` — `security definer`, liest `profiles.is_admin` für `auth.uid()`.

## RPCs (`security definer`, alle `set search_path = public`)

- **`book_spot(p_spot_id int, p_slots jsonb) → uuid`** — `p_slots` = `[{"date":"YYYY-MM-DD","hour":0-23}]`. Prüft Auth/Besitzer/Eigenplatz, legt Buchung an, setzt `booking_id` auf die passenden freien, zukünftigen Stunden-Slots, prüft dass die Trefferzahl der erwarteten entspricht (sonst Exception → Rollback), berechnet den Betrag als **Tagespauschale**: `count(distinct date) * day_rate_cents` (keine Division — die Stundenzahl pro Tag ist irrelevant), legt Ledger-Eintrag an. Atomar + race-sicher.
- **`cancel_booking(p_booking_id uuid) → void`** — nur eigene Buchung, nur vor Beginn (`min(date) > current_date`, weiterhin tagesbasiert), **nicht** wenn bereits beglichen (Migration `...0004`). Löscht die Buchung; FKs geben Slots frei und löschen die Schuld.
- **`settle_ledger(p_ledger_id uuid) → void`** — setzt `settled_at`/`settled_by`, nur durch Schuldner **oder** Gläubiger, nur wenn noch offen.
- **`claim_spot(p_spot_id int) → void`** — neu (Migration `...0006`). Beansprucht einen besitzerlosen aktiven Platz für sich selbst via bedingtem `UPDATE ... WHERE owner_id is null and active`; race-sicher (0 Treffer → Exception „Platz ist schon vergeben oder nicht verfügbar"). Execute nur an `authenticated`.

**Grants**: Execute ist von `public`/`anon` entzogen und explizit an `authenticated` erteilt (Migration `...0003` für `book_spot`/`cancel_booking`/`settle_ledger`, direkt in `...0006` für `claim_spot` — behebt die Postgres-Falle, dass EXECUTE per Default an PUBLIC geht).

## Migrationen (nur additiv, nie editieren)

| Datei | Inhalt |
|---|---|
| `...0001_schema.sql` | Tabellen, Seed (24 spots, settings-Zeile), `handle_new_user`-Trigger |
| `...0002_rls_rpc.sql` | RLS-Policies, `is_admin()`, die drei RPCs |
| `...0003_fix_rpc_grants.sql` | Execute-Grants: `public`/`anon` revoke, `authenticated` grant |
| `...0004_cancel_settled_guard.sql` | `cancel_booking` neu: verbietet Storno beglichener Schulden |
| `...0005_invites.sql` | `invites`-Tabelle (Registrierungs-Code) + admin-only RLS |
| `...0006_hourly_spots.sql` | `free_slots`: `half`→`hour` (0–23, Bestandsdaten je Halbtag auf 12 Stunden-Zeilen aufgefächert), neuer PK `(spot_id,date,hour)`; `spots`: `active`-Flag (5/7/9/19 auf inaktiv, `owner_id` genullt), Platz 24 gelöscht, `grid_row`/`grid_col` entfernt; `profiles.seeker` (default false); `settings.day_rate_cents` → 300; `book_spot` neu auf Stunden-Slots + Tagespauschale umgestellt; neuer RPC `claim_spot` |

Anwenden per Supabase-MCP `apply_migration` (Name = Dateiname ohne `.sql`). DB-Typen nach Schema-Änderungen neu generieren (`generate_typescript_types` → `src/lib/database.types.ts`).

## Edge Functions

Alle drei: CORS auf allen Pfaden, top-level `try/catch`, Deno.

- **`zahltag`** (`verify_jwt: true`) — vom Admin-Button aufgerufen. Prüft Admin (sonst 403) **vor** Service-Role-Arbeit; listet Auth-User, verschickt via **Resend** eine Mail an alle (`bcc`), Antwort `{ sent: number }`. Braucht Secret `RESEND_API_KEY`.
- **`join`** (`verify_jwt: false`, deployed v3) — öffentliche Selbstregistrierung, aufgerufen von der Join-Seite. Zwei Modi: `{code, list:true}` liefert die IDs der besitzerlosen aktiven Plätze (fürs Platz-Dropdown; `anon` darf sonst nichts lesen). Der Registrierungs-Aufruf validiert Eingaben (E-Mail, Passwort ≥6, Name), prüft den geheimen `invites.code` (Service-Role-Read), deckelt bei `MAX_USERS = 50` (Count auf `profiles`), legt den User mit `email_confirm: true` an (keine Bestätigungs-Mail; Profil kommt per `handle_new_user`-Trigger), setzt optional `profiles.seeker` und ordnet einen gewünschten `spot_id` per bedingtem `UPDATE` zu — race-sicher: 0 Treffer heißt der Platz war inzwischen weg, der Account wird trotzdem angelegt und die Antwort bekommt ein `warning`. Antwort `{ ok, error?, warning?, spots? }` (200 auch bei Logikfehlern, 500 nur bei Exceptions).
- **`delete-user`** (`verify_jwt: true`) — Admin löscht einen User. Prüft Admin, verhindert Selbstlöschung, löst zuerst `spots.owner_id`, dann `admin.deleteUser`. Schlägt (mit klarer Meldung) fehl, wenn der User Buchungen/Ledger-Historie hat (FK RESTRICT).

## Frontend

- **`App.tsx`** — Auth-Gate (`getSession` + `onAuthStateChange`), Join-Routing (bei `?join=CODE` und ohne Session → `Join`-Seite), `is_admin`+`name`-Abfrage (Admin-Tab, User-Chip mit Initialen im Header), Tab-Shell (**Kalender** (Startseite/Default-Tab) **/ Garage / Meine Buchungen / Anleitung / Admin**) mit Sticky-Header (Ink-„P"-Logo, Pill-Tabs), Passwort-Dialog als Modal („Passwort ändern"; öffnet automatisch bei Invite-/Recovery-Link via URL-Hash, dann als „Neues Passwort setzen").
- **`Login.tsx`** — E-Mail + Passwort (`signInWithPassword`), „Passwort vergessen" (`resetPasswordForEmail`).
- **`pages/Calendar.tsx`** — Startseite. Monatsansicht (Wochenstart Montag); Tage mit freien Plätzen zeigen ein „n frei"-Badge. Tag anklicken öffnet die Liste der an diesem Tag freien Plätze (fremde Plätze, eigener Platz ausgeblendet); pro Platz werden die freien Stunden per `hourSpans`/`fmtSpan` zu Bereichen gemergt angezeigt, `RangeForm` bucht via RPC. Card „Mein Platz": eigene Plätze per `RangeForm` freigeben/zurückziehen (direkt auf `free_slots`); wer noch keinen Platz hat, kann einen besitzerlosen aktiven Platz per `claim_spot`-RPC („Das ist mein Platz") beanspruchen.
- **`pages/Garage.tsx`** — rein statische Orientierungsseite, keine Aktionen: CSS-Grundriss nach dem echten Plan von Objekt 2 (statische `SPOT_POS`-Konstante, so orientiert dass die Einfahrten unten liegen; Kacheln mit Platznummer + Besitzer-Initialen, „ICH" für den eigenen Platz, 🚲/🚜 für inaktive) plus Liste „wem gehört welcher Platz". Buchen/Freigeben passiert im Kalender.
- **`pages/MyBookings.tsx`** (ex `Ledger.tsx`) — zwei Abschnitte: eigene künftige Buchungen (PostgREST-Embed `bookings→free_slots`, Preis via `priceCents`, Storno-Button bis zum Vortag) und offene Ledger-Posten „X schuldet Y n €" mit Beglichen-Button (nur Beteiligte) plus aufklappbarer Beglichen-Historie. Der Admin-Bereich (Tagessatz, Zahltag) ist auf `pages/Admin.tsx` ausgelagert.
- **`pages/Help.tsx`** — statische Bedienungsanleitung (Tab „Anleitung"): buchen (stundengenau, Tagespauschale)/freigeben/Platz eintragen/stornieren/begleichen, Garagenplan, Passwort. Kein Datenzugriff, keine Props.
- **`pages/Admin.tsx`** — nur für Admins sichtbar (Tab „Admin"). Vier Sektionen: Plätze zuweisen (`spots.owner_id` via UPDATE, nur aktive Plätze), Einladungs-Link (anzeigen/kopieren/rotieren via `invites`), User verwalten (Admin-Toggle via `profiles`, „sucht Platz"-Badge für `seeker`, Löschen via `delete-user`-Function), Tagessatz & Zahltag.
- **`pages/Join.tsx`** — Selbstregistrierung: Name/E-Mail/Passwort + Checkboxen „Ich suche einen Parkplatz" (`seeker`) und „Ich habe einen Parkplatz" (Auswahl aus den per `{code, list:true}` geladenen besitzerlosen aktiven Plätzen) → `join`-Function; zeigt bei `data.warning` einen Alert (Wunsch-Platz war inzwischen weg), danach direkter `signInWithPassword` und Redirect auf `origin` (entfernt `?join`).
- **`components/RangeForm.tsx`** — Datum+Stunde-von-bis-Formular (volle Stunden, Ende exklusiv), zeigt bei übergebenem `rateCents` den Preis (Tagespauschale) direkt im Submit-Button an. Verwendet von `Calendar.tsx` (Buchen/Freigeben/Zurückziehen).
- **`lib/slots.ts`** — reine Logik, TDD-getestet: `hourRange`, `priceCents`, `hourSpans`, `fmtSpan`, `fmtEur`, `localDate`, Typ `Slot` (`{date, hour}`). `Slot` ist ein Type-Alias (nicht Interface), damit es an den generierten `Json`-RPC-Parametertyp zuweisbar ist.

## Deploy

Frontend auf Vercel (Vite, Repo-Root, Env `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`). Details + einmalige Supabase-Setup-Schritte im `README.md`.
