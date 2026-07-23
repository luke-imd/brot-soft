import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtEur, localDate, priceCents, type Half, type Slot } from '../lib/slots'
import RangeForm from '../components/RangeForm'

type SpotRow = { id: number; owner_id: string | null; grid_row: number; grid_col: number }
type FreeRow = { spot_id: number; date: string; half: Half; booking_id: string | null }
type BookingRow = { id: string; spot_id: number; borrower_id: string }

const HALF_LABEL: Record<Half, string> = { am: 'Vormittag', pm: 'Nachmittag' }

const LEGEND: [string, string][] = [
  ['bg-zinc-400', 'Besitzer'],
  ['bg-emerald-500', 'Frei'],
  ['bg-blue-500', 'Meine Buchung'],
  ['bg-orange-400', 'Gebucht'],
]

export default function Garage({ userId }: { userId: string }) {
  const [date, setDate] = useState(localDate())
  const [half, setHalf] = useState<Half>(new Date().getHours() < 12 ? 'am' : 'pm')
  const [spots, setSpots] = useState<SpotRow[]>([])
  const [free, setFree] = useState<FreeRow[]>([])
  const [bookings, setBookings] = useState<Map<string, BookingRow>>(new Map())
  const [names, setNames] = useState<Map<string, string>>(new Map())
  const [rate, setRate] = useState(500)
  const [selected, setSelected] = useState<number | null>(null)
  const [cancelError, setCancelError] = useState('')
  const [loadError, setLoadError] = useState('')

  const load = useCallback(async () => {
    const [s, f, p, st] = await Promise.all([
      supabase.from('spots').select('*').order('id'),
      supabase.from('free_slots').select('*').eq('date', date).eq('half', half),
      supabase.from('profiles').select('id, name'),
      supabase.from('settings').select('day_rate_cents').single(),
    ])
    const err = s.error ?? f.error ?? p.error ?? st.error
    if (err) {
      setLoadError(`Fehler beim Laden: ${err.message}`)
      return
    }
    setLoadError('')
    setSpots(s.data ?? [])
    setFree((f.data ?? []) as FreeRow[])
    setNames(new Map((p.data ?? []).map(x => [x.id, x.name])))
    setRate(st.data?.day_rate_cents ?? 500)
    const ids = (f.data ?? []).map(x => x.booking_id).filter((x): x is string => !!x)
    if (ids.length) {
      const b = await supabase.from('bookings').select('id, spot_id, borrower_id').in('id', ids)
      if (b.error) {
        setLoadError(`Fehler beim Laden: ${b.error.message}`)
        return
      }
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
    occupied: 'bg-zinc-700/70 text-zinc-500',
    free: 'bg-emerald-500 text-white',
    mine: 'bg-blue-500 text-white',
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

  async function cancelMine() {
    if (!myBooking) return
    if (!confirm('Storniert die gesamte Buchung (alle Halbtage). Fortfahren?')) return
    const { error } = await supabase.rpc('cancel_booking', { p_booking_id: myBooking.id })
    if (error) { setCancelError(error.message); return }
    setCancelError('')
    setSelected(null)
    await load()
  }

  const sel = spots.find(s => s.id === selected)
  const selSlot = sel ? free.find(f => f.spot_id === sel.id) : undefined
  const selBooking = selSlot?.booking_id ? bookings.get(selSlot.booking_id) : undefined
  const myBooking = selBooking?.borrower_id === userId ? selBooking : undefined

  return (
    <div className="space-y-4">
      {loadError && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          className="input" />
        <select value={half} onChange={e => setHalf(e.target.value as Half)}
          className="input">
          <option value="am">Vormittag</option>
          <option value="pm">Nachmittag</option>
        </select>
        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-600">
          {LEGEND.map(([color, label]) => (
            <span key={label} className="flex items-center gap-1.5">
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} />{label}
            </span>
          ))}
        </div>
      </div>

      {/* ponytail: layout aus spots-tabelle (2x12), echter grundriss kommt später */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-b from-zinc-800 to-zinc-900 p-4 shadow-inner sm:p-6">
        {/* Fahrbahn-Mittellinie zwischen den zwei Parkreihen */}
        <div aria-hidden className="absolute inset-x-8 top-1/2 border-t-2 border-dashed border-white/20" />
        <div className="relative grid grid-cols-12 gap-x-1.5 gap-y-14">
          {spots.map(spot => (
            <button key={spot.id} onClick={() => { setSelected(spot.id); setCancelError('') }}
              style={{ gridRow: spot.grid_row, gridColumn: spot.grid_col }}
              className={`aspect-[2/3] rounded-md border border-white/15 text-sm font-bold
                transition-all duration-150 hover:brightness-110 active:scale-95
                ${COLORS[status(spot)]}
                ${selected === spot.id ? 'ring-2 ring-yellow-300 ring-offset-2 ring-offset-zinc-800' : ''}`}>
              {spot.id}
            </button>
          ))}
        </div>
      </div>

      {sel && (
        <div className="card fade-in space-y-4">
          <div className="flex items-baseline gap-2">
            <h2 className="text-lg font-bold tracking-tight">Platz {sel.id}</h2>
            <span className="text-sm text-zinc-500">
              {sel.owner_id ? `Besitzer: ${names.get(sel.owner_id) ?? '?'}` : 'kein Besitzer'}
              {' · '}{date} {HALF_LABEL[half]}
            </span>
            <button onClick={() => setSelected(null)} aria-label="Schließen"
              className="ml-auto grid h-7 w-7 shrink-0 place-items-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700">
              ✕
            </button>
          </div>

          {sel.owner_id === userId ? (
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Freigeben</h3>
                <RangeForm key={`free-${sel.id}-${date}-${half}`} label="Freigeben" initialDate={date}
                  onSubmit={slots => freeUp(sel.id, slots)} />
              </div>
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Freigabe zurückziehen</h3>
                <RangeForm key={`retract-${sel.id}-${date}-${half}`} label="Zurückziehen" initialDate={date}
                  onSubmit={slots => retract(sel.id, slots)} />
              </div>
            </div>
          ) : (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Buchen ({fmtEur(priceCents(1, rate))} pro Halbtag)
              </h3>
              <RangeForm key={`book-${sel.id}-${date}-${half}`} label="Buchen" initialDate={date}
                onSubmit={slots => book(sel.id, slots)} />
            </div>
          )}

          {myBooking && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Meine Buchung ({date})</h3>
              <button onClick={cancelMine} className="btn btn-danger">
                Buchung stornieren
              </button>
              {cancelError && <p className="mt-2 text-sm text-red-600">{cancelError}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
