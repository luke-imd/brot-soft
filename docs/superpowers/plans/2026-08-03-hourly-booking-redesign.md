# Stundenbuchung + Tagespauschale + Garagenplan — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Buchen/Freigeben in Stunden statt Halbtagen mit 3 €-Tagespauschale, echter 23-Plätze-Garagenplan, Kalender als Startseite mit Buchen+Freigeben+Platz-Eintragen, Garage-Tab als reine Orientierung, Ledger → „Meine Buchungen" mit Storno, Selbst-Registrierung mit Sucher/Platz-Wahl.

**Architecture:** `free_slots` behält sein Muster, nur feiner: `hour (0–23)` statt `half`, PK `(spot_id, date, hour)` — Doppelbuchung bleibt DB-seitig unmöglich. Preis = distinct Kalendertage × `day_rate_cents` (300), Client (`priceCents`) und Server (`book_spot`) identisch. Neuer RPC `claim_spot` für Selbst-Eintragen; `join`-Edge-Function liefert zusätzlich die freie Platzliste (code-gated) und ordnet Wunsch-Plätze zu.

**Tech Stack:** React 19 + TS + Tailwind v4 (Vite), Supabase (Postgres RLS/RPC, Edge Functions via Supabase-MCP), Vitest.

**Spec:** `docs/superpowers/specs/2026-08-03-hourly-booking-redesign-design.md`

## Global Constraints

- UI-Sprache Deutsch, Code/Identifier Englisch.
- Beträge immer in Cents (int); Anzeige via `fmtEur`.
- Datum immer `YYYY-MM-DD` lokal (`localDate`), nie `toISOString()` für Anzeige (UTC-Arithmetik nur intern zur Datums-Iteration).
- DB-Änderungen NUR als neue Migration unter `supabase/migrations/` (nie bestehende editieren), anwenden via Supabase-MCP `mcp__supabase__apply_migration` (Tool-Schema vorher per ToolSearch laden). Edge Functions via `mcp__supabase__deploy_edge_function`.
- Stunden-Zeitraum: Ende **exklusiv** (endHour 24 = bis Mitternacht). Nur volle Stunden.
- Commits klein pro Task, Message-Suffix: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Verifikation je Frontend-Task: `npm test` und `npm run build` müssen grün sein.

---

### Task 1: Stunden-Logik in `lib/slots.ts` (TDD)

**Files:**
- Modify: `src/lib/slots.ts` (komplett ersetzen)
- Test: `src/lib/slots.test.ts` (komplett ersetzen)

**Interfaces:**
- Produces (von allen Folge-Tasks genutzt):
  - `type Slot = { date: string; hour: number }`
  - `hourRange(startDate: string, startHour: number, endDate: string, endHour: number): Slot[]` — Ende exklusiv, `[]` bei umgekehrtem Zeitraum
  - `priceCents(slots: Slot[], dayRateCents: number): number` — distinct dates × Satz
  - `hourSpans(hours: number[]): [number, number][]` — sortiert, zusammenhängende Stunden zu `[von, bis)`-Bereichen gemergt
  - `fmtSpan(span: [number, number]): string` — `"8–12 Uhr"`, `[0,24]` → `"ganztags"`
  - `localDate`, `fmtEur` unverändert
  - Entfällt: `Half`, `slotRange`, alte `priceCents(slotCount, rate)`-Signatur

- [ ] **Step 1: Failing Tests schreiben** — `src/lib/slots.test.ts` komplett ersetzen:

```ts
import { describe, expect, it } from 'vitest'
import { fmtEur, fmtSpan, hourRange, hourSpans, localDate, priceCents } from './slots'

describe('hourRange', () => {
  it('expands a partial single day, end exclusive', () => {
    expect(hourRange('2026-08-01', 11, '2026-08-01', 13)).toEqual([
      { date: '2026-08-01', hour: 11 },
      { date: '2026-08-01', hour: 12 },
    ])
  })

  it('expands a full day with endHour 24', () => {
    const slots = hourRange('2026-08-01', 0, '2026-08-01', 24)
    expect(slots).toHaveLength(24)
    expect(slots[0]).toEqual({ date: '2026-08-01', hour: 0 })
    expect(slots[23]).toEqual({ date: '2026-08-01', hour: 23 })
  })

  it('crosses days and months', () => {
    const slots = hourRange('2026-08-31', 22, '2026-09-01', 2)
    expect(slots).toEqual([
      { date: '2026-08-31', hour: 22 },
      { date: '2026-08-31', hour: 23 },
      { date: '2026-09-01', hour: 0 },
      { date: '2026-09-01', hour: 1 },
    ])
  })

  it('returns [] for reversed ranges', () => {
    expect(hourRange('2026-08-02', 0, '2026-08-01', 24)).toEqual([])
    expect(hourRange('2026-08-01', 13, '2026-08-01', 13)).toEqual([])
    expect(hourRange('2026-08-01', 13, '2026-08-01', 11)).toEqual([])
  })
})

describe('priceCents', () => {
  it('charges the full day rate per distinct date, hours do not matter', () => {
    expect(priceCents(hourRange('2026-08-01', 11, '2026-08-01', 13), 300)).toBe(300)
    expect(priceCents(hourRange('2026-08-01', 15, '2026-08-03', 18), 300)).toBe(900)
  })
  it('returns 0 for empty slots', () => {
    expect(priceCents([], 300)).toBe(0)
  })
})

describe('hourSpans', () => {
  it('merges consecutive hours into [from, to) spans', () => {
    expect(hourSpans([8, 9, 10, 15, 16])).toEqual([[8, 11], [15, 17]])
  })
  it('handles unsorted input and duplicates', () => {
    expect(hourSpans([10, 8, 9, 9])).toEqual([[8, 11]])
  })
  it('returns [] for empty input', () => {
    expect(hourSpans([])).toEqual([])
  })
})

describe('fmtSpan', () => {
  it('formats a span', () => {
    expect(fmtSpan([8, 12])).toBe('8–12 Uhr')
  })
  it('formats the full day as ganztags', () => {
    expect(fmtSpan([0, 24])).toBe('ganztags')
  })
})

it('fmtEur formats cents as euro', () => {
  expect(fmtEur(750)).toMatch(/7,50/)
})

it('localDate formats local YYYY-MM-DD', () => {
  expect(localDate(new Date(2026, 7, 1))).toBe('2026-08-01')
})
```

- [ ] **Step 2: Tests laufen lassen, Scheitern verifizieren** — Run: `npm test -- --run` — Expected: FAIL (hourRange etc. existieren nicht).

- [ ] **Step 3: `src/lib/slots.ts` komplett ersetzen:**

```ts
// Type-Alias, kein Interface: Aliase haben eine implizite Index-Signatur und sind
// dadurch direkt an den generierten `Json`-RPC-Parametertyp zuweisbar.
export type Slot = { date: string; hour: number }

export function localDate(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

// Durchgehender Zeitraum „von Datum+Stunde bis Datum+Stunde", Ende exklusiv
// (endHour 24 = bis Mitternacht). Eine Slot-Zeile pro voller Stunde.
export function hourRange(
  startDate: string, startHour: number, endDate: string, endHour: number,
): Slot[] {
  const out: Slot[] = []
  // UTC-Mitternacht als reine Datums-Arithmetik, Ausgabe bleibt der String
  const d = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)
  while (d <= end) {
    const date = d.toISOString().slice(0, 10)
    const from = date === startDate ? startHour : 0
    const to = date === endDate ? endHour : 24
    for (let h = from; h < to; h++) out.push({ date, hour: h })
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

// Tagespauschale: jeder angefangene Kalendertag zählt voll, Stunden egal.
export function priceCents(slots: Slot[], dayRateCents: number): number {
  return new Set(slots.map(s => s.date)).size * dayRateCents
}

// Stunden-Liste zu zusammenhängenden [von, bis)-Bereichen mergen (für Anzeige).
export function hourSpans(hours: number[]): [number, number][] {
  const sorted = [...new Set(hours)].sort((a, b) => a - b)
  const out: [number, number][] = []
  for (const h of sorted) {
    const last = out[out.length - 1]
    if (last && last[1] === h) last[1] = h + 1
    else out.push([h, h + 1])
  }
  return out
}

export function fmtSpan([from, to]: [number, number]): string {
  return from === 0 && to === 24 ? 'ganztags' : `${from}–${to} Uhr`
}

export function fmtEur(cents: number): string {
  return (cents / 100).toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })
}
```

- [ ] **Step 4: Tests laufen lassen** — Run: `npm test -- --run` — Expected: alle PASS. (`npm run build` scheitert jetzt erwartungsgemäß, weil RangeForm/Garage/Calendar noch die alte API nutzen — das reparieren Tasks 3–6; **nicht** in diesem Task fixen.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/slots.ts src/lib/slots.test.ts
git commit -m "feat: hour-based slot logic with flat per-day pricing"
```

---

### Task 2: Migration `hourly_spots` + Typen regenerieren

**Files:**
- Create: `supabase/migrations/20260803000006_hourly_spots.sql`
- Modify: `src/lib/database.types.ts` (via MCP regeneriert)

**Interfaces:**
- Produces: `free_slots.hour int` (PK `(spot_id, date, hour)`, `half` entfällt), `spots.active boolean` (`grid_row`/`grid_col` entfallen, Platz 24 gelöscht, 5/7/9/19 inaktiv), `profiles.seeker boolean`, `settings.day_rate_cents = 300`, `book_spot(p_spot_id int, p_slots jsonb)` mit `[{"date","hour"}]` und Tagespauschale, neuer RPC `claim_spot(p_spot_id int)`.

- [ ] **Step 1: Migrations-File anlegen** — `supabase/migrations/20260803000006_hourly_spots.sql`:

```sql
-- Stunden statt Halbtage, Tagespauschale, 23 echte Plätze (Plan Objekt 2), claim_spot.

-- 1) free_slots: half -> hour. am -> Stunden 0-11, pm -> 12-23, Buchungszuordnung bleibt.
alter table public.free_slots drop constraint free_slots_pkey;
alter table public.free_slots add column hour int;

-- Bestandszeilen zu je 12 Stunden-Zeilen auffächern: 11 neue Zeilen je Halbtag ...
insert into public.free_slots (spot_id, date, half, hour, booking_id)
select f.spot_id, f.date, f.half,
       case when f.half = 'am' then gs.h else gs.h + 12 end,
       f.booking_id
from public.free_slots f
cross join generate_series(1, 11) as gs(h)
where f.hour is null;

-- ... und die Originalzeile wird Stunde 0 bzw. 12.
update public.free_slots set hour = case when half = 'am' then 0 else 12 end
where hour is null;

alter table public.free_slots alter column hour set not null;
alter table public.free_slots add constraint free_slots_hour_check check (hour between 0 and 23);
alter table public.free_slots drop column half;
alter table public.free_slots add primary key (spot_id, date, hour);

-- 2) spots: aktiv-Flag, Fahrrad-/Traktor-Plätze deaktivieren, Platz 24 existiert nicht.
alter table public.spots add column active boolean not null default true;
update public.spots set active = false, owner_id = null where id in (5, 7, 9, 19);
delete from public.free_slots where spot_id = 24 and booking_id is null;
delete from public.spots where id = 24; -- schlägt bewusst fehl, falls echte Buchungen existieren
alter table public.spots drop column grid_row;
alter table public.spots drop column grid_col;

-- 3) profiles: Platzsucher-Marker (rein informativ, Anzeige in der Admin-Liste).
alter table public.profiles add column seeker boolean not null default false;

-- 4) Tagespauschale 3 €.
update public.settings set day_rate_cents = 300;

-- 5) book_spot: Slots sind jetzt {date, hour}; Preis = distinct Tage × Tagessatz.
create or replace function public.book_spot(p_spot_id int, p_slots jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_booking_id uuid;
  v_expected int;
  v_count int;
  v_days int;
  v_owner uuid;
  v_rate int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select owner_id into v_owner from spots where id = p_spot_id;
  if v_owner is null then raise exception 'Platz hat keinen Besitzer'; end if;
  if v_owner = auth.uid() then raise exception 'Eigenen Platz kann man nicht buchen'; end if;
  v_expected := jsonb_array_length(p_slots);
  if v_expected is null or v_expected = 0 then raise exception 'Keine Stunden angegeben'; end if;

  insert into bookings (spot_id, borrower_id) values (p_spot_id, auth.uid())
  returning id into v_booking_id;

  update free_slots f set booking_id = v_booking_id
  from jsonb_to_recordset(p_slots) as s(date date, hour int)
  where f.spot_id = p_spot_id and f.date = s.date and f.hour = s.hour
    and f.booking_id is null and f.date >= current_date;
  get diagnostics v_count = row_count;
  if v_count <> v_expected then
    raise exception 'Nicht alle Stunden sind (mehr) frei';
  end if;

  -- Tagespauschale: jeder angefangene Kalendertag zählt voll.
  select count(distinct s.date) into v_days
  from jsonb_to_recordset(p_slots) as s(date date, hour int);
  select day_rate_cents into v_rate from settings;
  insert into ledger (booking_id, debtor_id, creditor_id, amount_cents)
  values (v_booking_id, auth.uid(), v_owner, v_days * v_rate);
  return v_booking_id;
end $$;

-- 6) Selbst-Eintragen eines besitzerlosen aktiven Platzes, race-sicher.
create function public.claim_spot(p_spot_id int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  update spots set owner_id = auth.uid()
  where id = p_spot_id and owner_id is null and active;
  if not found then raise exception 'Platz ist schon vergeben oder nicht verfügbar'; end if;
end $$;

revoke execute on function public.claim_spot(int) from public, anon;
grant execute on function public.claim_spot(int) to authenticated;
```

- [ ] **Step 2: Migration anwenden** — ToolSearch `select:mcp__supabase__apply_migration,mcp__supabase__generate_typescript_types,mcp__supabase__execute_sql`, dann `apply_migration` mit `name: "20260803000006_hourly_spots"` und obigem SQL als `query`. Expected: success.

- [ ] **Step 3: Verifizieren** — `execute_sql`: `select count(*) as spots, count(*) filter (where active) as active from public.spots; select day_rate_cents from public.settings;` — Expected: 23 spots, 19 active, rate 300.

- [ ] **Step 4: Typen regenerieren** — `generate_typescript_types`, Ergebnis nach `src/lib/database.types.ts` schreiben (File komplett ersetzen). Danach prüfen: enthält `hour: number` in `free_slots`, `active: boolean` in `spots`, `seeker: boolean` in `profiles`, `claim_spot` unter Functions.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260803000006_hourly_spots.sql src/lib/database.types.ts
git commit -m "feat(db): hourly free_slots, flat day rate, 23 real spots, claim_spot RPC"
```

---

### Task 3: `RangeForm` auf Datum+Uhrzeit umstellen

**Files:**
- Modify: `src/components/RangeForm.tsx` (komplett ersetzen)

**Interfaces:**
- Consumes: `hourRange`, `priceCents`, `fmtEur`, `localDate`, `Slot` aus Task 1.
- Produces: `RangeForm({ label, initialDate?, rateCents?, onSubmit })` — `onSubmit(slots: Slot[])`; zeigt bei gesetztem `rateCents` den Preis (Tage × Satz) im Button.

- [ ] **Step 1: `src/components/RangeForm.tsx` komplett ersetzen:**

```tsx
import { useState } from 'react'
import { fmtEur, hourRange, localDate, priceCents, type Slot } from '../lib/slots'

const pad2 = (n: number) => String(n).padStart(2, '0')
const START_HOURS = Array.from({ length: 24 }, (_, h) => h)      // 0..23
const END_HOURS = Array.from({ length: 24 }, (_, h) => h + 1)    // 1..24

/**
 * Zeitraum-Formular „von Datum+Uhrzeit bis Datum+Uhrzeit" (volle Stunden,
 * Ende exklusiv, 24:00 = Mitternacht). Rechnet den Zeitraum in Stunden-Slots
 * um und meldet sie an onSubmit; mit rateCents zeigt der Button den Preis
 * (Tagespauschale × angefangene Tage).
 */
export default function RangeForm({ label, initialDate, rateCents, onSubmit }: {
  label: string
  initialDate?: string
  rateCents?: number
  onSubmit: (slots: Slot[]) => Promise<void>
}) {
  const init = initialDate ?? localDate()
  const [startDate, setStartDate] = useState(init)
  const [startHour, setStartHour] = useState(0)
  const [endDate, setEndDate] = useState(init)
  const [endHour, setEndHour] = useState(24)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const slots = hourRange(startDate, startHour, endDate, endHour)
  const days = new Set(slots.map(s => s.date)).size

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
        <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
          className="input" />
        <select value={startHour} onChange={e => setStartHour(Number(e.target.value))}
          className="input">
          {START_HOURS.map(h => <option key={h} value={h}>{pad2(h)}:00</option>)}
        </select>
        <span className="text-sm text-zinc-500">bis</span>
        <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
          className="input" />
        <select value={endHour} onChange={e => setEndHour(Number(e.target.value))}
          className="input">
          {END_HOURS.map(h => <option key={h} value={h}>{pad2(h)}:00</option>)}
        </select>
      </div>
      <button disabled={busy || slots.length === 0} className="btn btn-primary">
        {label} ({days} {days === 1 ? 'Tag' : 'Tage'}
        {rateCents != null && slots.length > 0 ? ` · ${fmtEur(priceCents(slots, rateCents))}` : ''})
      </button>
      {error && <p className="text-red-600 text-sm">{error}</p>}
    </form>
  )
}
```

- [ ] **Step 2: Verifizieren** — Run: `npm test -- --run` — Expected: PASS. (`npm run build` scheitert weiter an Garage/Calendar — Tasks 4–6.)

- [ ] **Step 3: Commit**

```bash
git add src/components/RangeForm.tsx
git commit -m "feat: RangeForm with date+hour range and inline price"
```

---

### Task 4: Kalender = Startseite mit Buchen, Freigeben, Platz eintragen

**Files:**
- Modify: `src/pages/Calendar.tsx` (komplett ersetzen)

**Interfaces:**
- Consumes: `hourRange`-basierte `Slot`, `hourSpans`, `fmtSpan`, `priceCents`, `fmtEur`, `localDate` (Task 1); `RangeForm` mit `rateCents` (Task 3); DB `free_slots.hour`, `spots.active`, RPC `claim_spot` (Task 2).
- Produces: `Calendar({ userId })` — vollständige Buchen/Freigeben/Eintragen-Seite (wird in Task 6 zur Startseite).

- [ ] **Step 1: `src/pages/Calendar.tsx` komplett ersetzen:**

```tsx
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtSpan, hourSpans, localDate, type Slot } from '../lib/slots'
import RangeForm from '../components/RangeForm'

type FreeRow = { spot_id: number; date: string; hour: number; booking_id: string | null }
type SpotRow = { id: number; owner_id: string | null; active: boolean }

const pad = (n: number) => String(n).padStart(2, '0')

export default function Calendar({ userId }: { userId: string }) {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth()) // 0-basiert
  const [free, setFree] = useState<FreeRow[]>([])
  const [spots, setSpots] = useState<SpotRow[]>([])
  const [rate, setRate] = useState(300)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [claimId, setClaimId] = useState('')
  const [msg, setMsg] = useState('')
  const [loadError, setLoadError] = useState('')

  const first = `${year}-${pad(month + 1)}-01`
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const last = `${year}-${pad(month + 1)}-${pad(daysInMonth)}`

  const load = useCallback(async () => {
    const [f, s, st] = await Promise.all([
      supabase.from('free_slots').select('*')
        .gte('date', first).lte('date', last).is('booking_id', null),
      supabase.from('spots').select('id, owner_id, active').order('id'),
      supabase.from('settings').select('day_rate_cents').single(),
    ])
    const err = f.error ?? s.error ?? st.error
    if (err) {
      setLoadError(`Fehler beim Laden: ${err.message}`)
      return
    }
    setLoadError('')
    setFree((f.data ?? []) as FreeRow[])
    setSpots((s.data ?? []) as SpotRow[])
    setRate(st.data?.day_rate_cents ?? 300)
  }, [first, last])

  useEffect(() => { load() }, [load])

  function shift(delta: number) {
    const d = new Date(year, month + delta, 1)
    setYear(d.getFullYear())
    setMonth(d.getMonth())
    setSelectedDay(null)
  }

  // Tag -> Map<spot_id, freie Stunden>
  function spotsOn(date: string) {
    const m = new Map<number, number[]>()
    for (const f of free.filter(x => x.date === date)) {
      m.set(f.spot_id, [...(m.get(f.spot_id) ?? []), f.hour])
    }
    return m
  }

  async function book(spotId: number, slots: Slot[]) {
    const { error } = await supabase.rpc('book_spot', { p_spot_id: spotId, p_slots: slots })
    if (error) throw new Error(error.message)
    setMsg(`Platz ${spotId} gebucht ✓`)
    await load()
  }

  async function freeUp(spotId: number, slots: Slot[]) {
    const { error } = await supabase.from('free_slots').upsert(
      slots.map(s => ({ spot_id: spotId, date: s.date, hour: s.hour })),
      { onConflict: 'spot_id,date,hour', ignoreDuplicates: true },
    )
    if (error) throw new Error(error.message)
    setMsg(`Platz ${spotId} freigegeben ✓`)
    await load()
  }

  async function retract(spotId: number, slots: Slot[]) {
    // stundengenau löschen: eine Query pro betroffenem Tag
    for (const date of [...new Set(slots.map(s => s.date))]) {
      const hours = slots.filter(s => s.date === date).map(s => s.hour)
      const { error } = await supabase.from('free_slots').delete()
        .eq('spot_id', spotId).eq('date', date).is('booking_id', null).in('hour', hours)
      if (error) throw new Error(error.message)
    }
    setMsg('Freigabe zurückgezogen')
    await load()
  }

  async function claim() {
    const { error } = await supabase.rpc('claim_spot', { p_spot_id: Number(claimId) })
    setMsg(error ? error.message : `Platz ${claimId} gehört jetzt dir ✓`)
    await load()
  }

  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7 // Mo=0
  const today = localDate()
  const daySpots = selectedDay ? spotsOn(selectedDay) : null
  const mySpots = spots.filter(s => s.owner_id === userId)
  const claimable = spots.filter(s => !s.owner_id && s.active)
  const eyebrow = 'mb-2 text-[11px] font-extrabold uppercase tracking-wide text-zinc-500'

  return (
    <div className="space-y-4">
      {loadError && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</p>}
      {msg && <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{msg}</p>}

      <div className="flex items-center gap-3">
        <button onClick={() => shift(-1)} aria-label="Voriger Monat"
          className="btn btn-outline h-9 w-9 rounded-full px-0">←</button>
        <h2 className="min-w-44 text-center text-lg font-bold tracking-tight">
          {new Date(year, month).toLocaleDateString('de-AT', { month: 'long', year: 'numeric' })}
        </h2>
        <button onClick={() => shift(1)} aria-label="Nächster Monat"
          className="btn btn-outline h-9 w-9 rounded-full px-0">→</button>
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(d => (
          <div key={d} className="pb-1 text-center text-xs font-semibold uppercase tracking-wide text-zinc-400">{d}</div>
        ))}
        {Array.from({ length: firstWeekday }, (_, i) => <div key={`pad${i}`} />)}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const date = `${year}-${pad(month + 1)}-${pad(i + 1)}`
          const count = spotsOn(date).size
          return (
            <button key={date} onClick={() => setSelectedDay(date)}
              className={`h-16 rounded-xl border bg-white p-1.5 text-left text-sm transition-colors
                ${selectedDay === date ? 'border-zinc-900 ring-1 ring-zinc-900' : 'border-zinc-200 hover:border-zinc-400'}`}>
              <span className={
                date === today
                  ? 'inline-grid h-5 w-5 place-items-center rounded-full bg-blue-600 text-xs font-bold text-white'
                  : date < today ? 'text-zinc-300' : 'font-medium'
              }>
                {i + 1}
              </span>
              {count > 0 && date >= today && (
                <div className="mt-0.5">
                  <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-xs font-semibold text-emerald-700">
                    {count} frei
                  </span>
                </div>
              )}
            </button>
          )
        })}
      </div>

      {selectedDay && daySpots && (
        <div className="card fade-in space-y-3">
          <h3 className="font-bold tracking-tight">
            {new Date(`${selectedDay}T00:00:00`).toLocaleDateString('de-AT', { weekday: 'long', day: 'numeric', month: 'long' })}
          </h3>
          {daySpots.size === 0 && <p className="text-zinc-500">Keine freien Plätze an diesem Tag.</p>}
          {[...daySpots.entries()].sort(([a], [b]) => a - b)
            .filter(([spotId]) => spots.find(s => s.id === spotId)?.owner_id !== userId)
            .map(([spotId, hours]) => (
              <details key={spotId} className="rounded-xl border border-zinc-200 p-3 transition-colors open:bg-zinc-50">
                <summary className="cursor-pointer select-none text-sm font-medium">
                  Platz {spotId} — frei: {hourSpans(hours).map(fmtSpan).join(', ')}
                </summary>
                <div className="pt-3">
                  <RangeForm key={`cal-${spotId}-${selectedDay}`} label="Buchen"
                    initialDate={selectedDay} rateCents={rate}
                    onSubmit={slots => book(spotId, slots)} />
                </div>
              </details>
            ))}
        </div>
      )}

      <div className="card space-y-3">
        <h2 className="text-lg font-bold tracking-tight">Mein Platz</h2>
        {mySpots.length > 0 ? (
          mySpots.map(spot => (
            <details key={spot.id} className="rounded-xl border border-zinc-200 p-3 transition-colors open:bg-zinc-50">
              <summary className="cursor-pointer select-none text-sm font-medium">
                Platz {spot.id} — freigeben oder Freigabe zurückziehen
              </summary>
              <div className="grid gap-4 pt-3">
                <div>
                  <h3 className={eyebrow}>Zeitraum freigeben</h3>
                  <RangeForm key={`free-${spot.id}-${selectedDay}`} label="Freigeben"
                    initialDate={selectedDay ?? undefined}
                    onSubmit={slots => freeUp(spot.id, slots)} />
                </div>
                <div className="border-t border-zinc-200 pt-3.5">
                  <h3 className={eyebrow}>Freigabe zurückziehen</h3>
                  <RangeForm key={`retract-${spot.id}-${selectedDay}`} label="Zurückziehen"
                    initialDate={selectedDay ?? undefined}
                    onSubmit={slots => retract(spot.id, slots)} />
                </div>
              </div>
            </details>
          ))
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-zinc-600">
              Du hast noch keinen Platz eingetragen. Wenn du einen Garagenplatz hast, trag ihn hier ein —
              dann kannst du ihn bei Abwesenheit freigeben.
            </p>
            {claimable.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <select value={claimId} onChange={e => setClaimId(e.target.value)} className="input">
                  <option value="">Platz wählen…</option>
                  {claimable.map(s => <option key={s.id} value={s.id}>Platz {s.id}</option>)}
                </select>
                <button onClick={claim} disabled={!claimId} className="btn btn-primary">
                  Das ist mein Platz
                </button>
              </div>
            ) : (
              <p className="text-sm text-zinc-400">Aktuell sind alle Plätze vergeben — bei Fragen an den Admin wenden.</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verifizieren** — Run: `npm test -- --run` — Expected: PASS. (`npm run build` scheitert nur noch an `Garage.tsx` — Task 5.)

- [ ] **Step 3: Commit**

```bash
git add src/pages/Calendar.tsx
git commit -m "feat: calendar with hourly booking, spot release and self-service claim"
```

---

### Task 5: Garage-Tab = Orientierung (Plan-Bild + Besitzer-Liste)

**Files:**
- Modify: `src/pages/Garage.tsx` (komplett ersetzen)
- Commit (bereits im Working Tree, von der Session vorbereitet): `public/garagenplan.png` — der echte Garagenplan, bereits um 180° gedreht. **Nicht neu erzeugen**; nur prüfen, dass die Datei existiert (`ls public/garagenplan.png`).

**Interfaces:**
- Consumes: DB `spots.active` (Task 2).
- Produces: `Garage({ userId })` — reine Anzeige, keine Aktionen.

- [ ] **Step 1: `src/pages/Garage.tsx` komplett ersetzen:**

```tsx
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

type SpotRow = { id: number; owner_id: string | null; active: boolean }

// ponytail: reine Orientierungs-Seite — Plan-Bild + Besitzer-Liste, keine Aktionen.
// Gebucht/gebucht-werden passiert im Kalender.
const INACTIVE_LABEL: Record<number, string> = { 5: 'Fahrrad', 7: 'Fahrrad', 9: 'Traktor', 19: 'Fahrrad' }

export default function Garage({ userId }: { userId: string }) {
  const [spots, setSpots] = useState<SpotRow[]>([])
  const [names, setNames] = useState<Map<string, string>>(new Map())
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    Promise.all([
      supabase.from('spots').select('id, owner_id, active').order('id'),
      supabase.from('profiles').select('id, name'),
    ]).then(([s, p]) => {
      const err = s.error ?? p.error
      if (err) {
        setLoadError(`Fehler beim Laden: ${err.message}`)
        return
      }
      setSpots((s.data ?? []) as SpotRow[])
      setNames(new Map((p.data ?? []).map(x => [x.id, x.name])))
    })
  }, [])

  return (
    <div className="space-y-5">
      {loadError && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</p>}

      <div>
        <h1 className="text-[27px] font-extrabold leading-tight tracking-tight">Garagenplan</h1>
        <p className="mt-1 text-sm font-medium text-zinc-500">
          Objekt 2 · Gemeinschaft B.R.O.T. Kalksburg — zur Orientierung. Gebucht wird im Kalender.
        </p>
      </div>

      <div className="card overflow-x-auto p-3">
        <img src="/garagenplan.png" alt="Garagenplan Objekt 2 mit den Platznummern 1–23"
          className="min-w-[700px] max-w-none sm:min-w-0 sm:max-w-full" />
      </div>

      <div className="card">
        <h2 className="mb-3 text-lg font-bold tracking-tight">Wem gehört welcher Platz?</h2>
        <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {spots.map(spot => (
            <div key={spot.id} className="flex items-baseline gap-2 border-b border-zinc-100 py-1.5 text-sm">
              <span className="w-16 shrink-0 font-bold">Platz {spot.id}</span>
              {!spot.active ? (
                <span className="text-zinc-400">{INACTIVE_LABEL[spot.id] ?? 'nicht verfügbar'}</span>
              ) : spot.owner_id === userId ? (
                <span className="font-semibold text-blue-600">Dein Platz</span>
              ) : spot.owner_id ? (
                <span className="text-zinc-600">{names.get(spot.owner_id) ?? '?'}</span>
              ) : (
                <span className="text-zinc-400">noch kein Besitzer</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verifizieren** — Run: `npm test -- --run && npm run build` — Expected: beides PASS (Garage war der letzte Alt-API-Nutzer; falls `App.tsx`/`Ledger.tsx` noch Fehler werfen, gehören die zu Task 6 — hier nicht fixen, außer der Build bricht an Garage selbst).

- [ ] **Step 3: Commit**

```bash
git add src/pages/Garage.tsx public/garagenplan.png
git commit -m "feat: garage tab shows real rotated floor plan + owner list, read-only"
```

---

### Task 6: Tabs umbauen + „Meine Buchungen" (ex Ledger)

**Files:**
- Rename: `src/pages/Ledger.tsx` → `src/pages/MyBookings.tsx` (via `git mv`, dann editieren)
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `priceCents`, `fmtEur` (Task 1); DB `free_slots.hour` (Task 2); RPC `cancel_booking` (unverändert).
- Produces: `MyBookings({ userId })`; Tab-Shell `Kalender (Start) · Garage · Meine Buchungen · Anleitung · Admin`.

- [ ] **Step 1: Umbenennen** — Run: `git mv src/pages/Ledger.tsx src/pages/MyBookings.tsx`

- [ ] **Step 2: `src/pages/MyBookings.tsx` komplett ersetzen:**

```tsx
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtEur, localDate, priceCents } from '../lib/slots'

type LedgerRow = {
  id: string; debtor_id: string; creditor_id: string; amount_cents: number
  created_at: string; settled_at: string | null; settled_by: string | null
}
type MyBooking = { id: string; spot_id: number; slots: { date: string; hour: number }[] }

const fmtShort = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString('de-AT', { weekday: 'short', day: 'numeric', month: 'short' })

export default function MyBookings({ userId }: { userId: string }) {
  const [rows, setRows] = useState<LedgerRow[]>([])
  const [bookings, setBookings] = useState<MyBooking[]>([])
  const [names, setNames] = useState<Map<string, string>>(new Map())
  const [rate, setRate] = useState(300)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    const [l, p, b, st] = await Promise.all([
      supabase.from('ledger').select('*').order('created_at', { ascending: false }),
      supabase.from('profiles').select('id, name'),
      supabase.from('bookings').select('id, spot_id, free_slots(date, hour)').eq('borrower_id', userId),
      supabase.from('settings').select('day_rate_cents').single(),
    ])
    const err = l.error ?? p.error ?? b.error ?? st.error
    if (err) {
      setMsg(`Fehler beim Laden: ${err.message}`)
      return
    }
    setRows((l.data ?? []) as LedgerRow[])
    setNames(new Map((p.data ?? []).map(x => [x.id, x.name])))
    setRate(st.data?.day_rate_cents ?? 300)
    const today = localDate()
    setBookings(
      ((b.data ?? []) as { id: string; spot_id: number; free_slots: { date: string; hour: number }[] }[])
        .map(x => ({ id: x.id, spot_id: x.spot_id, slots: [...x.free_slots].sort((a, z) => a.date.localeCompare(z.date)) }))
        .filter(x => x.slots.length > 0 && x.slots[x.slots.length - 1].date >= today)
        .sort((a, z) => a.slots[0].date.localeCompare(z.slots[0].date)),
    )
  }, [userId])

  useEffect(() => { load() }, [load])

  const name = (id: string | null) => (id && names.get(id)) || '?'

  async function settle(id: string) {
    const { error } = await supabase.rpc('settle_ledger', { p_ledger_id: id })
    setMsg(error ? error.message : '')
    await load()
  }

  async function cancel(b: MyBooking) {
    if (!confirm(`Buchung für Platz ${b.spot_id} stornieren?`)) return
    const { error } = await supabase.rpc('cancel_booking', { p_booking_id: b.id })
    setMsg(error ? error.message : 'Buchung storniert.')
    await load()
  }

  const open = rows.filter(r => !r.settled_at)
  const settled = rows.filter(r => r.settled_at)

  return (
    <div className="space-y-4">
      {msg && <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{msg}</p>}

      <section className="card">
        <h2 className="mb-3 text-lg font-bold tracking-tight">Meine künftigen Buchungen</h2>
        {bookings.length === 0 && (
          <p className="text-zinc-500">Keine anstehenden Buchungen. Freie Plätze findest du im Kalender.</p>
        )}
        <div className="grid gap-2.5">
          {bookings.map(b => {
            const firstDate = b.slots[0].date
            const lastDate = b.slots[b.slots.length - 1].date
            const canCancel = firstDate > localDate()
            return (
              <div key={b.id} className="flex items-center gap-3 rounded-[13px] border border-zinc-200 p-3">
                <div className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[9px] bg-blue-500 text-sm font-extrabold text-white">
                  {b.spot_id}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold">
                    {firstDate === lastDate ? fmtShort(firstDate) : `${fmtShort(firstDate)} – ${fmtShort(lastDate)}`}
                  </div>
                  <div className="text-xs font-medium text-zinc-500">
                    Platz {b.spot_id} · {new Set(b.slots.map(s => s.date)).size} Tag(e)
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-extrabold tabular-nums">{fmtEur(priceCents(b.slots, rate))}</div>
                  {canCancel ? (
                    <button onClick={() => cancel(b)}
                      className="mt-0.5 cursor-pointer text-xs font-bold text-red-600 transition-colors hover:text-red-500">
                      Stornieren
                    </button>
                  ) : (
                    <span className="text-xs text-zinc-400">läuft / begonnen</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="card">
        <h2 className="mb-3 text-lg font-bold tracking-tight">Offene Schulden</h2>
        {open.length === 0 && <p className="text-zinc-500">Keine offenen Schulden. 🎉</p>}
        <ul className="divide-y divide-zinc-100">
          {open.map(r => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-3">
              <div className="min-w-0 flex-1">
                <p>
                  <b>{name(r.debtor_id)}</b> schuldet <b>{name(r.creditor_id)}</b>
                </p>
                <p className="text-xs text-zinc-400">
                  seit {new Date(r.created_at).toLocaleDateString('de-AT')}
                </p>
              </div>
              <span className="font-bold tabular-nums">{fmtEur(r.amount_cents)}</span>
              {(r.debtor_id === userId || r.creditor_id === userId) && (
                <button onClick={() => settle(r.id)}
                  className="btn bg-emerald-600 px-3 py-1.5 text-white hover:bg-emerald-500">
                  Schulden beglichen
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <details className="card">
        <summary className="cursor-pointer select-none text-lg font-bold tracking-tight">
          Beglichen ({settled.length})
        </summary>
        <ul className="mt-2 divide-y divide-zinc-100">
          {settled.map(r => (
            <li key={r.id} className="py-2 text-sm text-zinc-500">
              {name(r.debtor_id)} → {name(r.creditor_id)}:{' '}
              <span className="font-semibold tabular-nums text-zinc-700">{fmtEur(r.amount_cents)}</span>
              {' — '}beglichen am {new Date(r.settled_at!).toLocaleDateString('de-AT')}
              {' '}durch {name(r.settled_by)}
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}
```

- [ ] **Step 3: `src/App.tsx` anpassen** (drei Edits):

Import (Zeile 7) ersetzen:
```tsx
import MyBookings from './pages/MyBookings'
```

TABS + Default-Tab (Zeile 12 bzw. `useState<Tab>('garage')` in Zeile 92) ersetzen:
```tsx
const TABS = { kalender: 'Kalender', garage: 'Garage', buchungen: 'Meine Buchungen', anleitung: 'Anleitung', admin: 'Admin' } as const
```
```tsx
  const [tab, setTab] = useState<Tab>('kalender')
```

Tab-Rendering (Zeile 174–178): `kalender` zuerst, `ledger` → `buchungen`:
```tsx
          {tab === 'kalender' && <Calendar userId={userId} />}
          {tab === 'garage' && <Garage userId={userId} />}
          {tab === 'buchungen' && <MyBookings userId={userId} />}
          {tab === 'anleitung' && <Help />}
          {tab === 'admin' && isAdmin && <Admin userId={userId} />}
```

- [ ] **Step 4: Verifizieren** — Run: `npm test -- --run && npm run build` — Expected: beides PASS (ab hier muss der Build durchgehend grün bleiben).

- [ ] **Step 5: Commit**

```bash
git add -A src/pages src/App.tsx
git commit -m "feat: calendar as start tab, ledger becomes 'Meine Buchungen' with cancel"
```

---

### Task 7: `join`-Function + Join-Seite (Sucher / Platz-Wahl)

**Files:**
- Modify: `supabase/functions/join/index.ts` (komplett ersetzen)
- Modify: `src/pages/Join.tsx` (komplett ersetzen)

**Interfaces:**
- Consumes: `spots.active`, `profiles.seeker` (Task 2).
- Produces: `join`-Function-API: `{code, list:true}` → `{ok, spots: number[]}` (besitzerlose aktive Plätze); Registrierung akzeptiert zusätzlich `seeker: boolean`, `spot_id: number|null`, Antwort ggf. mit `warning: string`.

- [ ] **Step 1: `supabase/functions/join/index.ts` komplett ersetzen:**

```ts
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const MAX_USERS = 50

// Öffentliche Selbstregistrierung, gated durch den geheimen invites.code.
// Kein JWT nötig (verify_jwt=false) — der Code ist das einzige Tor.
// Mit { list: true } liefert sie stattdessen die besitzerlosen aktiven Plätze
// (fürs Platz-Dropdown der Join-Seite; anon darf per RLS nichts lesen).
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const body = await req.json().catch(() => ({}))
    const code = String(body.code ?? '')
    if (!code) return json({ ok: false, error: 'Ungültiger Einladungs-Link.' })

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: inv } = await admin.from('invites').select('code').single()
    if (!inv || inv.code !== code) {
      return json({ ok: false, error: 'Ungültiger oder abgelaufener Einladungs-Link.' })
    }

    if (body.list) {
      const { data: spots } = await admin.from('spots').select('id')
        .is('owner_id', null).eq('active', true).order('id')
      return json({ ok: true, spots: (spots ?? []).map((s) => s.id) })
    }

    const name = String(body.name ?? '').trim()
    const email = String(body.email ?? '').trim().toLowerCase()
    const password = String(body.password ?? '')
    const seeker = Boolean(body.seeker)
    const spotId = body.spot_id == null ? null : Number(body.spot_id)

    if (!name || !email || !password) {
      return json({ ok: false, error: 'Bitte alle Felder ausfüllen.' })
    }
    if (name.length > 100 || email.length > 254 || password.length > 128) {
      return json({ ok: false, error: 'Eingabe zu lang.' })
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return json({ ok: false, error: 'Ungültige E-Mail-Adresse.' })
    }
    if (password.length < 6) {
      return json({ ok: false, error: 'Passwort muss mindestens 6 Zeichen haben.' })
    }
    if (spotId !== null && !Number.isInteger(spotId)) {
      return json({ ok: false, error: 'Ungültiger Platz.' })
    }

    const { count } = await admin.from('profiles').select('*', { count: 'exact', head: true })
    if ((count ?? 0) >= MAX_USERS) {
      return json({ ok: false, error: 'Maximale Nutzerzahl erreicht.' })
    }

    // email_confirm: true -> sofort einsatzbereit, kein Bestätigungs-Mail nötig.
    // Der Trigger handle_new_user legt das Profil mit name aus user_metadata an.
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
    })
    if (error || !data.user) {
      const msg = /already|exist|registered/i.test(error?.message ?? '')
        ? 'Diese E-Mail ist schon registriert.'
        : (error?.message ?? 'Registrierung fehlgeschlagen.')
      return json({ ok: false, error: msg })
    }

    if (seeker) {
      await admin.from('profiles').update({ seeker: true }).eq('id', data.user.id)
    }

    let warning: string | undefined
    if (spotId !== null) {
      // bedingtes UPDATE = race-sicher; 0 Zeilen -> Platz war inzwischen weg
      const { data: claimed } = await admin.from('spots').update({ owner_id: data.user.id })
        .eq('id', spotId).is('owner_id', null).eq('active', true).select('id')
      if (!claimed?.length) {
        warning = 'Dein Wunsch-Platz wurde inzwischen vergeben — du kannst ihn später im Kalender neu wählen oder den Admin fragen.'
      }
    }
    return json({ ok: true, warning })
  } catch (err) {
    console.error('join error:', err)
    return json({ ok: false, error: 'Serverfehler. Bitte später erneut versuchen.' }, 500)
  }
})
```

- [ ] **Step 2: Deployen** — ToolSearch `select:mcp__supabase__deploy_edge_function`, dann deployen: `name: "join"`, `verify_jwt: false` beibehalten, File-Inhalt aus Step 1. Expected: success.

- [ ] **Step 3: `src/pages/Join.tsx` komplett ersetzen:**

```tsx
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Selbstregistrierung über den geheimen Einladungs-Link (?join=CODE).
// Die join-Edge-Function legt den User an (kein Bestätigungs-Mail), danach direkt Login.
export default function Join({ code }: { code: string }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [seeker, setSeeker] = useState(false)
  const [hasSpot, setHasSpot] = useState(false)
  const [spotId, setSpotId] = useState('')
  const [freeSpots, setFreeSpots] = useState<number[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    supabase.functions.invoke('join', { body: { code, list: true } })
      .then(({ data }) => setFreeSpots(data?.ok ? data.spots ?? [] : []))
      .catch(() => setFreeSpots([]))
  }, [code])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const { data, error: fnError } = await supabase.functions.invoke('join', {
        body: {
          code, name, email, password, seeker,
          spot_id: hasSpot && spotId ? Number(spotId) : null,
        },
      })
      if (fnError) throw new Error('Registrierung fehlgeschlagen. Bitte später erneut versuchen.')
      if (!data?.ok) {
        setError(data?.error ?? 'Registrierung fehlgeschlagen.')
        return
      }
      if (data.warning) alert(data.warning)
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
      if (signInError) {
        setError('Account angelegt, aber Login fehlgeschlagen. Bitte auf der Startseite einloggen.')
        return
      }
      // ?join aus der URL entfernen und sauber neu laden
      window.location.href = window.location.origin
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="card fade-in w-full max-w-xs space-y-4 p-7">
        <div className="flex items-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-zinc-900 text-xl font-extrabold text-white">P</span>
          <div>
            <h1 className="text-xl font-extrabold leading-tight tracking-tight">Registrieren</h1>
            <p className="text-sm text-zinc-500">Garagen-Verwaltung</p>
          </div>
        </div>
        <p className="text-sm text-zinc-600">Willkommen! Leg dir einen Zugang an.</p>
        <input
          type="text"
          required
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Name"
          className="input w-full"
        />
        <input
          type="email"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="E-Mail"
          className="input w-full"
        />
        <input
          type="password"
          required
          minLength={6}
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="Passwort (mind. 6 Zeichen)"
          className="input w-full"
        />
        <div className="space-y-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={seeker} onChange={e => setSeeker(e.target.checked)} />
            <span>Ich suche einen Parkplatz</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={hasSpot} onChange={e => setHasSpot(e.target.checked)} />
            <span>Ich habe einen Parkplatz</span>
          </label>
          {hasSpot && (
            freeSpots.length > 0 ? (
              <select required value={spotId} onChange={e => setSpotId(e.target.value)} className="input w-full">
                <option value="">Platz wählen…</option>
                {freeSpots.map(id => <option key={id} value={id}>Platz {id}</option>)}
              </select>
            ) : (
              <p className="text-xs text-zinc-500">
                Aktuell ist kein Platz frei wählbar — du kannst ihn später im Kalender eintragen.
              </p>
            )
          )}
        </div>
        <button disabled={busy} className="btn btn-primary w-full">
          {busy ? 'Moment…' : 'Account anlegen'}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
    </div>
  )
}
```

- [ ] **Step 4: Verifizieren** — Run: `npm test -- --run && npm run build` — Expected: PASS. Zusätzlich Function-Smoke per curl (ersetzt `<ANON_KEY>` aus `.env`/Vercel-Env, Code absichtlich falsch):

```bash
curl -s -X POST "https://dvdasdgduhfalrtcjrdb.supabase.co/functions/v1/join" \
  -H "Authorization: Bearer <ANON_KEY>" -H "Content-Type: application/json" \
  -d '{"code":"wrong","list":true}'
```
Expected: `{"ok":false,"error":"Ungültiger oder abgelaufener Einladungs-Link."}`

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/join/index.ts src/pages/Join.tsx
git commit -m "feat: join with seeker flag and self-service spot pick"
```

---

### Task 8: Admin-Seite — aktive Plätze, Sucher-Badge

**Files:**
- Modify: `src/pages/Admin.tsx`

**Interfaces:**
- Consumes: `spots.active`, `profiles.seeker` (Task 2).

- [ ] **Step 1: Edits in `src/pages/Admin.tsx`:**

Typen (Zeile 5–6) ersetzen:
```tsx
type Profile = { id: string; name: string; is_admin: boolean; seeker: boolean }
type Spot = { id: number; owner_id: string | null; active: boolean }
```

Queries (Zeile 17–18) ersetzen:
```tsx
      supabase.from('profiles').select('id, name, is_admin, seeker').order('name'),
      supabase.from('spots').select('id, owner_id, active').order('id'),
```

„Plätze zuweisen"-Liste (Zeile 84): nur aktive Plätze anbieten:
```tsx
          {spots.filter(s => s.active).map(spot => (
```

User-Liste: nach dem Admin-Badge (Zeile 125) eine Zeile ergänzen:
```tsx
                {p.seeker && <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">sucht Platz</span>}
```

- [ ] **Step 2: Verifizieren** — Run: `npm test -- --run && npm run build` — Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Admin.tsx
git commit -m "feat(admin): only active spots assignable, show seeker badge"
```

---

### Task 9: Anleitung neu schreiben

**Files:**
- Modify: `src/pages/Help.tsx` (komplett ersetzen)

- [ ] **Step 1: `src/pages/Help.tsx` komplett ersetzen:**

```tsx
// Statische Bedienungsanleitung. ponytail: reiner Text, kein Markdown-Renderer nötig.
export default function Help() {
  return (
    <div className="card space-y-6 p-6 leading-relaxed sm:p-8">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight mb-1">Anleitung</h1>
        <p className="text-zinc-500">
          So funktioniert die Garagen-Verwaltung. Bei Fragen: an die Hausverwaltung wenden.
        </p>
      </div>

      <section>
        <h2 className="text-lg font-bold tracking-tight mb-2">So funktioniert's</h2>
        <p>
          Wer einen Garagenplatz hat, gibt ihn frei, wenn er ihn nicht braucht — zum Beispiel im
          Urlaub. Alle anderen können freigegebene Plätze <b>stundengenau</b> buchen. Pro
          angefangenem Tag kostet eine Buchung die <b>Tagespauschale von 3 €</b> — egal ob du den
          Platz zwei Stunden oder den ganzen Tag nutzt. Den Überblick, wem welcher Platz gehört,
          gibt der Tab <b>Garage</b> mit dem Garagenplan.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold tracking-tight mb-2">Einen Platz buchen</h2>
        <ol className="list-decimal list-inside space-y-1">
          <li>Tab <b>Kalender</b> öffnen (Startseite) und einen Tag mit „frei" anklicken.</li>
          <li>Einen freien Platz aufklappen — dort stehen die freien Uhrzeiten.</li>
          <li>Zeitraum „von Datum + Uhrzeit bis Datum + Uhrzeit" einstellen (volle Stunden).</li>
          <li>Auf <b>Buchen</b> klicken — der Button zeigt vorher den Preis an.</li>
        </ol>
        <p className="text-zinc-500 text-sm mt-2">
          Sobald du buchst, schuldest du dem Besitzer den Betrag (er erscheint automatisch unter
          „Meine Buchungen"). Buchen zwei Leute denselben Platz am selben Tag zu verschiedenen
          Uhrzeiten, zahlt jeder die volle Tagespauschale. Deinen eigenen Platz kannst du nicht buchen.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold tracking-tight mb-2">Deinen Platz eintragen &amp; freigeben</h2>
        <p>
          Hast du einen Garagenplatz, trag ihn im Tab <b>Kalender</b> unter <b>Mein Platz</b> ein
          (einmalig, geht auch schon bei der Registrierung). Danach kannst du dort Zeiträume
          <b> freigeben</b> — dann sehen alle anderen den Platz als frei und können ihn buchen.
          Über <b>Zurückziehen</b> nimmst du noch nicht gebuchte Zeiten wieder heraus.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold tracking-tight mb-2">Eine Buchung stornieren</h2>
        <p>
          Brauchst du den Platz doch nicht? Im Tab <b>Meine Buchungen</b> bei der Buchung auf
          <b> Stornieren</b> klicken — möglich bis zum Tag vor Buchungsbeginn. Der Platz wird wieder
          frei und deine Schuld verschwindet. Danach (oder wenn die Schuld schon beglichen ist) geht
          es nicht mehr.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold tracking-tight mb-2">Schulden &amp; „beglichen"</h2>
        <p>
          Der Tab <b>Meine Buchungen</b> zeigt für alle sichtbar, wer wem was schuldet — das ist
          Absicht, damit es transparent bleibt. Wenn du eine Schuld bezahlt (oder bezahlt bekommen)
          hast, klick bei dem Posten auf <b>Schulden beglichen</b>. Sowohl der Schuldner als auch
          der Besitzer dürfen das machen. Es wird festgehalten, wer und wann geklickt hat.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold tracking-tight mb-2">Der Garagenplan</h2>
        <p>
          Im Tab <b>Garage</b> siehst du den Plan von Objekt 2 mit den Platznummern 1–23 und wem
          welcher Platz gehört. Die Plätze 5, 7 und 19 sind Fahrrad-Abstellplätze, auf Platz 9 steht
          der Traktor — diese sind nicht buchbar.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold tracking-tight mb-2">Passwort ändern</h2>
        <p>
          Oben rechts auf <b>Passwort ändern</b> klicken, neues Passwort zweimal eingeben, speichern. Passwort
          vergessen? Auf der Login-Seite auf „Passwort vergessen?" klicken — du bekommst einen Link
          per E-Mail.
        </p>
      </section>
    </div>
  )
}
```

- [ ] **Step 2: Verifizieren** — Run: `npm test -- --run && npm run build` — Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Help.tsx
git commit -m "docs: rewrite in-app manual for hourly booking flow"
```

---

### Task 10: DB-Smoke-Test aufs Stunden-Modell umstellen + ausführen

**Files:**
- Modify: `scripts/db-smoke.sql` (komplett ersetzen)

- [ ] **Step 1: `scripts/db-smoke.sql` komplett ersetzen:**

```sql
-- scripts/db-smoke.sql — läuft in einer Transaktion, rollt immer zurück.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'owner@test.local'),
  ('00000000-0000-0000-0000-000000000002', 'borrower@test.local');

update public.spots set owner_id = '00000000-0000-0000-0000-000000000001' where id = 1;
insert into public.free_slots (spot_id, date, hour) values
  (1, current_date + 1, 10),
  (1, current_date + 1, 11),
  (1, current_date + 2, 8);

-- als Borrower agieren (auth.uid() liest request.jwt.claims)
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

do $$
declare
  v_booking uuid;
  v_amount int;
  v_raised boolean := false;
begin
  -- 3 Stunden über 2 Tage buchen -> Tagespauschale: 2 × 300 = 600 Cents
  v_booking := public.book_spot(1, jsonb_build_array(
    jsonb_build_object('date', current_date + 1, 'hour', 10),
    jsonb_build_object('date', current_date + 1, 'hour', 11),
    jsonb_build_object('date', current_date + 2, 'hour', 8)));
  select amount_cents into v_amount from public.ledger where booking_id = v_booking;
  assert v_amount = 600, format('expected 600 cents, got %s', v_amount);

  -- Doppelbuchung derselben Stunde muss scheitern
  begin
    perform public.book_spot(1, jsonb_build_array(
      jsonb_build_object('date', current_date + 1, 'hour', 10)));
  exception when others then v_raised := true;
  end;
  assert v_raised, 'double booking did not raise';

  -- Storno gibt Stunden frei und löscht die Schuld
  perform public.cancel_booking(v_booking);
  assert (select count(*) from public.free_slots
          where spot_id = 1 and booking_id is not null) = 0, 'slots not freed';
  assert (select count(*) from public.ledger where booking_id = v_booking) = 0,
    'ledger entry not deleted';

  -- claim_spot: besitzerlosen aktiven Platz eintragen ...
  perform public.claim_spot(2);
  assert (select owner_id from public.spots where id = 2)
         = '00000000-0000-0000-0000-000000000002', 'claim did not set owner';

  -- ... schon vergebener Platz scheitert
  v_raised := false;
  begin
    perform public.claim_spot(1);
  exception when others then v_raised := true;
  end;
  assert v_raised, 'claiming an owned spot did not raise';

  -- ... inaktiver Platz (Fahrrad/Traktor) scheitert
  v_raised := false;
  begin
    perform public.claim_spot(5);
  exception when others then v_raised := true;
  end;
  assert v_raised, 'claiming an inactive spot did not raise';
end $$;

rollback;
```

Hinweis: Falls Platz 2 auf dem Remote-Projekt bereits einen Besitzer hat, vor dem `do`-Block zusätzlich `update public.spots set owner_id = null where id = 2;` einfügen (der Test rollt ohnehin zurück) — dann gehört diese Zeile auch ins committete File.

- [ ] **Step 2: Ausführen** — via `mcp__supabase__execute_sql` (Schema ggf. per ToolSearch laden) mit dem kompletten File-Inhalt. Expected: läuft ohne Assert-Fehler durch (Ergebnis leer/`ROLLBACK`).

- [ ] **Step 3: Commit**

```bash
git add scripts/db-smoke.sql
git commit -m "test(db): smoke test for hourly model, flat day rate and claim_spot"
```

---

### Task 11: Doku (context/, CLAUDE.md, README) + Endabnahme

**Files:**
- Modify: `context/APPLICATION.md`, `context/ARCHITECTURE.md`, `context/OPEN_QUESTIONS.md`, `CLAUDE.md`, `README.md`

- [ ] **Step 1: `context/APPLICATION.md` aktualisieren** — Halbtage → Stunden überall; Business Rules neu: Preis = distinct Tage × `day_rate_cents` (300), Ende exklusiv, volle Stunden; neue Rules: `claim_spot` (besitzerlos + aktiv, race-sicher), inaktive Plätze 5/7/9/19 (Fahrrad/Traktor, nie buchbar), `profiles.seeker` (informativ), Registrierung mit Sucher/Platz-Wahl (+ `warning`-Fall); Kern-Workflow: Buchen/Freigeben im Kalender (Startseite), Storno im Tab „Meine Buchungen"; Farb-Logik-Abschnitt ersetzen durch kurze Beschreibung der Kalender-Anzeige („n frei"-Badge, freie Stunden-Bereiche pro Platz) und des Garage-Tabs (nur Orientierung).

- [ ] **Step 2: `context/ARCHITECTURE.md` aktualisieren** — Tabellen: `free_slots` PK `(spot_id, date, hour)`, `hour 0–23`, `half` weg; `spots` ohne `grid_row`/`grid_col`, mit `active`, 23 Zeilen; `profiles.seeker`. RPCs: `book_spot` (`[{"date","hour"}]`, Tagespauschale), neu `claim_spot`. Edge Function `join`: `list`-Modus + `seeker`/`spot_id` + `warning`. Migrationstabelle: Zeile `...0006_hourly_spots.sql` ergänzen. Frontend-Abschnitt: Seitenbeschreibungen ersetzen (Calendar = Startseite mit Buchen/Freigeben/Claim, Garage = statischer Plan `public/garagenplan.png` + Besitzer-Liste, `MyBookings` statt `Ledger`, Tab-Reihenfolge, RangeForm mit Stunden + Preisanzeige).

- [ ] **Step 3: `context/OPEN_QUESTIONS.md` aktualisieren** — Limitierung „Kein echter Garagen-Grundriss" streichen (erledigt, Plan-Bild); Frage „Tagessatz 5 € ok?" streichen (entschieden: 3 € Pauschale); DB-Smoke-Abschnitt anpassen (deckt jetzt auch `claim_spot`; weiterhin offen: `settle_ledger`, RLS-Deny-Pfade); neue akzeptierte Limitierung notieren: „Storno-Fenster bleibt tagesbasiert (bis Vortag), auch bei Stundenbuchung" und „`join`-`list` gibt Platz-IDs an jeden mit gültigem Invite-Code".

- [ ] **Step 4: `CLAUDE.md` aktualisieren** — Overview: „23 Garagenplätze", „3 €/Tag Pauschale (stundengenau gebucht)", Halbtags-Sätze ersetzen; Wichtige Hinweise: Halbtags-Bullet ersetzen durch Stunden-Bullet (`hour 0–23`, Ende exklusiv, Preis = distinct Tage × Satz, `Math`-Formel-Hinweis anpassen: keine Division mehr); Project-Structure-Kommentare (RangeForm, Garage, Calendar, Ledger→MyBookings, Join) anpassen.

- [ ] **Step 5: `README.md` aktualisieren** — Zeile 3: „24 Garagenplätze … 5 €/Tag, 2,50 €/Halbtag" → „23 Garagenplätze … stundengenau, 3 €-Tagespauschale"; kurz querlesen, ob weitere Halbtags-/Ledger-Erwähnungen existieren und anpassen.

- [ ] **Step 6: Endabnahme** — Run: `npm test -- --run && npm run build` — Expected: PASS. Zusätzlich `mcp__supabase__get_advisors` (security) laufen lassen; neue kritische Findings zu `claim_spot`/`book_spot` beheben oder in OPEN_QUESTIONS notieren.

- [ ] **Step 7: Commit**

```bash
git add context/ CLAUDE.md README.md
git commit -m "docs: update context, CLAUDE.md and README for hourly model"
```
