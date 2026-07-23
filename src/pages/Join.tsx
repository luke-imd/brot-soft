import { useState } from 'react'
import { supabase } from '../lib/supabase'

// Selbstregistrierung über den geheimen Einladungs-Link (?join=CODE).
// Die join-Edge-Function legt den User an (kein Bestätigungs-Mail), danach direkt Login.
export default function Join({ code }: { code: string }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const { data, error: fnError } = await supabase.functions.invoke('join', {
        body: { code, name, email, password },
      })
      if (fnError) throw new Error('Registrierung fehlgeschlagen. Bitte später erneut versuchen.')
      if (!data?.ok) {
        setError(data?.error ?? 'Registrierung fehlgeschlagen.')
        return
      }
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
      if (signInError) {
        setError('Account angelegt, aber Login fehlgeschlagen. Bitte auf der Startseite einloggen.')
        return
      }
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
        <button disabled={busy} className="btn btn-primary w-full">
          {busy ? 'Moment…' : 'Account anlegen'}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
    </div>
  )
}
