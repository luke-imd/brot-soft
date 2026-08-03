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
