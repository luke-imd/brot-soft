-- supabase/migrations/20260723000002_rls_rpc.sql
alter table public.profiles enable row level security;
alter table public.spots enable row level security;
alter table public.settings enable row level security;
alter table public.bookings enable row level security;
alter table public.free_slots enable row level security;
alter table public.ledger enable row level security;

-- Transparenz ist gewollt: alle eingeloggten User lesen alles.
create policy "read_all" on public.profiles for select to authenticated using (true);
create policy "read_all" on public.spots for select to authenticated using (true);
create policy "read_all" on public.settings for select to authenticated using (true);
create policy "read_all" on public.bookings for select to authenticated using (true);
create policy "read_all" on public.free_slots for select to authenticated using (true);
create policy "read_all" on public.ledger for select to authenticated using (true);

create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce((select is_admin from public.profiles where id = auth.uid()), false) $$;

-- Besitzer geben eigene Plätze frei / ziehen ungebuchte Freigaben zurück
create policy "owner_frees" on public.free_slots for insert to authenticated
  with check (
    booking_id is null
    and exists (select 1 from public.spots s where s.id = spot_id and s.owner_id = auth.uid())
  );
create policy "owner_retracts" on public.free_slots for delete to authenticated
  using (
    booking_id is null
    and exists (select 1 from public.spots s where s.id = spot_id and s.owner_id = auth.uid())
  );

-- Admin verwaltet Zuordnung, Tagessatz, Profile
create policy "admin_updates" on public.spots for update to authenticated
  using (public.is_admin());
create policy "admin_updates" on public.settings for update to authenticated
  using (public.is_admin());
create policy "admin_updates" on public.profiles for update to authenticated
  using (public.is_admin());

-- Buchen: atomar (Buchung + Slots + Ledger), Race-sicher durch Row-Locks beim UPDATE.
create function public.book_spot(p_spot_id int, p_slots jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_booking_id uuid;
  v_expected int;
  v_count int;
  v_owner uuid;
  v_rate int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select owner_id into v_owner from spots where id = p_spot_id;
  if v_owner is null then raise exception 'Platz hat keinen Besitzer'; end if;
  if v_owner = auth.uid() then raise exception 'Eigenen Platz kann man nicht buchen'; end if;
  v_expected := jsonb_array_length(p_slots);
  if v_expected is null or v_expected = 0 then raise exception 'Keine Slots angegeben'; end if;

  insert into bookings (spot_id, borrower_id) values (p_spot_id, auth.uid())
  returning id into v_booking_id;

  update free_slots f set booking_id = v_booking_id
  from jsonb_to_recordset(p_slots) as s(date date, half text)
  where f.spot_id = p_spot_id and f.date = s.date and f.half = s.half
    and f.booking_id is null and f.date >= current_date;
  get diagnostics v_count = row_count;
  if v_count <> v_expected then
    raise exception 'Nicht alle Slots sind (mehr) frei';
  end if;

  select day_rate_cents into v_rate from settings;
  insert into ledger (booking_id, debtor_id, creditor_id, amount_cents)
  values (v_booking_id, auth.uid(), v_owner, round(v_count * v_rate / 2.0));
  return v_booking_id;
end $$;

-- ponytail: Storno nur bis zum Vortag des Buchungsbeginns; feinere Regel bei Bedarf.
create function public.cancel_booking(p_booking_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_start date;
begin
  select min(date) into v_start from free_slots where booking_id = p_booking_id;
  if v_start is null or v_start <= current_date then
    raise exception 'Buchung hat schon begonnen';
  end if;
  delete from bookings where id = p_booking_id and borrower_id = auth.uid();
  if not found then raise exception 'Nicht deine Buchung'; end if;
  -- free_slots.booking_id wird via FK "on delete set null" wieder frei,
  -- der Ledger-Eintrag via "on delete cascade" gelöscht.
end $$;

-- Begleichen: Schuldner oder Gläubiger, einseitig, geloggt via settled_by/settled_at.
create function public.settle_ledger(p_ledger_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update ledger set settled_at = now(), settled_by = auth.uid()
  where id = p_ledger_id and settled_at is null
    and auth.uid() in (debtor_id, creditor_id);
  if not found then raise exception 'Nicht erlaubt oder schon beglichen'; end if;
end $$;

revoke execute on function public.book_spot(int, jsonb) from anon;
revoke execute on function public.cancel_booking(uuid) from anon;
revoke execute on function public.settle_ledger(uuid) from anon;
