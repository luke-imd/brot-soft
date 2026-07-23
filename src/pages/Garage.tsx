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
