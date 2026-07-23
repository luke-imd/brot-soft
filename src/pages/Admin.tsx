import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtEur } from '../lib/slots'

type Profile = { id: string; name: string; is_admin: boolean }
type Spot = { id: number; owner_id: string | null }

export default function Admin({ userId }: { userId: string }) {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [spots, setSpots] = useState<Spot[]>([])
  const [rate, setRate] = useState('')
  const [code, setCode] = useState('')
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    const [p, s, st, inv] = await Promise.all([
      supabase.from('profiles').select('id, name, is_admin').order('name'),
      supabase.from('spots').select('id, owner_id').order('id'),
      supabase.from('settings').select('day_rate_cents').single(),
      supabase.from('invites').select('code').single(),
    ])
    const err = p.error ?? s.error ?? st.error ?? inv.error
    if (err) { setMsg(`Fehler beim Laden: ${err.message}`); return }
    setProfiles(p.data ?? [])
    setSpots(s.data ?? [])
    setRate(String((st.data?.day_rate_cents ?? 500) / 100))
    setCode(inv.data?.code ?? '')
  }, [])

  useEffect(() => { load() }, [load])

  const name = (id: string | null) => (id && profiles.find(p => p.id === id)?.name) || '—'
  const inviteLink = code ? `${window.location.origin}/?join=${code}` : ''

  async function assignSpot(spotId: number, ownerId: string | null) {
    const { error } = await supabase.from('spots').update({ owner_id: ownerId }).eq('id', spotId)
    setMsg(error ? error.message : `Platz ${spotId}: Besitzer = ${name(ownerId)}`)
    await load()
  }

  async function toggleAdmin(p: Profile) {
    const { error } = await supabase.from('profiles').update({ is_admin: !p.is_admin }).eq('id', p.id)
    setMsg(error ? error.message : `${p.name}: Admin = ${!p.is_admin ? 'ja' : 'nein'}`)
    await load()
  }

  async function removeUser(p: Profile) {
    if (!confirm(`${p.name} wirklich löschen? Das kann nicht rückgängig gemacht werden.`)) return
    const { data, error } = await supabase.functions.invoke('delete-user', { body: { userId: p.id } })
    if (error) { setMsg('Löschen fehlgeschlagen.'); return }
    if (!data?.ok) { setMsg(data?.error ?? 'Löschen fehlgeschlagen.'); return }
    setMsg(`${p.name} gelöscht.`)
    await load()
  }

  async function saveRate() {
    const cents = Math.round(parseFloat(rate.replace(',', '.')) * 100)
    if (!Number.isFinite(cents) || cents < 0) { setMsg('Ungültiger Tagessatz.'); return }
    const { error } = await supabase.from('settings').update({ day_rate_cents: cents }).eq('id', true)
    setMsg(error ? error.message : `Tagessatz gespeichert: ${fmtEur(cents)}`)
  }

  async function newCode() {
    if (!confirm('Neuen Einladungs-Link erzeugen? Der alte Link funktioniert dann nicht mehr.')) return
    const fresh = crypto.randomUUID().replace(/-/g, '')
    const { error } = await supabase.from('invites').update({ code: fresh }).eq('id', true)
    setMsg(error ? error.message : 'Neuer Einladungs-Link erzeugt.')
    await load()
  }

  async function zahltag() {
    if (!confirm('Zahltag-E-Mail an alle User schicken?')) return
    const { data, error } = await supabase.functions.invoke('zahltag')
    setMsg(error ? `Fehler: ${error.message}` : `Verschickt an ${data?.sent ?? '?'} Empfänger.`)
  }

  return (
    <div className="space-y-4">
      {msg && <p className="bg-yellow-50 border border-yellow-300 rounded p-2 text-sm">{msg}</p>}

      <section className="bg-white rounded-xl shadow p-4">
        <h2 className="text-lg font-bold mb-2">Plätze zuweisen</h2>
        <div className="grid sm:grid-cols-2 gap-2">
          {spots.map(spot => (
            <div key={spot.id} className="flex items-center gap-2">
              <span className="w-16 shrink-0">Platz {spot.id}</span>
              <select
                value={spot.owner_id ?? ''}
                onChange={e => assignSpot(spot.id, e.target.value || null)}
                className="border rounded p-1 flex-1"
              >
                <option value="">— kein Besitzer —</option>
                {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white rounded-xl shadow p-4 space-y-2">
        <h2 className="text-lg font-bold">Einladungs-Link</h2>
        <p className="text-sm text-gray-600">
          Diesen Link an neue Mitbewohner schicken — damit können sie sich selbst registrieren.
          Nur wer den Link hat, kommt rein.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input readOnly value={inviteLink} className="border rounded p-1 flex-1 min-w-0 bg-gray-50 text-sm" />
          <button
            onClick={() => { navigator.clipboard?.writeText(inviteLink); setMsg('Link kopiert.') }}
            className="bg-blue-600 text-white rounded px-3 py-1"
          >
            Kopieren
          </button>
          <button onClick={newCode} className="border rounded px-3 py-1">Neuen Link erzeugen</button>
        </div>
      </section>

      <section className="bg-white rounded-xl shadow p-4">
        <h2 className="text-lg font-bold mb-2">User verwalten</h2>
        <ul className="divide-y">
          {profiles.map(p => (
            <li key={p.id} className="py-2 flex items-center gap-2">
              <span className="flex-1">
                {p.name}
                {p.is_admin && <span className="ml-2 text-xs bg-gray-200 rounded px-1.5 py-0.5">Admin</span>}
                {p.id === userId && <span className="ml-2 text-xs text-gray-400">(du)</span>}
              </span>
              {p.id !== userId && (
                <>
                  <button onClick={() => toggleAdmin(p)} className="text-sm border rounded px-2 py-1">
                    {p.is_admin ? 'Admin entziehen' : 'Zum Admin machen'}
                  </button>
                  <button onClick={() => removeUser(p)} className="text-sm text-red-600 border border-red-300 rounded px-2 py-1">
                    Löschen
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="bg-white rounded-xl shadow p-4 space-y-3">
        <h2 className="text-lg font-bold">Tagessatz &amp; Zahltag</h2>
        <div className="flex items-center gap-2">
          <label htmlFor="rate">Tagessatz (€):</label>
          <input id="rate" value={rate} onChange={e => setRate(e.target.value)} className="border rounded p-1 w-20" />
          <button onClick={saveRate} className="bg-blue-600 text-white rounded px-3 py-1">Speichern</button>
        </div>
        <button onClick={zahltag} className="bg-red-600 text-white rounded px-3 py-1">
          📧 Zahltag-E-Mail an alle schicken
        </button>
      </section>
    </div>
  )
}
