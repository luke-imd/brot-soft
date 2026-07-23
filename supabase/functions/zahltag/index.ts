// supabase/functions/zahltag/index.ts
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    // Caller muss eingeloggter Admin sein
    const authed = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } },
    )
    const { data: { user } } = await authed.auth.getUser()
    const { data: profile } = user
      ? await authed.from('profiles').select('is_admin').eq('id', user.id).single()
      : { data: null }
    if (!profile?.is_admin) {
      return new Response(JSON.stringify({ error: 'forbidden' }),
        { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const { data, error } = await admin.auth.admin.listUsers({ perPage: 100 })
    if (error) {
      return new Response(JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } })
    }
    const emails = data.users.map(u => u.email).filter((e): e is string => !!e)

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Garage <onboarding@resend.dev>', // ponytail: resend-testdomain, eigene domain später
        to: [user!.email],
        bcc: emails,
        subject: 'Heute ist Zahltag 💸',
        html: '<p>Hallo!</p><p>Heute ist Zahltag: Bitte schaut ins Garagen-Tool und begleicht eure offenen Schulden.</p>',
      }),
    })
    if (!res.ok) {
      return new Response(JSON.stringify({ error: await res.text() }),
        { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify({ sent: emails.length }),
      { headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } })
  }
})
