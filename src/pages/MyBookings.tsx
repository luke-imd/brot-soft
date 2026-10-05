import { useCallback, useEffect, useState } from 'react'
import { api, attempt } from '../lib/api'
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
    const [data, err] = await attempt(Promise.all([
      api.get<LedgerRow[]>('/ledger'),
      api.get<{ id: string; name: string }[]>('/profiles'),
      api.get<MyBooking[]>('/my-bookings'),
      api.get<{ day_rate_cents: number }>('/settings'),
    ]))
    if (err !== null) {
      setMsg(`Fehler beim Laden: ${err}`)
      return
    }
    const [l, p, b, st] = data
    setRows(l)
    setNames(new Map(p.map(x => [x.id, x.name])))
    setRate(st.day_rate_cents)
    const today = localDate()
    setBookings(
      b.map(x => ({ ...x, slots: [...x.slots].sort((a, z) => a.date.localeCompare(z.date)) }))
        .filter(x => x.slots.length > 0 && x.slots[x.slots.length - 1].date >= today)
        .sort((a, z) => a.slots[0].date.localeCompare(z.slots[0].date)),
    )
  }, [])

  useEffect(() => { load() }, [load])

  const name = (id: string | null) => (id && names.get(id)) || '?'

  async function settle(id: string) {
    const [, error] = await attempt(api.post(`/ledger/${id}/settle`))
    setMsg(error ?? '')
    await load()
  }

  async function cancel(b: MyBooking) {
    if (!confirm(`Buchung für Platz ${b.spot_id} stornieren?`)) return
    const [, error] = await attempt(api.post(`/bookings/${b.id}/cancel`))
    setMsg(error ?? 'Buchung storniert.')
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
