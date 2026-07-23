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
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <form onSubmit={submit} className="bg-white rounded-xl shadow p-8 w-80 space-y-4">
        <h1 className="text-xl font-bold">Registrieren</h1>
        <p className="text-sm text-gray-600">Willkommen bei der Garagen-Verwaltung. Leg dir einen Zugang an.</p>
        <input
          type="text"
          required
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Name"
          className="w-full border rounded p-2"
        />
        <input
          type="email"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="E-Mail"
          className="w-full border rounded p-2"
        />
        <input
          type="password"
          required
          minLength={6}
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="Passwort (mind. 6 Zeichen)"
          className="w-full border rounded p-2"
        />
        <button disabled={busy} className="w-full bg-blue-600 text-white rounded p-2 disabled:opacity-50">
          {busy ? 'Moment…' : 'Account anlegen'}
        </button>
        {error && <p className="text-red-600 text-sm">{error}</p>}
      </form>
    </div>
  )
}
