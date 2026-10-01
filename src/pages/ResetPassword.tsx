import { useState } from 'react'
import { api } from '../lib/api'

// Landeseite für den Reset-Link aus der E-Mail (?reset=TOKEN): neues Passwort setzen,
// der Server loggt danach direkt ein.
export default function ResetPassword({ token }: { token: string }) {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (pw !== pw2) { setError('Die Passwörter stimmen nicht überein.'); return }
    setBusy(true)
    setError('')
    try {
      await api.post('/auth/reset', { token, password: pw })
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
            <h1 className="text-xl font-extrabold leading-tight tracking-tight">Neues Passwort</h1>
            <p className="text-sm text-zinc-500">Garagen-Verwaltung</p>
          </div>
        </div>
        <input type="password" required minLength={6} autoFocus value={pw}
          onChange={e => setPw(e.target.value)} placeholder="Neues Passwort (mind. 6 Zeichen)" className="input w-full" />
        <input type="password" required minLength={6} value={pw2}
          onChange={e => setPw2(e.target.value)} placeholder="Passwort wiederholen" className="input w-full" />
        <button disabled={busy} className="btn btn-primary w-full">{busy ? 'Moment…' : 'Speichern'}</button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
    </div>
  )
}
