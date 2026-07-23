import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtEur, localDate, priceCents, type Half, type Slot } from '../lib/slots'
import RangeForm from '../components/RangeForm'

type SpotRow = { id: number; owner_id: string | null; grid_row: number; grid_col: number }
type FreeRow = { spot_id: number; date: string; half: Half; booking_id: string | null }
type BookingRow = { id: string; spot_id: number; borrower_id: string }
type MyBooking = { id: string; spot_id: number; slots: { date: string; half: Half }[] }
type Status = 'free' | 'mine' | 'booked' | 'occupied' | 'unowned'

const HALF_LABEL: Record<Half, string> = { am: 'Vormittag', pm: 'Nachmittag' }

const fmtShort = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString('de-AT', { weekday: 'short', day: 'numeric', month: 'short' })

function shiftDay(d: string, n: number) {
  const dt = new Date(`${d}T00:00:00Z`)
  dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
}

const TILE: Record<Status, string> = {
  free: 'bg-emerald-500 text-white border border-white/15',
  mine: 'bg-blue-500 text-white border border-white/15',
  booked: 'bg-orange-400 text-white border border-white/15',
  occupied: 'bg-zinc-700 text-zinc-400 border border-white/15',
  unowned: 'bg-white/5 text-zinc-500 border-[1.5px] border-dashed border-white/25',
}

const STATUS_BADGE: Record<Status, [string, string]> = {
  free: ['Frei · buchbar', 'bg-emerald-500 text-white'],
  mine: ['Meine Buchung', 'bg-blue-500 text-white'],
  booked: ['Gebucht', 'bg-orange-400 text-white'],
  occupied: ['Belegt', 'bg-zinc-200 text-zinc-600'],
  unowned: ['Ohne Besitzer', 'bg-zinc-200 text-zinc-600'],
}

const LEGEND: [string, string][] = [
  ['bg-zinc-500', 'Belegt'],
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
  const [myBookings, setMyBookings] = useState<MyBooking[]>([])
  const [names, setNames] = useState<Map<string, string>>(new Map())
  const [rate, setRate] = useState(500)
  const [selected, setSelected] = useState<number | null>(null)
  const [loadError, setLoadError] = useState('')
  const [toast, setToast] = useState('')
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  function showToast(msg: string) {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 2600)
  }
  useEffect(() => () => clearTimeout(toastTimer.current), [])

  const load = useCallback(async () => {
    const [s, f, p, st, mb] = await Promise.all([
      supabase.from('spots').select('*').order('id'),
      supabase.from('free_slots').select('*').eq('date', date).eq('half', half),
      supabase.from('profiles').select('id, name'),
      supabase.from('settings').select('day_rate_cents').single(),
      supabase.from('bookings').select('id, spot_id, free_slots(date, half)').eq('borrower_id', userId),
    ])
    const err = s.error ?? f.error ?? p.error ?? st.error ?? mb.error
    if (err) {
      setLoadError(`Fehler beim Laden: ${err.message}`)
      return
    }
    setLoadError('')
    setSpots(s.data ?? [])
    setFree((f.data ?? []) as FreeRow[])
    setNames(new Map((p.data ?? []).map(x => [x.id, x.name])))
    setRate(st.data?.day_rate_cents ?? 500)
    const today = localDate()
    setMyBookings(
      ((mb.data ?? []) as { id: string; spot_id: number; free_slots: { date: string; half: Half }[] }[])
        .map(b => ({ id: b.id, spot_id: b.spot_id, slots: [...b.free_slots].sort((a, z) => a.date.localeCompare(z.date)) }))
        .filter(b => b.slots.length > 0 && b.slots[b.slots.length - 1].date >= today)
        .sort((a, z) => a.slots[0].date.localeCompare(z.slots[0].date)),
    )
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
  }, [date, half, userId])

  useEffect(() => { load() }, [load])

  function status(spot: SpotRow): Status {
    const slot = free.find(f => f.spot_id === spot.id)
    if (!slot) return spot.owner_id ? 'occupied' : 'unowned'
    if (!slot.booking_id) return 'free'
    const b = bookings.get(slot.booking_id)
    return b?.borrower_id === userId ? 'mine' : 'booked'
  }

  function initials(ownerId: string | null) {
    if (!ownerId) return '—'
    if (ownerId === userId) return 'ICH'
    const name = names.get(ownerId)
    if (!name) return '?'
    const words = name.trim().split(/\s+/)
    return (words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase()
  }

  async function book(spotId: number, slots: Slot[]) {
    const { error } = await supabase.rpc('book_spot', { p_spot_id: spotId, p_slots: slots })
    if (error) throw new Error(error.message)
    setSelected(null)
    showToast(`Platz ${spotId} gebucht ✓`)
    await load()
  }

  async function freeUp(spotId: number, slots: Slot[]) {
    const { error } = await supabase.from('free_slots').upsert(
      slots.map(s => ({ spot_id: spotId, date: s.date, half: s.half })),
      { onConflict: 'spot_id,date,half', ignoreDuplicates: true },
    )
    if (error) throw new Error(error.message)
    setSelected(null)
    showToast(`Platz ${spotId} freigegeben ✓`)
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
    showToast('Freigabe zurückgezogen')
    await load()
  }

  async function cancelBooking(bookingId: string, spotId: number) {
    if (!confirm(`Buchung für Platz ${spotId} stornieren? Das storniert die gesamte Buchung (alle Halbtage).`)) return
    const { error } = await supabase.rpc('cancel_booking', { p_booking_id: bookingId })
    if (error) { showToast(error.message); return }
    setSelected(null)
    showToast('Buchung storniert')
    await load()
  }

  const sel = spots.find(s => s.id === selected)
  const selStatus = sel ? status(sel) : null
  const selSlot = sel ? free.find(f => f.spot_id === sel.id) : undefined
  const selIsOwn = sel?.owner_id === userId
  const freeCount = spots.filter(s => status(s) === 'free').length
  const halfLabel = HALF_LABEL[half]
  const dateSubtitle = new Date(`${date}T00:00:00`)
    .toLocaleDateString('de-AT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + ' · ' + halfLabel

  const eyebrow = 'mb-2 text-[11px] font-extrabold uppercase tracking-wide text-zinc-500'
  const navBtn = 'grid h-[38px] w-[38px] cursor-pointer place-items-center rounded-[10px] border border-zinc-300 bg-white text-lg text-zinc-700 transition-colors hover:border-zinc-400 hover:bg-zinc-50'
  const seg = 'rounded-lg px-4 py-1.5 text-sm font-bold transition-all'

  return (
    <div className="space-y-5">
      {loadError && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</p>}

      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div>
          <h1 className="text-[27px] font-extrabold leading-tight tracking-tight">Garagenplätze</h1>
          <p className="mt-1 text-sm font-medium text-zinc-500">{dateSubtitle}</p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1.5 text-[13px] font-bold text-emerald-700">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />{freeCount} frei
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1.5 text-[13px] font-bold text-blue-600">
            <span className="h-2 w-2 rounded-full bg-blue-500" />{myBookings.length} meine Buchungen
          </span>
        </div>
      </div>

      <div className="card flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5">
        <div className="flex items-center gap-1.5">
          <button onClick={() => setDate(d => shiftDay(d, -1))} aria-label="Voriger Tag" className={navBtn}>‹</button>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="input font-semibold tabular-nums" />
          <button onClick={() => setDate(d => shiftDay(d, 1))} aria-label="Nächster Tag" className={navBtn}>›</button>
          <button onClick={() => setDate(localDate())}
            className="ml-0.5 cursor-pointer rounded-[10px] border border-zinc-300 bg-white px-3 py-2 text-[13px] font-bold text-zinc-700 transition-colors hover:border-zinc-400 hover:bg-zinc-50">
            Heute
          </button>
        </div>

        <div className="inline-flex rounded-[11px] border border-zinc-200 bg-zinc-100 p-[3px]">
          <button onClick={() => setHalf('am')}
            className={`${seg} ${half === 'am' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'}`}>Vormittag</button>
          <button onClick={() => setHalf('pm')}
            className={`${seg} ${half === 'pm' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'}`}>Nachmittag</button>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
          {LEGEND.map(([color, label]) => (
            <span key={label} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-zinc-600">
              <span className={`h-[11px] w-[11px] rounded-[4px] ${color}`} />{label}
            </span>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-5">

        {/* ponytail: layout aus spots-tabelle (2x12), echter grundriss kommt später */}
        <section className="min-w-0 flex-[3_1_460px]">
          <div className="relative overflow-hidden rounded-[26px] bg-gradient-to-b from-zinc-800 to-zinc-900 px-5 pb-4 pt-5 shadow-[inset_0_2px_22px_rgba(0,0,0,0.45)]">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-zinc-400">Ebene 0 · Grundriss</span>
              <span className="text-xs font-semibold text-zinc-500">{fmtShort(date)} · {halfLabel}</span>
            </div>
            <div className="relative mt-4 grid grid-cols-12 gap-x-1.5 gap-y-[52px]">
              {/* Fahrbahn-Mittellinie zwischen den zwei Parkreihen */}
              <div aria-hidden className="absolute inset-x-1 top-1/2 -translate-y-1/2 border-t-2 border-dashed border-white/15" />
              {spots.map(spot => {
                const st = status(spot)
                return (
                  <button key={spot.id} onClick={() => setSelected(spot.id)} title={`Platz ${spot.id}`}
                    style={{ gridRow: spot.grid_row, gridColumn: spot.grid_col }}
                    className={`relative flex aspect-[2/2.5] min-h-[52px] cursor-pointer flex-col items-center justify-center gap-0.5 rounded-[10px]
                      transition-all duration-150 hover:-translate-y-px hover:brightness-110 active:scale-95
                      ${TILE[st]}
                      ${selected === spot.id ? 'ring-[3px] ring-yellow-300 ring-offset-2 ring-offset-zinc-800' : ''}`}>
                    <span className="text-base font-extrabold leading-none">{spot.id}</span>
                    <span className="text-[8.5px] font-extrabold tracking-wider opacity-80">{initials(spot.owner_id)}</span>
                  </button>
                )
              })}
            </div>
            <div className="mt-3 text-center text-[10.5px] font-bold uppercase tracking-[0.35em] text-zinc-500">↑ Einfahrt</div>
          </div>
        </section>

        <aside className="flex min-w-0 flex-[1_1_320px] flex-col gap-4 self-start lg:sticky lg:top-[78px]">

          {sel && selStatus ? (
            <div className="card fade-in space-y-3.5">
              <div className="flex items-center gap-3">
                <div className={`grid h-[42px] w-[42px] shrink-0 place-items-center rounded-[11px] text-lg font-extrabold text-white
                  ${selIsOwn ? 'bg-zinc-900' : selStatus === 'unowned' ? 'border-[1.5px] border-dashed border-zinc-300 bg-zinc-400' : TILE[selStatus].split(' ')[0]}`}>
                  {sel.id}
                </div>
                <div className="min-w-0">
                  <div className="text-[17px] font-extrabold tracking-tight">Platz {sel.id}</div>
                  <div className="text-[13px] font-medium text-zinc-500">
                    {selIsOwn ? 'Dein Parkplatz' : sel.owner_id ? `Besitzer · ${names.get(sel.owner_id) ?? '?'}` : 'Noch kein Besitzer'}
                  </div>
                </div>
                <button onClick={() => setSelected(null)} aria-label="Schließen"
                  className="ml-auto grid h-[30px] w-[30px] shrink-0 cursor-pointer place-items-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700">✕</button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-extrabold ${selIsOwn ? 'bg-zinc-900 text-white' : STATUS_BADGE[selStatus][1]}`}>
                  {selIsOwn ? 'Dein Parkplatz' : STATUS_BADGE[selStatus][0]}
                </span>
                <span className="text-[12.5px] font-medium text-zinc-400">{fmtShort(date)} · {halfLabel}</span>
              </div>

              {selIsOwn ? (
                <div className="grid gap-4">
                  <div>
                    <h3 className={eyebrow}>Zeitraum freigeben</h3>
                    <RangeForm key={`free-${sel.id}-${date}-${half}`} label="Freigeben" initialDate={date}
                      onSubmit={slots => freeUp(sel.id, slots)} />
                  </div>
                  <div className="border-t border-zinc-200 pt-3.5">
                    <h3 className={eyebrow}>Freigabe zurückziehen</h3>
                    <RangeForm key={`retract-${sel.id}-${date}-${half}`} label="Zurückziehen" initialDate={date}
                      onSubmit={slots => retract(sel.id, slots)} />
                  </div>
                </div>
              ) : selStatus === 'free' ? (
                <div>
                  <div className="mb-2 flex items-baseline justify-between gap-2">
                    <h3 className={`${eyebrow} mb-0`}>Platz buchen</h3>
                    <span className="text-[13px] font-bold tabular-nums text-zinc-700">{fmtEur(priceCents(1, rate))} / Halbtag</span>
                  </div>
                  <RangeForm key={`book-${sel.id}-${date}-${half}`} label="Buchen" initialDate={date}
                    onSubmit={slots => book(sel.id, slots)} />
                </div>
              ) : selStatus === 'mine' ? (
                <div className="grid gap-2.5">
                  <p className="text-sm leading-relaxed text-zinc-600">
                    Du hast diesen Halbtag gebucht. Stornieren ist bis zum Vortag des Buchungsbeginns möglich.
                  </p>
                  <button onClick={() => selSlot?.booking_id && cancelBooking(selSlot.booking_id, sel.id)}
                    className="btn btn-danger w-full">
                    Buchung stornieren
                  </button>
                </div>
              ) : (
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-3">
                  <p className="text-sm leading-relaxed text-zinc-600">
                    {selStatus === 'booked'
                      ? 'Dieser Halbtag ist bereits vergeben. Wähle einen anderen Tag oder Halbtag.'
                      : selStatus === 'occupied'
                        ? `${names.get(sel.owner_id!) ?? 'Der Besitzer'} nutzt den Platz an diesem Halbtag selbst.`
                        : 'Diesem Platz ist noch kein Besitzer zugeordnet – er ist nicht buchbar.'}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="card px-5 py-6 text-center">
              <div className="mx-auto mb-3 grid h-[46px] w-[46px] place-items-center rounded-[13px] border border-zinc-200 bg-zinc-100 text-[22px]">🅿️</div>
              <p className="text-[15px] font-bold">Platz auswählen</p>
              <p className="mt-1 text-[13px] leading-relaxed text-zinc-500">
                Tippe im Grundriss auf einen Platz, um zu buchen oder deinen Platz freizugeben.
              </p>
            </div>
          )}

          <div className="card">
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <h2 className="text-[15px] font-extrabold tracking-tight">Meine Buchungen</h2>
              <span className="text-xs font-bold text-zinc-400">{myBookings.length}</span>
            </div>
            {myBookings.length === 0 ? (
              <p className="text-[13px] leading-relaxed text-zinc-400">
                Noch keine Buchungen. Wähle einen freien (grünen) Platz aus.
              </p>
            ) : (
              <div className="grid gap-2.5">
                {myBookings.map(b => {
                  const first = b.slots[0].date
                  const last = b.slots[b.slots.length - 1].date
                  const canCancel = first > localDate()
                  return (
                    <div key={b.id} className="flex items-center gap-3 rounded-[13px] border border-zinc-200 p-3">
                      <div className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[9px] bg-blue-500 text-sm font-extrabold text-white">
                        {b.spot_id}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-bold">{first === last ? fmtShort(first) : `${fmtShort(first)} – ${fmtShort(last)}`}</div>
                        <div className="text-xs font-medium text-zinc-500">Platz {b.spot_id} · {b.slots.length} Halbtage</div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-sm font-extrabold tabular-nums">{fmtEur(priceCents(b.slots.length, rate))}</div>
                        {canCancel && (
                          <button onClick={() => cancelBooking(b.id, b.spot_id)}
                            className="mt-0.5 cursor-pointer text-xs font-bold text-red-600 transition-colors hover:text-red-500">
                            Stornieren
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

        </aside>
      </div>

      {toast && (
        <div className="fade-in fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-zinc-900 px-4.5 py-2.5 text-sm font-semibold text-white shadow-xl">
          {toast}
        </div>
      )}
    </div>
  )
}
