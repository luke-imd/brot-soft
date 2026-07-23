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
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <form onSubmit={submit} className="bg-white rounded-xl shadow p-8 w-80 space-y-4">
        <h1 className="text-xl font-bold">Garage Login</h1>
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
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="Passwort"
          className="w-full border rounded p-2"
        />
        <button className="w-full bg-blue-600 text-white rounded p-2">Login</button>
        <button
          type="button"
          onClick={forgot}
          className="w-full text-sm text-gray-500 hover:text-gray-800"
        >
          Passwort vergessen?
        </button>
        {msg && <p className="text-sm text-gray-700">{msg}</p>}
      </form>
    </div>
  )
}
