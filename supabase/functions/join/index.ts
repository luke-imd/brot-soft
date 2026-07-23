import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const MAX_USERS = 50

// Öffentliche Selbstregistrierung, gated durch den geheimen invites.code.
// Kein JWT nötig (verify_jwt=false) — der Code ist das einzige Tor.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const body = await req.json().catch(() => ({}))
    const code = String(body.code ?? '')
    const name = String(body.name ?? '').trim()
    const email = String(body.email ?? '').trim().toLowerCase()
    const password = String(body.password ?? '')

    if (!code || !name || !email || !password) {
      return json({ ok: false, error: 'Bitte alle Felder ausfüllen.' })
    }
    if (name.length > 100 || email.length > 254 || password.length > 128) {
      return json({ ok: false, error: 'Eingabe zu lang.' })
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return json({ ok: false, error: 'Ungültige E-Mail-Adresse.' })
    }
    if (password.length < 6) {
      return json({ ok: false, error: 'Passwort muss mindestens 6 Zeichen haben.' })
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: inv } = await admin.from('invites').select('code').single()
    if (!inv || inv.code !== code) {
      return json({ ok: false, error: 'Ungültiger oder abgelaufener Einladungs-Link.' })
    }

    const { count } = await admin.from('profiles').select('*', { count: 'exact', head: true })
    if ((count ?? 0) >= MAX_USERS) {
      return json({ ok: false, error: 'Maximale Nutzerzahl erreicht.' })
    }

    // email_confirm: true -> sofort einsatzbereit, kein Bestätigungs-Mail nötig.
    // Der Trigger handle_new_user legt das Profil mit name aus user_metadata an.
    const { error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
    })
    if (error) {
      const msg = /already|exist|registered/i.test(error.message)
        ? 'Diese E-Mail ist schon registriert.'
        : error.message
      return json({ ok: false, error: msg })
    }
    return json({ ok: true })
  } catch (err) {
    console.error('join error:', err)
    return json({ ok: false, error: 'Serverfehler. Bitte später erneut versuchen.' }, 500)
  }
})
