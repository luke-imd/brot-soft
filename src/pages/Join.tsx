import { useEffect, useState } from 'react'
import { api } from '../lib/api'

// Selbstregistrierung über den geheimen Einladungs-Link (?join=CODE).
// Der Server legt den User an (kein Bestätigungs-Mail) und loggt direkt ein.
export default function Join({ code }: { code: string }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [hasSpot, setHasSpot] = useState(false)
  const [spotId, setSpotId] = useState('')
  const [freeSpots, setFreeSpots] = useState<number[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.post<{ spots: number[] }>('/join', { code, list: true })
      .then(data => setFreeSpots(data.spots ?? []))
      .catch(() => setFreeSpots([]))
  }, [code])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      // Der Server legt den Account an und loggt direkt ein (Session-Cookie).
      const data = await api.post<{ ok: true; warning?: string }>('/join', {
        code, name, email, password,
        spot_id: hasSpot && spotId ? Number(spotId) : null,
      })
      if (data.warning) alert(data.warning)
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
        {freeSpots.length > 0 && (
          <div className="space-y-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={hasSpot} onChange={e => setHasSpot(e.target.checked)} />
              <span>Ich habe einen Parkplatz</span>
            </label>
            {hasSpot && (
              <select required value={spotId} onChange={e => setSpotId(e.target.value)} className="input w-full">
                <option value="">Platz wählen…</option>
                {freeSpots.map(id => <option key={id} value={id}>Platz {id}</option>)}
              </select>
            )}
          </div>
        )}
        <button disabled={busy} className="btn btn-primary w-full">
          {busy ? 'Moment…' : 'Account anlegen'}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
    </div>
  )
}
