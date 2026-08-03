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
// Mit { list: true } liefert sie stattdessen die besitzerlosen aktiven Plätze
// (fürs Platz-Dropdown der Join-Seite; anon darf per RLS nichts lesen).
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const body = await req.json().catch(() => ({}))
    const code = String(body.code ?? '')
    if (!code) return json({ ok: false, error: 'Ungültiger Einladungs-Link.' })

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: inv } = await admin.from('invites').select('code').single()
    if (!inv || inv.code !== code) {
      return json({ ok: false, error: 'Ungültiger oder abgelaufener Einladungs-Link.' })
    }

    if (body.list) {
      const { data: spots } = await admin.from('spots').select('id')
        .is('owner_id', null).eq('active', true).order('id')
      return json({ ok: true, spots: (spots ?? []).map((s) => s.id) })
    }

    const name = String(body.name ?? '').trim()
    const email = String(body.email ?? '').trim().toLowerCase()
    const password = String(body.password ?? '')
    const seeker = Boolean(body.seeker)
    const spotId = body.spot_id == null ? null : Number(body.spot_id)

    if (!name || !email || !password) {
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
    if (spotId !== null && !Number.isInteger(spotId)) {
      return json({ ok: false, error: 'Ungültiger Platz.' })
    }

    const { count } = await admin.from('profiles').select('*', { count: 'exact', head: true })
    if ((count ?? 0) >= MAX_USERS) {
      return json({ ok: false, error: 'Maximale Nutzerzahl erreicht.' })
    }

    // email_confirm: true -> sofort einsatzbereit, kein Bestätigungs-Mail nötig.
    // Der Trigger handle_new_user legt das Profil mit name aus user_metadata an.
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
    })
    if (error || !data.user) {
      const msg = /already|exist|registered/i.test(error?.message ?? '')
        ? 'Diese E-Mail ist schon registriert.'
        : (error?.message ?? 'Registrierung fehlgeschlagen.')
      return json({ ok: false, error: msg })
    }

    const warnings: string[] = []

    if (seeker) {
      const { error: seekerError } = await admin.from('profiles').update({ seeker: true }).eq('id', data.user.id)
      if (seekerError) {
        console.error('join: seeker update failed:', seekerError)
        warnings.push('Sucher-Markierung konnte nicht gespeichert werden — bitte beim Admin melden.')
      }
    }

    if (spotId !== null) {
      // bedingtes UPDATE = race-sicher; 0 Zeilen -> Platz war inzwischen weg
      const { data: claimed } = await admin.from('spots').update({ owner_id: data.user.id })
        .eq('id', spotId).is('owner_id', null).eq('active', true).select('id')
      if (!claimed?.length) {
        warnings.push('Dein Wunsch-Platz wurde inzwischen vergeben — du kannst ihn später im Kalender neu wählen oder den Admin fragen.')
      }
    }

    return json({ ok: true, warning: warnings.length ? warnings.join(' ') : undefined })
  } catch (err) {
    console.error('join error:', err)
    return json({ ok: false, error: 'Serverfehler. Bitte später erneut versuchen.' }, 500)
  }
})
