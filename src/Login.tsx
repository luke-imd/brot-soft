import { useState } from 'react'
import { supabase } from './lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    // shouldCreateUser: false -> nur eingeladene User kommen rein
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    })
    if (error) setError(error.message)
    else setSent(true)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <form onSubmit={submit} className="bg-white rounded-xl shadow p-8 w-80 space-y-4">
        <h1 className="text-xl font-bold">Garage Login</h1>
        {sent ? (
          <p className="text-green-700">Login-Link wurde an {email} geschickt.</p>
        ) : (
          <>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="E-Mail"
              className="w-full border rounded p-2"
            />
            <button className="w-full bg-blue-600 text-white rounded p-2">
              Login-Link schicken
            </button>
            {error && <p className="text-red-600 text-sm">{error}</p>}
          </>
        )}
      </form>
    </div>
  )
}
