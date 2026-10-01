import { useCallback, useEffect, useState } from 'react'
import { api, attempt } from '../lib/api'
import { fmtEur } from '../lib/slots'

type Profile = { id: string; name: string; is_admin: boolean; seeker: boolean }
type Spot = { id: number; owner_id: string | null; active: boolean }

export default function Admin({ userId }: { userId: string }) {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [spots, setSpots] = useState<Spot[]>([])
  const [rate, setRate] = useState('')
  const [code, setCode] = useState('')
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    const [data, err] = await attempt(Promise.all([
      api.get<Profile[]>('/profiles'),
      api.get<Spot[]>('/spots'),
      api.get<{ day_rate_cents: number }>('/settings'),
      api.get<{ code: string }>('/admin/invite'),
    ]))
    if (err !== null) { setMsg(`Fehler beim Laden: ${err}`); return }
    const [p, s, st, inv] = data
    setProfiles(p)
    setSpots(s)
    setRate(String(st.day_rate_cents / 100))
    setCode(inv.code)
  }, [])

  useEffect(() => { load() }, [load])

  const name = (id: string | null) => (id && profiles.find(p => p.id === id)?.name) || '—'
  const inviteLink = code ? `${window.location.origin}/?join=${code}` : ''

  async function assignSpot(spotId: number, ownerId: string | null) {
    const [, error] = await attempt(api.put(`/admin/spots/${spotId}`, { owner_id: ownerId }))
    setMsg(error ?? `Platz ${spotId}: Besitzer = ${name(ownerId)}`)
    await load()
  }

  async function toggleAdmin(p: Profile) {
    const [, error] = await attempt(api.put(`/admin/profiles/${p.id}`, { is_admin: !p.is_admin }))
    setMsg(error ?? `${p.name}: Admin = ${!p.is_admin ? 'ja' : 'nein'}`)
    await load()
  }

  async function removeUser(p: Profile) {
    if (!confirm(`${p.name} wirklich löschen? Das kann nicht rückgängig gemacht werden.`)) return
    const [, error] = await attempt(api.del(`/admin/profiles/${p.id}`))
    if (error) { setMsg(error); return }
    setMsg(`${p.name} gelöscht.`)
    await load()
  }

  async function saveRate() {
    const cents = Math.round(parseFloat(rate.replace(',', '.')) * 100)
    if (!Number.isFinite(cents) || cents < 0) { setMsg('Ungültiger Tagessatz.'); return }
    const [, error] = await attempt(api.put('/admin/settings', { day_rate_cents: cents }))
    setMsg(error ?? `Tagessatz gespeichert: ${fmtEur(cents)}`)
  }

  async function newCode() {
    if (!confirm('Neuen Einladungs-Link erzeugen? Der alte Link funktioniert dann nicht mehr.')) return
    const [, error] = await attempt(api.post('/admin/invite'))
    setMsg(error ?? 'Neuer Einladungs-Link erzeugt.')
    await load()
  }

  async function zahltag() {
    if (!confirm('Zahltag-E-Mail an alle User schicken?')) return
    const [data, error] = await attempt(api.post<{ sent: number }>('/admin/zahltag'))
    setMsg(error !== null ? `Fehler: ${error}` : `Verschickt an ${data.sent} Empfänger.`)
  }

  return (
    <div className="space-y-4">
      {msg && <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{msg}</p>}

      <section className="card">
        <h2 className="mb-3 text-lg font-bold tracking-tight">Plätze zuweisen</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {spots.filter(s => s.active).map(spot => (
            <div key={spot.id} className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-sm font-medium">Platz {spot.id}</span>
              <select
                value={spot.owner_id ?? ''}
                onChange={e => assignSpot(spot.id, e.target.value || null)}
                className="input flex-1"
              >
                <option value="">— kein Besitzer —</option>
                {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          ))}
        </div>
      </section>

      <section className="card space-y-3">
        <h2 className="text-lg font-bold tracking-tight">Einladungs-Link</h2>
        <p className="text-sm text-zinc-500">
          Diesen Link an neue Mitbewohner schicken — damit können sie sich selbst registrieren.
          Nur wer den Link hat, kommt rein.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input readOnly value={inviteLink} className="input min-w-0 flex-1 bg-zinc-50" />
          <button
            onClick={() => { navigator.clipboard?.writeText(inviteLink); setMsg('Link kopiert.') }}
            className="btn btn-primary"
          >
            Kopieren
          </button>
          <button onClick={newCode} className="btn btn-outline">Neuen Link erzeugen</button>
        </div>
      </section>

      <section className="card">
        <h2 className="mb-3 text-lg font-bold tracking-tight">User verwalten</h2>
        <ul className="divide-y divide-zinc-100">
          {profiles.map(p => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 py-2.5">
              <span className="flex-1 font-medium">
                {p.name}
                {p.is_admin && <span className="ml-2 rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-semibold">Admin</span>}
                {p.seeker && <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">sucht Platz</span>}
                {p.id === userId && <span className="ml-2 text-xs text-zinc-400">(du)</span>}
              </span>
              {p.id !== userId && (
                <>
                  <button onClick={() => toggleAdmin(p)} className="btn btn-outline px-2.5 py-1 text-xs">
                    {p.is_admin ? 'Admin entziehen' : 'Zum Admin machen'}
                  </button>
                  <button onClick={() => removeUser(p)}
                    className="btn border border-red-200 bg-white px-2.5 py-1 text-xs text-red-600 hover:bg-red-50">
                    Löschen
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="card space-y-3">
        <h2 className="text-lg font-bold tracking-tight">Tagessatz &amp; Zahltag</h2>
        <div className="flex items-center gap-2">
          <label htmlFor="rate" className="text-sm font-medium">Tagessatz (€):</label>
          <input id="rate" value={rate} onChange={e => setRate(e.target.value)} className="input w-24" />
          <button onClick={saveRate} className="btn btn-primary">Speichern</button>
        </div>
        <button onClick={zahltag} className="btn btn-danger">
          📧 Zahltag-E-Mail an alle schicken
        </button>
      </section>
    </div>
  )
}
