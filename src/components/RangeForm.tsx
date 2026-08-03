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
