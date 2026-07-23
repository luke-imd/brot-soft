import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// Admin löscht einen User. Nur für Admins; nutzt Service-Role für das eigentliche Löschen.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    // Aufrufer muss eingeloggter Admin sein
    const authed = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } },
    )
    const { data: { user } } = await authed.auth.getUser()
    const { data: profile } = user
      ? await authed.from('profiles').select('is_admin').eq('id', user.id).single()
      : { data: null }
    if (!profile?.is_admin) return json({ error: 'forbidden' }, 403)

    const userId = String((await req.json().catch(() => ({}))).userId ?? '')
    if (!userId) return json({ ok: false, error: 'Kein User angegeben.' })
    if (userId === user!.id) return json({ ok: false, error: 'Du kannst dich nicht selbst löschen.' })

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Vorab prüfen, BEVOR wir etwas ändern: verweisen Buchungen/Ledger auf den User?
    // (Diese FKs sind RESTRICT — das Löschen würde sonst scheitern und den Platz-Besitz
    // schon verwaist zurücklassen.)
    const [{ count: bk }, { count: lg }] = await Promise.all([
      admin.from('bookings').select('*', { count: 'exact', head: true }).eq('borrower_id', userId),
      admin.from('ledger').select('*', { count: 'exact', head: true })
        .or(`debtor_id.eq.${userId},creditor_id.eq.${userId},settled_by.eq.${userId}`),
    ])
    if ((bk ?? 0) > 0 || (lg ?? 0) > 0) {
      return json({ ok: false, error: 'User hat noch Buchungen oder offene/beglichene Schulden und kann nicht gelöscht werden.' })
    }

    // Erst jetzt Platz-Besitz lösen (sonst blockiert der spots-FK das Löschen)
    await admin.from('spots').update({ owner_id: null }).eq('owner_id', userId)

    const { error } = await admin.auth.admin.deleteUser(userId)
    if (error) {
      const msg = /foreign key|violat|constraint/i.test(error.message)
        ? 'User hat noch Buchungen oder offene/beglichene Schulden und kann nicht gelöscht werden.'
        : 'Löschen fehlgeschlagen.'
      return json({ ok: false, error: msg })
    }
    return json({ ok: true })
  } catch (err) {
    console.error('delete-user error:', err)
    return json({ ok: false, error: 'Serverfehler.' }, 500)
  }
})
