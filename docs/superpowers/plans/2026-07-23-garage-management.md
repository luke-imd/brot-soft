# Garagenplatz-Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** WG-Tool für 24 Garagenplätze: Besitzer geben Plätze halbtags frei, andere buchen sie, ein Ledger trackt Schulden (Tagessatz 5 €, Halbtag 2,50 €).

**Architecture:** Vite-SPA (React/TS/Tailwind) spricht via `supabase-js` direkt mit Supabase-Postgres. Zugriffskontrolle über RLS; Buchung/Storno/Begleichen laufen als `security definer`-Postgres-Funktionen (atomar). Eine Edge Function verschickt die Zahltag-Mail via Resend.

**Tech Stack:** Supabase (Postgres, Auth Magic-Link/Invite, Edge Functions), React 19 + TypeScript, Tailwind v4 (`@tailwindcss/vite`), Vite, Vitest, Vercel.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-23-garage-management-design.md` — bei Widerspruch gewinnt die Spec.
- Beträge immer in **Cents** (int), Anzeige via `fmtEur`. Tagessatz initial **500** Cents.
- Halbtage: `'am'` (00–12 Uhr) / `'pm'` (12–24 Uhr). Datum immer `YYYY-MM-DD` (lokal, nie `toISOString()` für Datumsanzeige).
- DB-Änderungen ausschließlich als Migration-Files unter `supabase/migrations/` und via MCP-Tool `mcp__supabase__apply_migration` (Name = Dateiname ohne `.sql`) auf das Remote-Projekt angewendet. Kein lokaler Supabase-Stack.
- SQL-Checks laufen via MCP-Tool `mcp__supabase__execute_sql`.
- UI-Sprache: Deutsch. Code/Identifier: Englisch.
- App liegt im Repo-Root (package.json im Root), Supabase-Artefakte unter `supabase/`.

---

### Task 1: DB-Schema (Migration 1)

**Files:**
- Create: `supabase/migrations/20260723000001_schema.sql`

**Interfaces:**
- Produces: Tabellen `profiles`, `spots` (24 Zeilen, `grid_row` 1–2, `grid_col` 1–12), `settings` (1 Zeile, `day_rate_cents=500`), `bookings`, `free_slots` (PK `(spot_id, date, half)`), `ledger`; Trigger legt bei Auth-Invite automatisch ein Profil an.

- [ ] **Step 1: Migration-File schreiben**

```sql
-- supabase/migrations/20260723000001_schema.sql
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  is_admin boolean not null default false
);

create table public.spots (
  id int primary key,
  owner_id uuid references public.profiles(id),
  grid_row int not null,
  grid_col int not null
);

create table public.settings (
  id boolean primary key default true check (id), -- ponytail: single-row table via bool-PK
  day_rate_cents int not null default 500
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  spot_id int not null references public.spots(id),
  borrower_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

-- Eine Zeile pro freigegebenem Halbtag. booking_id null = frei, gesetzt = gebucht.
-- Der PK macht Doppelbuchung/Doppel-Freigabe auf DB-Ebene unmöglich.
create table public.free_slots (
  spot_id int not null references public.spots(id),
  date date not null,
  half text not null check (half in ('am','pm')),
  booking_id uuid references public.bookings(id) on delete set null,
  primary key (spot_id, date, half)
);

create table public.ledger (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid unique references public.bookings(id) on delete cascade,
  debtor_id uuid not null references public.profiles(id),
  creditor_id uuid not null references public.profiles(id),
  amount_cents int not null,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  settled_by uuid references public.profiles(id)
);

insert into public.settings (day_rate_cents) values (500);

insert into public.spots (id, grid_row, grid_col)
select n, (n - 1) / 12 + 1, (n - 1) % 12 + 1
from generate_series(1, 24) as n;

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

- [ ] **Step 2: Migration anwenden**

MCP: `mcp__supabase__apply_migration` mit `name: "20260723000001_schema"` und obigem SQL als `query`.
Expected: success ohne Fehler.

- [ ] **Step 3: Verifizieren**

MCP: `mcp__supabase__execute_sql` mit:

```sql
select
  (select count(*) from public.spots) as spots,
  (select day_rate_cents from public.settings) as rate,
  (select count(*) from public.spots where grid_row = 2 and grid_col = 12) as last_spot;
```

Expected: `spots=24, rate=500, last_spot=1`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260723000001_schema.sql
git commit -m "feat: db schema for spots, free_slots, bookings, ledger"
```

---

### Task 2: RLS + RPCs (Migration 2) + DB-Smoke-Test

**Files:**
- Create: `supabase/migrations/20260723000002_rls_rpc.sql`
- Create: `scripts/db-smoke.sql`

**Interfaces:**
- Consumes: Schema aus Task 1.
- Produces: RPCs `book_spot(p_spot_id int, p_slots jsonb) returns uuid` (Slots = `[{"date":"YYYY-MM-DD","half":"am"|"pm"}]`), `cancel_booking(p_booking_id uuid)`, `settle_ledger(p_ledger_id uuid)`; Helper `is_admin() returns boolean`. Frontend ruft sie via `supabase.rpc('book_spot', {p_spot_id, p_slots})` etc. auf. Lesen: alle authenticated User dürfen alle Tabellen lesen. Schreiben direkt nur: Besitzer auf eigene `free_slots` (insert/delete, ungebucht), Admin auf `spots`/`settings`/`profiles`.

- [ ] **Step 1: Migration-File schreiben**

```sql
-- supabase/migrations/20260723000002_rls_rpc.sql
alter table public.profiles enable row level security;
alter table public.spots enable row level security;
alter table public.settings enable row level security;
alter table public.bookings enable row level security;
alter table public.free_slots enable row level security;
alter table public.ledger enable row level security;

-- Transparenz ist gewollt: alle eingeloggten User lesen alles.
create policy "read_all" on public.profiles for select to authenticated using (true);
create policy "read_all" on public.spots for select to authenticated using (true);
create policy "read_all" on public.settings for select to authenticated using (true);
create policy "read_all" on public.bookings for select to authenticated using (true);
create policy "read_all" on public.free_slots for select to authenticated using (true);
create policy "read_all" on public.ledger for select to authenticated using (true);

create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce((select is_admin from public.profiles where id = auth.uid()), false) $$;

-- Besitzer geben eigene Plätze frei / ziehen ungebuchte Freigaben zurück
create policy "owner_frees" on public.free_slots for insert to authenticated
  with check (
    booking_id is null
    and exists (select 1 from public.spots s where s.id = spot_id and s.owner_id = auth.uid())
  );
create policy "owner_retracts" on public.free_slots for delete to authenticated
  using (
    booking_id is null
    and exists (select 1 from public.spots s where s.id = spot_id and s.owner_id = auth.uid())
  );

-- Admin verwaltet Zuordnung, Tagessatz, Profile
create policy "admin_updates" on public.spots for update to authenticated
  using (public.is_admin());
create policy "admin_updates" on public.settings for update to authenticated
  using (public.is_admin());
create policy "admin_updates" on public.profiles for update to authenticated
  using (public.is_admin());

-- Buchen: atomar (Buchung + Slots + Ledger), Race-sicher durch Row-Locks beim UPDATE.
create function public.book_spot(p_spot_id int, p_slots jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_booking_id uuid;
  v_expected int;
  v_count int;
  v_owner uuid;
  v_rate int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select owner_id into v_owner from spots where id = p_spot_id;
  if v_owner is null then raise exception 'Platz hat keinen Besitzer'; end if;
  if v_owner = auth.uid() then raise exception 'Eigenen Platz kann man nicht buchen'; end if;
  v_expected := jsonb_array_length(p_slots);
  if v_expected is null or v_expected = 0 then raise exception 'Keine Slots angegeben'; end if;

  insert into bookings (spot_id, borrower_id) values (p_spot_id, auth.uid())
  returning id into v_booking_id;

  update free_slots f set booking_id = v_booking_id
  from jsonb_to_recordset(p_slots) as s(date date, half text)
  where f.spot_id = p_spot_id and f.date = s.date and f.half = s.half
    and f.booking_id is null and f.date >= current_date;
  get diagnostics v_count = row_count;
  if v_count <> v_expected then
    raise exception 'Nicht alle Slots sind (mehr) frei';
  end if;

  select day_rate_cents into v_rate from settings;
  insert into ledger (booking_id, debtor_id, creditor_id, amount_cents)
  values (v_booking_id, auth.uid(), v_owner, round(v_count * v_rate / 2.0));
  return v_booking_id;
end $$;

-- ponytail: Storno nur bis zum Vortag des Buchungsbeginns; feinere Regel bei Bedarf.
create function public.cancel_booking(p_booking_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_start date;
begin
  select min(date) into v_start from free_slots where booking_id = p_booking_id;
  if v_start is null or v_start <= current_date then
    raise exception 'Buchung hat schon begonnen';
  end if;
  delete from bookings where id = p_booking_id and borrower_id = auth.uid();
  if not found then raise exception 'Nicht deine Buchung'; end if;
  -- free_slots.booking_id wird via FK "on delete set null" wieder frei,
  -- der Ledger-Eintrag via "on delete cascade" gelöscht.
end $$;

-- Begleichen: Schuldner oder Gläubiger, einseitig, geloggt via settled_by/settled_at.
create function public.settle_ledger(p_ledger_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update ledger set settled_at = now(), settled_by = auth.uid()
  where id = p_ledger_id and settled_at is null
    and auth.uid() in (debtor_id, creditor_id);
  if not found then raise exception 'Nicht erlaubt oder schon beglichen'; end if;
end $$;

revoke execute on function public.book_spot(int, jsonb) from anon;
revoke execute on function public.cancel_booking(uuid) from anon;
revoke execute on function public.settle_ledger(uuid) from anon;
```

- [ ] **Step 2: Migration anwenden**

MCP: `mcp__supabase__apply_migration`, `name: "20260723000002_rls_rpc"`.
Expected: success.

- [ ] **Step 3: Smoke-Test schreiben**

```sql
-- scripts/db-smoke.sql — läuft in einer Transaktion, rollt immer zurück.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'owner@test.local'),
  ('00000000-0000-0000-0000-000000000002', 'borrower@test.local');

update public.spots set owner_id = '00000000-0000-0000-0000-000000000001' where id = 1;
insert into public.free_slots (spot_id, date, half) values
  (1, current_date + 1, 'am'),
  (1, current_date + 1, 'pm');

-- als Borrower agieren (auth.uid() liest request.jwt.claims)
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

do $$
declare
  v_booking uuid;
  v_amount int;
  v_raised boolean := false;
begin
  -- ganzer Tag buchen -> 500 Cents Schuld
  v_booking := public.book_spot(1, jsonb_build_array(
    jsonb_build_object('date', current_date + 1, 'half', 'am'),
    jsonb_build_object('date', current_date + 1, 'half', 'pm')));
  select amount_cents into v_amount from public.ledger where booking_id = v_booking;
  assert v_amount = 500, format('expected 500 cents, got %s', v_amount);

  -- Doppelbuchung muss scheitern
  begin
    perform public.book_spot(1, jsonb_build_array(
      jsonb_build_object('date', current_date + 1, 'half', 'am')));
  exception when others then v_raised := true;
  end;
  assert v_raised, 'double booking did not raise';

  -- Storno gibt Slots frei und löscht die Schuld
  perform public.cancel_booking(v_booking);
  assert (select count(*) from public.free_slots
          where spot_id = 1 and booking_id is not null) = 0, 'slots not freed';
  assert (select count(*) from public.ledger where booking_id = v_booking) = 0,
    'ledger entry not deleted';
end $$;

rollback;
```

- [ ] **Step 4: Smoke-Test ausführen**

MCP: `mcp__supabase__execute_sql` mit dem kompletten Inhalt von `scripts/db-smoke.sql`.
Expected: läuft ohne Fehler durch (Asserts werfen bei Fehlschlag).

- [ ] **Step 5: Security-Advisors prüfen**

MCP: `mcp__supabase__get_advisors` mit `type: "security"`.
Expected: keine Errors zu RLS auf den neuen Tabellen (Warnings zu Auth-Settings sind ok, notieren).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260723000002_rls_rpc.sql scripts/db-smoke.sql
git commit -m "feat: rls policies, booking/cancel/settle rpcs, db smoke test"
```

---

### Task 3: Frontend-Scaffold + Auth

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `.gitignore`, `.env.local`
- Create: `src/main.tsx`, `src/index.css`, `src/App.tsx`, `src/Login.tsx`, `src/lib/supabase.ts`, `src/lib/database.types.ts`

**Interfaces:**
- Consumes: DB aus Task 1/2.
- Produces: `supabase`-Client (`src/lib/supabase.ts`, typisiert mit `Database`), Auth-Gate in `App.tsx` mit Tab-Navigation, die Platzhalter-Komponenten `Garage`, `Calendar`, `Ledger` aus `src/pages/*` rendert (Tasks 5–7 ersetzen die Platzhalter). Tasks 5–7 erhalten die Prop `userId: string`.

- [ ] **Step 1: npm-Projekt anlegen**

```bash
npm init -y
npm i react react-dom @supabase/supabase-js
npm i -D vite @vitejs/plugin-react typescript @types/react @types/react-dom tailwindcss @tailwindcss/vite vitest
```

Dann in `package.json` setzen (Rest von `npm init` belassen):

```json
{
  "name": "brot-soft",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  }
}
```

- [ ] **Step 2: Config-Files schreiben**

```ts
// vite.config.ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: { environment: 'node' },
})
```

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["vite/client"]
  },
  "include": ["src", "vite.config.ts"]
}
```

```html
<!-- index.html -->
<!doctype html>
<html lang="de">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Garage</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

```
# .gitignore
node_modules/
dist/
.env.local
.idea/
```

`.env.local`: URL via MCP `mcp__supabase__get_project_url`, Key via `mcp__supabase__get_publishable_keys` (den `publishable`/anon Key nehmen):

```
VITE_SUPABASE_URL=<aus get_project_url>
VITE_SUPABASE_ANON_KEY=<aus get_publishable_keys>
```

- [ ] **Step 3: DB-Typen generieren**

MCP: `mcp__supabase__generate_typescript_types`, Ergebnis nach `src/lib/database.types.ts` schreiben.

- [ ] **Step 4: Client, Auth-Gate, Tabs schreiben**

```ts
// src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

export const supabase = createClient<Database>(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
)
```

```css
/* src/index.css */
@import "tailwindcss";
```

```tsx
// src/main.tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

```tsx
// src/Login.tsx
import { useState } from 'react'
import { supabase } from './lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    // shouldCreateUser: false -> nur eingeladene User kommen rein
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    })
    if (error) setError(error.message)
    else setSent(true)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <form onSubmit={submit} className="bg-white rounded-xl shadow p-8 w-80 space-y-4">
        <h1 className="text-xl font-bold">Garage Login</h1>
        {sent ? (
          <p className="text-green-700">Login-Link wurde an {email} geschickt.</p>
        ) : (
          <>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="E-Mail"
              className="w-full border rounded p-2"
            />
            <button className="w-full bg-blue-600 text-white rounded p-2">
              Login-Link schicken
            </button>
            {error && <p className="text-red-600 text-sm">{error}</p>}
          </>
        )}
      </form>
    </div>
  )
}
```

```tsx
// src/App.tsx
import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import Login from './Login'
import Garage from './pages/Garage'
import Calendar from './pages/Calendar'
import Ledger from './pages/Ledger'

const TABS = { garage: 'Garage', kalender: 'Kalender', ledger: 'Ledger' } as const
type Tab = keyof typeof TABS

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [tab, setTab] = useState<Tab>('garage')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (!ready) return null
  if (!session) return <Login />
  const userId = session.user.id

  return (
    <div className="min-h-screen bg-gray-100">
      <nav className="bg-white shadow flex items-center gap-1 px-4 py-2">
        {(Object.keys(TABS) as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded ${tab === t ? 'bg-blue-600 text-white' : 'hover:bg-gray-100'}`}
          >
            {TABS[t]}
          </button>
        ))}
        <button
          onClick={() => supabase.auth.signOut()}
          className="ml-auto text-sm text-gray-500 hover:text-gray-800"
        >
          Logout
        </button>
      </nav>
      <main className="max-w-5xl mx-auto p-4">
        {tab === 'garage' && <Garage userId={userId} />}
        {tab === 'kalender' && <Calendar userId={userId} />}
        {tab === 'ledger' && <Ledger userId={userId} />}
      </main>
    </div>
  )
}
```

Platzhalter-Seiten (werden in Tasks 5–7 ersetzt), je Datei gleiches Muster:

```tsx
// src/pages/Garage.tsx  (analog Calendar.tsx mit "Kalender", Ledger.tsx mit "Ledger")
export default function Garage(_props: { userId: string }) {
  return <p>Garage kommt noch.</p>
}
```

- [ ] **Step 5: Build & Dev-Smoke**

```bash
npm run build
```

Expected: Build ohne TS-Fehler. Danach kurz `npm run dev` starten, im Browser prüfen: Login-Form erscheint. (Magic-Link-Ende-zu-Ende geht erst mit eingeladenem User — reicht, dass das Formular rendert und kein Console-Error kommt.)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: vite react app with supabase auth gate and tab shell"
```

---

### Task 4: Slot-/Preis-Library (TDD)

**Files:**
- Create: `src/lib/slots.ts`
- Test: `src/lib/slots.test.ts`

**Interfaces:**
- Produces (von Tasks 5–7 verwendet):
  - `type Half = 'am' | 'pm'`
  - `type Slot = { date: string; half: Half }` (bewusst Type-Alias, kein Interface — siehe Kommentar im Code)
  - `slotRange(startDate: string, startHalf: Half, endDate: string, endHalf: Half): Slot[]` — inklusive Grenzen; ungültiger Bereich → `[]`
  - `priceCents(slotCount: number, dayRateCents: number): number`
  - `fmtEur(cents: number): string`
  - `localDate(d?: Date): string` — lokales `YYYY-MM-DD`

- [ ] **Step 1: Failing Tests schreiben**

```ts
// src/lib/slots.test.ts
import { describe, expect, it } from 'vitest'
import { fmtEur, localDate, priceCents, slotRange } from './slots'

describe('slotRange', () => {
  it('expands a full single day into am+pm', () => {
    expect(slotRange('2026-08-01', 'am', '2026-08-01', 'pm')).toEqual([
      { date: '2026-08-01', half: 'am' },
      { date: '2026-08-01', half: 'pm' },
    ])
  })

  it('handles pm start and am end across days', () => {
    expect(slotRange('2026-08-01', 'pm', '2026-08-02', 'am')).toEqual([
      { date: '2026-08-01', half: 'pm' },
      { date: '2026-08-02', half: 'am' },
    ])
  })

  it('crosses month boundaries', () => {
    expect(slotRange('2026-08-31', 'pm', '2026-09-01', 'pm')).toEqual([
      { date: '2026-08-31', half: 'pm' },
      { date: '2026-09-01', half: 'am' },
      { date: '2026-09-01', half: 'pm' },
    ])
  })

  it('returns [] for reversed ranges', () => {
    expect(slotRange('2026-08-02', 'am', '2026-08-01', 'am')).toEqual([])
    expect(slotRange('2026-08-01', 'pm', '2026-08-01', 'am')).toEqual([])
  })
})

describe('priceCents', () => {
  it('charges half the day rate per slot', () => {
    expect(priceCents(2, 500)).toBe(500)
    expect(priceCents(3, 500)).toBe(750)
  })
  it('rounds odd rates', () => {
    expect(priceCents(1, 501)).toBe(251)
  })
})

it('fmtEur formats cents as euro', () => {
  expect(fmtEur(750)).toMatch(/7,50/)
})

it('localDate formats local YYYY-MM-DD', () => {
  expect(localDate(new Date(2026, 7, 1))).toBe('2026-08-01')
})
```

- [ ] **Step 2: Tests laufen lassen — müssen fehlschlagen**

```bash
npm test
```

Expected: FAIL — `Cannot find module './slots'` (o.ä.).

- [ ] **Step 3: Implementieren**

```ts
// src/lib/slots.ts
export type Half = 'am' | 'pm'
// Type-Alias, kein Interface: Aliase haben eine implizite Index-Signatur und sind
// dadurch direkt an den generierten `Json`-RPC-Parametertyp zuweisbar.
export type Slot = { date: string; half: Half }

export function localDate(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export function slotRange(
  startDate: string, startHalf: Half, endDate: string, endHalf: Half,
): Slot[] {
  const out: Slot[] = []
  // UTC-Mitternacht als reine Datums-Arithmetik, Ausgabe bleibt der String
  const d = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)
  while (d <= end) {
    const date = d.toISOString().slice(0, 10)
    for (const half of ['am', 'pm'] as const) {
      if (date === startDate && half === 'am' && startHalf === 'pm') continue
      if (date === endDate && half === 'pm' && endHalf === 'am') continue
      out.push({ date, half })
    }
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

export function priceCents(slotCount: number, dayRateCents: number): number {
  return Math.round((slotCount * dayRateCents) / 2)
}

export function fmtEur(cents: number): string {
  return (cents / 100).toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })
}
```

- [ ] **Step 4: Tests laufen lassen — müssen bestehen**

```bash
npm test
```

Expected: alle Tests PASS. (Falls „reversed range gleicher Tag pm→am" fehlschlägt: der `endHalf`-Skip entfernt beide Halbtage → `[]`; das ist das erwartete Verhalten.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/slots.ts src/lib/slots.test.ts
git commit -m "feat: slot range and price helpers with tests"
```

---

### Task 5: Garage-View (Vogelperspektive)

**Files:**
- Create: `src/components/RangeForm.tsx`
- Modify: `src/pages/Garage.tsx` (Platzhalter ersetzen)

**Interfaces:**
- Consumes: `supabase` (Task 3), `slotRange`/`priceCents`/`fmtEur`/`localDate`/`Half`/`Slot` (Task 4), RPCs `book_spot`/`cancel_booking` (Task 2).
- Produces: `RangeForm`-Komponente mit Props `{ label: string; initialDate?: string; onSubmit: (slots: Slot[]) => Promise<void> }` — wird in Task 6 wiederverwendet. `Garage`-Page mit Prop `{ userId: string }`.

- [ ] **Step 1: RangeForm schreiben**

```tsx
// src/components/RangeForm.tsx
import { useState } from 'react'
import { localDate, slotRange, type Half, type Slot } from '../lib/slots'

const HALVES: [Half, string][] = [['am', 'Vormittag'], ['pm', 'Nachmittag']]

export default function RangeForm({ label, initialDate, onSubmit }: {
  label: string
  initialDate?: string
  onSubmit: (slots: Slot[]) => Promise<void>
}) {
  const init = initialDate ?? localDate()
  const [start, setStart] = useState(init)
  const [startHalf, setStartHalf] = useState<Half>('am')
  const [end, setEnd] = useState(init)
  const [endHalf, setEndHalf] = useState<Half>('pm')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const slots = slotRange(start, startHalf, end, endHalf)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await onSubmit(slots)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input type="date" value={start} onChange={e => setStart(e.target.value)}
          className="border rounded p-1" />
        <select value={startHalf} onChange={e => setStartHalf(e.target.value as Half)}
          className="border rounded p-1">
          {HALVES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <span>bis</span>
        <input type="date" value={end} onChange={e => setEnd(e.target.value)}
          className="border rounded p-1" />
        <select value={endHalf} onChange={e => setEndHalf(e.target.value as Half)}
          className="border rounded p-1">
          {HALVES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <button disabled={busy || slots.length === 0}
        className="bg-blue-600 text-white rounded px-3 py-1.5 disabled:opacity-50">
        {label} ({slots.length} Halbtage)
      </button>
      {error && <p className="text-red-600 text-sm">{error}</p>}
    </form>
  )
}
```

- [ ] **Step 2: Garage-Page schreiben**

Farb-Logik pro Platz für gewählten Tag+Halbtag: kein `free_slots`-Eintrag → grau (Besitzer nutzt ihn), Eintrag mit `booking_id null` → grün (frei), gebucht von mir → blau, gebucht von wem anderen → orange. Layout: CSS-Grid, 2 Reihen à 12 aus `grid_row`/`grid_col` (`// ponytail: layout aus spots-tabelle, echter grundriss kommt später`). Mittelgang zwischen den Reihen als `gap`.

```tsx
// src/pages/Garage.tsx
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtEur, localDate, priceCents, type Half, type Slot } from '../lib/slots'
import RangeForm from '../components/RangeForm'

type SpotRow = { id: number; owner_id: string | null; grid_row: number; grid_col: number }
type FreeRow = { spot_id: number; date: string; half: Half; booking_id: string | null }
type BookingRow = { id: string; spot_id: number; borrower_id: string }

const HALF_LABEL: Record<Half, string> = { am: 'Vormittag', pm: 'Nachmittag' }

export default function Garage({ userId }: { userId: string }) {
  const [date, setDate] = useState(localDate())
  const [half, setHalf] = useState<Half>(new Date().getHours() < 12 ? 'am' : 'pm')
  const [spots, setSpots] = useState<SpotRow[]>([])
  const [free, setFree] = useState<FreeRow[]>([])
  const [bookings, setBookings] = useState<Map<string, BookingRow>>(new Map())
  const [names, setNames] = useState<Map<string, string>>(new Map())
  const [rate, setRate] = useState(500)
  const [selected, setSelected] = useState<number | null>(null)

  const load = useCallback(async () => {
    const [s, f, p, st] = await Promise.all([
      supabase.from('spots').select('*').order('id'),
      supabase.from('free_slots').select('*').eq('date', date).eq('half', half),
      supabase.from('profiles').select('id, name'),
      supabase.from('settings').select('day_rate_cents').single(),
    ])
    setSpots(s.data ?? [])
    setFree((f.data ?? []) as FreeRow[])
    setNames(new Map((p.data ?? []).map(x => [x.id, x.name])))
    setRate(st.data?.day_rate_cents ?? 500)
    const ids = (f.data ?? []).map(x => x.booking_id).filter((x): x is string => !!x)
    if (ids.length) {
      const b = await supabase.from('bookings').select('id, spot_id, borrower_id').in('id', ids)
      setBookings(new Map((b.data ?? []).map(x => [x.id, x])))
    } else {
      setBookings(new Map())
    }
  }, [date, half])

  useEffect(() => { load() }, [load])

  function status(spot: SpotRow) {
    const slot = free.find(f => f.spot_id === spot.id)
    if (!slot) return 'occupied'
    if (!slot.booking_id) return 'free'
    const b = bookings.get(slot.booking_id)
    return b?.borrower_id === userId ? 'mine' : 'booked'
  }

  const COLORS: Record<string, string> = {
    occupied: 'bg-gray-300 text-gray-600',
    free: 'bg-green-500 text-white',
    mine: 'bg-blue-600 text-white',
    booked: 'bg-orange-400 text-white',
  }

  async function book(spotId: number, slots: Slot[]) {
    const { error } = await supabase.rpc('book_spot', {
      p_spot_id: spotId,
      p_slots: slots,
    })
    if (error) throw new Error(error.message)
    setSelected(null)
    await load()
  }

  async function freeUp(spotId: number, slots: Slot[]) {
    const { error } = await supabase.from('free_slots').upsert(
      slots.map(s => ({ spot_id: spotId, date: s.date, half: s.half })),
      { onConflict: 'spot_id,date,half', ignoreDuplicates: true },
    )
    if (error) throw new Error(error.message)
    setSelected(null)
    await load()
  }

  async function retract(spotId: number, slots: Slot[]) {
    // halbtagsgenau löschen: je eine Query pro Halbtags-Sorte
    for (const h of ['am', 'pm'] as const) {
      const dates = slots.filter(s => s.half === h).map(s => s.date)
      if (dates.length === 0) continue
      const { error } = await supabase.from('free_slots').delete()
        .eq('spot_id', spotId).eq('half', h).is('booking_id', null)
        .in('date', dates)
      if (error) throw new Error(error.message)
    }
    setSelected(null)
    await load()
  }

  const sel = spots.find(s => s.id === selected)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          className="border rounded p-1 bg-white" />
        <select value={half} onChange={e => setHalf(e.target.value as Half)}
          className="border rounded p-1 bg-white">
          <option value="am">Vormittag</option>
          <option value="pm">Nachmittag</option>
        </select>
        <div className="ml-auto flex gap-3 text-xs">
          <span><span className="inline-block w-3 h-3 bg-gray-300 rounded mr-1" />Besitzer</span>
          <span><span className="inline-block w-3 h-3 bg-green-500 rounded mr-1" />Frei</span>
          <span><span className="inline-block w-3 h-3 bg-blue-600 rounded mr-1" />Meine Buchung</span>
          <span><span className="inline-block w-3 h-3 bg-orange-400 rounded mr-1" />Gebucht</span>
        </div>
      </div>

      {/* ponytail: layout aus spots-tabelle (2x12), echter grundriss kommt später */}
      <div className="bg-gray-700 rounded-xl p-4 grid grid-cols-12 gap-x-1 gap-y-10">
        {spots.map(spot => (
          <button key={spot.id} onClick={() => setSelected(spot.id)}
            style={{ gridRow: spot.grid_row, gridColumn: spot.grid_col }}
            className={`aspect-[2/3] rounded border-2 text-sm font-bold
              ${COLORS[status(spot)]}
              ${selected === spot.id ? 'border-yellow-300' : 'border-gray-500'}`}>
            {spot.id}
          </button>
        ))}
      </div>

      {sel && (
        <div className="bg-white rounded-xl shadow p-4 space-y-3">
          <div className="flex items-baseline gap-2">
            <h2 className="text-lg font-bold">Platz {sel.id}</h2>
            <span className="text-gray-500 text-sm">
              {sel.owner_id ? `Besitzer: ${names.get(sel.owner_id) ?? '?'}` : 'kein Besitzer'}
              {' · '}{date} {HALF_LABEL[half]}
            </span>
            <button onClick={() => setSelected(null)} className="ml-auto text-gray-400">✕</button>
          </div>

          {sel.owner_id === userId ? (
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <h3 className="font-semibold mb-1">Freigeben</h3>
                <RangeForm label="Freigeben" initialDate={date}
                  onSubmit={slots => freeUp(sel.id, slots)} />
              </div>
              <div>
                <h3 className="font-semibold mb-1">Freigabe zurückziehen</h3>
                <RangeForm label="Zurückziehen" initialDate={date}
                  onSubmit={slots => retract(sel.id, slots)} />
              </div>
            </div>
          ) : (
            <div>
              <h3 className="font-semibold mb-1">
                Buchen ({fmtEur(priceCents(1, rate))} pro Halbtag)
              </h3>
              <RangeForm label="Buchen" initialDate={date}
                onSubmit={slots => book(sel.id, slots)} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Build + manueller Smoke**

```bash
npm run build && npm test
```

Expected: beide PASS. Dann `npm run dev`: 24 Plätze in 2 Reihen sichtbar, Klick öffnet Panel. (Buchen End-zu-End braucht eingeladene User → Task 9-Setup; hier reicht: keine Console-Errors, RPC-Fehlermeldung erscheint sauber im Formular.)

- [ ] **Step 4: Commit**

```bash
git add src/components/RangeForm.tsx src/pages/Garage.tsx
git commit -m "feat: garage bird's-eye view with booking and availability forms"
```

---

### Task 6: Kalender-View

**Files:**
- Modify: `src/pages/Calendar.tsx` (Platzhalter ersetzen)

**Interfaces:**
- Consumes: `supabase`, `slots`-Lib, `RangeForm` (Props siehe Task 5), RPC `book_spot`.
- Produces: Monatsansicht mit Anzahl freier Plätze pro Tag; Tag-Klick zeigt freie Plätze mit Buchen-Form.

- [ ] **Step 1: Calendar-Page schreiben**

```tsx
// src/pages/Calendar.tsx
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { localDate, type Half, type Slot } from '../lib/slots'
import RangeForm from '../components/RangeForm'

type FreeRow = { spot_id: number; date: string; half: Half; booking_id: string | null }

const pad = (n: number) => String(n).padStart(2, '0')

export default function Calendar(_props: { userId: string }) {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth()) // 0-basiert
  const [free, setFree] = useState<FreeRow[]>([])
  const [selectedDay, setSelectedDay] = useState<string | null>(null)

  const first = `${year}-${pad(month + 1)}-01`
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const last = `${year}-${pad(month + 1)}-${pad(daysInMonth)}`

  const load = useCallback(async () => {
    const { data } = await supabase.from('free_slots').select('*')
      .gte('date', first).lte('date', last).is('booking_id', null)
    setFree((data ?? []) as FreeRow[])
  }, [first, last])

  useEffect(() => { load() }, [load])

  function shift(delta: number) {
    const d = new Date(year, month + delta, 1)
    setYear(d.getFullYear())
    setMonth(d.getMonth())
    setSelectedDay(null)
  }

  // Tag -> Map<spot_id, Half[]>
  function spotsOn(date: string) {
    const m = new Map<number, Half[]>()
    for (const f of free.filter(x => x.date === date)) {
      m.set(f.spot_id, [...(m.get(f.spot_id) ?? []), f.half])
    }
    return m
  }

  async function book(spotId: number, slots: Slot[]) {
    const { error } = await supabase.rpc('book_spot', { p_spot_id: spotId, p_slots: slots })
    if (error) throw new Error(error.message)
    await load()
  }

  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7 // Mo=0
  const today = localDate()
  const daySpots = selectedDay ? spotsOn(selectedDay) : null

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <button onClick={() => shift(-1)} className="px-2 py-1 bg-white rounded shadow">←</button>
        <h2 className="text-lg font-bold">
          {new Date(year, month).toLocaleDateString('de-AT', { month: 'long', year: 'numeric' })}
        </h2>
        <button onClick={() => shift(1)} className="px-2 py-1 bg-white rounded shadow">→</button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(d => (
          <div key={d} className="text-center text-xs text-gray-500">{d}</div>
        ))}
        {Array.from({ length: firstWeekday }, (_, i) => <div key={`pad${i}`} />)}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const date = `${year}-${pad(month + 1)}-${pad(i + 1)}`
          const count = spotsOn(date).size
          return (
            <button key={date} onClick={() => setSelectedDay(date)}
              className={`h-16 rounded p-1 text-left align-top border
                ${selectedDay === date ? 'border-blue-600' : 'border-transparent'}
                ${date === today ? 'bg-blue-50' : 'bg-white'} shadow-sm`}>
              <span className={date < today ? 'text-gray-400' : ''}>{i + 1}</span>
              {count > 0 && date >= today && (
                <div className="text-xs text-green-700 font-semibold">{count} frei</div>
              )}
            </button>
          )
        })}
      </div>

      {selectedDay && daySpots && (
        <div className="bg-white rounded-xl shadow p-4 space-y-3">
          <h3 className="font-bold">{selectedDay}</h3>
          {daySpots.size === 0 && <p className="text-gray-500">Keine freien Plätze.</p>}
          {[...daySpots.entries()].sort(([a], [b]) => a - b).map(([spotId, halves]) => (
            <details key={spotId} className="border rounded p-2">
              <summary className="cursor-pointer">
                Platz {spotId} — frei: {halves.sort().map(h => h === 'am' ? 'Vormittag' : 'Nachmittag').join(' + ')}
              </summary>
              <div className="pt-2">
                <RangeForm label="Buchen" initialDate={selectedDay}
                  onSubmit={slots => book(spotId, slots)} />
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Build + manueller Smoke**

```bash
npm run build && npm test
```

Expected: PASS. `npm run dev`: Monat rendert, Navigation ←/→ funktioniert, Tag-Klick öffnet Detail.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Calendar.tsx
git commit -m "feat: month calendar with free spot counts and booking"
```

---

### Task 7: Ledger-View + Admin-Bereich

**Files:**
- Modify: `src/pages/Ledger.tsx` (Platzhalter ersetzen)

**Interfaces:**
- Consumes: `supabase`, `fmtEur`, RPC `settle_ledger`; Edge Function `zahltag` (Task 8 — Button darf vor Task 8 einen Fehler-Toast zeigen, das ist ok).
- Produces: Offene-Posten-Liste mit „Beglichen"-Button; Beglichen-Historie; Admin-Karte (Tagessatz ändern, Zahltag-Mail, Besitzer-Zuordnung passiert direkt in Supabase Studio — kein UI).

- [ ] **Step 1: Ledger-Page schreiben**

```tsx
// src/pages/Ledger.tsx
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtEur } from '../lib/slots'

type LedgerRow = {
  id: string; debtor_id: string; creditor_id: string; amount_cents: number
  created_at: string; settled_at: string | null; settled_by: string | null
}

export default function Ledger({ userId }: { userId: string }) {
  const [rows, setRows] = useState<LedgerRow[]>([])
  const [names, setNames] = useState<Map<string, string>>(new Map())
  const [isAdmin, setIsAdmin] = useState(false)
  const [rate, setRate] = useState('')
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    const [l, p, st] = await Promise.all([
      supabase.from('ledger').select('*').order('created_at', { ascending: false }),
      supabase.from('profiles').select('id, name, is_admin'),
      supabase.from('settings').select('day_rate_cents').single(),
    ])
    setRows((l.data ?? []) as LedgerRow[])
    setNames(new Map((p.data ?? []).map(x => [x.id, x.name])))
    setIsAdmin((p.data ?? []).some(x => x.id === userId && x.is_admin))
    setRate(String((st.data?.day_rate_cents ?? 500) / 100))
  }, [userId])

  useEffect(() => { load() }, [load])

  const name = (id: string | null) => (id && names.get(id)) || '?'

  async function settle(id: string) {
    const { error } = await supabase.rpc('settle_ledger', { p_ledger_id: id })
    setMsg(error ? error.message : '')
    await load()
  }

  async function saveRate() {
    const cents = Math.round(parseFloat(rate.replace(',', '.')) * 100)
    const { error } = await supabase.from('settings')
      .update({ day_rate_cents: cents }).eq('id', true)
    setMsg(error ? error.message : `Tagessatz gespeichert: ${fmtEur(cents)}`)
  }

  async function zahltag() {
    if (!confirm('Zahltag-E-Mail an alle User schicken?')) return
    const { data, error } = await supabase.functions.invoke('zahltag')
    setMsg(error ? `Fehler: ${error.message}` : `Verschickt an ${data?.sent ?? '?'} Empfänger.`)
  }

  const open = rows.filter(r => !r.settled_at)
  const settled = rows.filter(r => r.settled_at)

  return (
    <div className="space-y-4">
      {msg && <p className="bg-yellow-50 border border-yellow-300 rounded p-2 text-sm">{msg}</p>}

      <section className="bg-white rounded-xl shadow p-4">
        <h2 className="text-lg font-bold mb-2">Offene Schulden</h2>
        {open.length === 0 && <p className="text-gray-500">Keine offenen Schulden. 🎉</p>}
        <ul className="divide-y">
          {open.map(r => (
            <li key={r.id} className="py-2 flex items-center gap-2">
              <span>
                <b>{name(r.debtor_id)}</b> schuldet <b>{name(r.creditor_id)}</b>{' '}
                {fmtEur(r.amount_cents)}
                <span className="text-gray-400 text-xs ml-2">
                  seit {new Date(r.created_at).toLocaleDateString('de-AT')}
                </span>
              </span>
              {(r.debtor_id === userId || r.creditor_id === userId) && (
                <button onClick={() => settle(r.id)}
                  className="ml-auto bg-green-600 text-white rounded px-3 py-1 text-sm">
                  Schulden beglichen
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <details className="bg-white rounded-xl shadow p-4">
        <summary className="text-lg font-bold cursor-pointer">
          Beglichen ({settled.length})
        </summary>
        <ul className="divide-y mt-2">
          {settled.map(r => (
            <li key={r.id} className="py-2 text-sm text-gray-600">
              {name(r.debtor_id)} → {name(r.creditor_id)}: {fmtEur(r.amount_cents)}
              {' — '}beglichen am {new Date(r.settled_at!).toLocaleDateString('de-AT')}
              {' '}durch {name(r.settled_by)}
            </li>
          ))}
        </ul>
      </details>

      {isAdmin && (
        <section className="bg-white rounded-xl shadow p-4 space-y-3">
          <h2 className="text-lg font-bold">Admin</h2>
          <div className="flex items-center gap-2">
            <label>Tagessatz (€):</label>
            <input value={rate} onChange={e => setRate(e.target.value)}
              className="border rounded p-1 w-20" />
            <button onClick={saveRate} className="bg-blue-600 text-white rounded px-3 py-1">
              Speichern
            </button>
          </div>
          <button onClick={zahltag} className="bg-red-600 text-white rounded px-3 py-1">
            📧 Zahltag-E-Mail an alle schicken
          </button>
          <p className="text-xs text-gray-500">
            User einladen & Plätze zuordnen: Supabase Studio (Auth → Invite, Tabelle spots → owner_id).
          </p>
        </section>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Build + manueller Smoke**

```bash
npm run build && npm test
```

Expected: PASS. `npm run dev`: Ledger rendert (leer), keine Console-Errors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Ledger.tsx
git commit -m "feat: ledger view with settle button and admin panel"
```

---

### Task 8: Zahltag Edge Function

**Files:**
- Create: `supabase/functions/zahltag/index.ts`

**Interfaces:**
- Consumes: `profiles.is_admin`, Auth-User-Liste, Env-Secrets `RESEND_API_KEY` (manuell zu setzen), `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` (von Supabase automatisch bereitgestellt).
- Produces: Edge Function `zahltag` — nur für Admins, antwortet `{ sent: number }`; wird vom Ledger-Admin-Button via `supabase.functions.invoke('zahltag')` aufgerufen.

- [ ] **Step 1: Function schreiben**

```ts
// supabase/functions/zahltag/index.ts
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  // Caller muss eingeloggter Admin sein
  const authed = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: req.headers.get('Authorization')! } } },
  )
  const { data: { user } } = await authed.auth.getUser()
  const { data: profile } = user
    ? await authed.from('profiles').select('is_admin').eq('id', user.id).single()
    : { data: null }
  if (!profile?.is_admin) {
    return new Response(JSON.stringify({ error: 'forbidden' }),
      { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } })
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 100 })
  if (error) {
    return new Response(JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } })
  }
  const emails = data.users.map(u => u.email).filter((e): e is string => !!e)

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Garage <onboarding@resend.dev>', // ponytail: resend-testdomain, eigene domain später
      to: [user!.email],
      bcc: emails,
      subject: 'Heute ist Zahltag 💸',
      html: '<p>Hallo!</p><p>Heute ist Zahltag: Bitte schaut ins Garagen-Tool und begleicht eure offenen Schulden.</p>',
    }),
  })
  if (!res.ok) {
    return new Response(JSON.stringify({ error: await res.text() }),
      { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } })
  }
  return new Response(JSON.stringify({ sent: emails.length }),
    { headers: { ...cors, 'Content-Type': 'application/json' } })
})
```

- [ ] **Step 2: Deployen**

MCP: `mcp__supabase__deploy_edge_function` mit `name: "zahltag"` und der Datei als Content.
Expected: success.

- [ ] **Step 3: Auth-Schutz verifizieren**

```bash
curl -s -o /dev/null -w "%{http_code}" -X POST "<PROJECT_URL>/functions/v1/zahltag" \
  -H "Authorization: Bearer <ANON_KEY>" -H "apikey: <ANON_KEY>"
```

(`<PROJECT_URL>`/`<ANON_KEY>` aus `.env.local`.) Expected: `403` — ohne Admin-Login kein Versand. Der echte Versand wird nach dem Setzen von `RESEND_API_KEY` manuell getestet (siehe Task 9 README).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/zahltag/index.ts
git commit -m "feat: zahltag edge function (admin-only, resend)"
```

---

### Task 9: README + Deploy-Anleitung

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: alles Vorherige.
- Produces: Setup-/Betriebs-Doku für den Admin (Luke).

- [ ] **Step 1: README schreiben**

````markdown
# Garagen-Tool

WG-Tool für 24 Garagenplätze: freigeben, buchen, Schulden-Ledger (5 €/Tag, 2,50 €/Halbtag).
Spec: `docs/superpowers/specs/2026-07-23-garage-management-design.md`

## Stack

Supabase (Postgres + Auth + Edge Functions) · React/TS/Tailwind (Vite) · Vercel

## Lokal entwickeln

```bash
npm install
# .env.local anlegen:
#   VITE_SUPABASE_URL=https://dvdasdgduhfalrtcjrdb.supabase.co
#   VITE_SUPABASE_ANON_KEY=<publishable key aus Supabase Studio → Settings → API>
npm run dev
npm test          # Unit-Tests (Slot-/Preis-Logik)
```

DB-Smoke-Test: `scripts/db-smoke.sql` im Supabase SQL Editor ausführen (rollt selbst zurück).

## Einmalige Einrichtung (Supabase Studio)

1. **Signups deaktivieren:** Authentication → Sign In / Up → "Allow new users to sign up" aus.
   (Login geht per Magic Link, rein kommen nur eingeladene User.)
2. **Admin setzen:** Tabelle `profiles` → bei dir `is_admin = true`.
3. **Resend:** Account auf resend.com, API-Key erzeugen, in Supabase unter
   Edge Functions → zahltag → Secrets als `RESEND_API_KEY` hinterlegen.
   Ohne eigene verifizierte Domain versendet Resend nur an die eigene Account-Adresse —
   für den echten Rundversand Domain bei Resend verifizieren und `from:` in
   `supabase/functions/zahltag/index.ts` anpassen.

## Betrieb (Admin-Aufgaben)

- **User einladen:** Authentication → Users → "Invite user" (max. 50).
- **Platz zuordnen:** Tabelle `spots` → `owner_id` des Users eintragen (24 Plätze, 2 Reihen à 12).
- **Tagessatz ändern / Zahltag-Mail:** in der App, Tab "Ledger" → Admin-Bereich.

## Deploy (Vercel)

1. Repo zu GitHub pushen, in Vercel importieren (Framework: Vite, Root: Repo-Root).
2. Env-Vars `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` setzen.
3. Supabase: Authentication → URL Configuration → Site URL auf die Vercel-URL setzen
   (sonst zeigen Magic Links auf localhost).
````

- [ ] **Step 2: Gesamtverifikation**

```bash
npm run build && npm test
```

Expected: PASS. Zusätzlich MCP `mcp__supabase__get_advisors` (`type: "security"`): keine neuen Errors.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: setup, admin and deploy guide"
```
