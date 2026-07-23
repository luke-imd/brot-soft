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
