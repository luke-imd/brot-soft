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
      {loadError && <p className="bg-red-50 border border-red-300 rounded p-2 text-sm">{loadError}</p>}
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
