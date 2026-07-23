import { useState } from 'react'
import { supabase } from './lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setMsg(error.message)
  }

  async function forgot() {
    if (!email) {
      setMsg('E-Mail eingeben, dann nochmal klicken.')
      return
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    })
    setMsg(error ? error.message : `Reset-Link an ${email} geschickt.`)
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="card fade-in w-full max-w-xs space-y-4 p-7">
        <div className="flex items-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-zinc-900 text-xl font-extrabold text-white">P</span>
          <div>
            <h1 className="text-xl font-extrabold leading-tight tracking-tight">Garage</h1>
            <p className="text-sm text-zinc-500">Anmelden</p>
          </div>
        </div>
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
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="Passwort"
          className="input w-full"
        />
        <button className="btn btn-primary w-full">Login</button>
        <button
          type="button"
          onClick={forgot}
          className="w-full text-sm text-zinc-500 transition-colors hover:text-zinc-900"
        >
          Passwort vergessen?
        </button>
        {msg && <p className="text-sm text-zinc-700">{msg}</p>}
      </form>
    </div>
  )
}
