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
  const [loadError, setLoadError] = useState('')

  const first = `${year}-${pad(month + 1)}-01`
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const last = `${year}-${pad(month + 1)}-${pad(daysInMonth)}`

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('free_slots').select('*')
      .gte('date', first).lte('date', last).is('booking_id', null)
    if (error) {
      setLoadError(`Fehler beim Laden: ${error.message}`)
      return
    }
    setLoadError('')
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
      {loadError && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</p>}
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
          <h3 className="font-bold tracking-tight">{selectedDay}</h3>
          {daySpots.size === 0 && <p className="text-zinc-500">Keine freien Plätze.</p>}
          {[...daySpots.entries()].sort(([a], [b]) => a - b).map(([spotId, halves]) => (
            <details key={spotId} className="rounded-xl border border-zinc-200 p-3 transition-colors open:bg-zinc-50">
              <summary className="cursor-pointer select-none text-sm font-medium">
                Platz {spotId} — frei: {halves.sort().map(h => h === 'am' ? 'Vormittag' : 'Nachmittag').join(' + ')}
              </summary>
              <div className="pt-3">
                <RangeForm key={`cal-${spotId}-${selectedDay}`} label="Buchen" initialDate={selectedDay}
                  onSubmit={slots => book(spotId, slots)} />
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  )
}
