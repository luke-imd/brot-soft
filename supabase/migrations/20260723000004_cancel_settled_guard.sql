-- Storno darf keine bereits beglichene Schuld löschen (Buchhaltung bleibt erhalten)
create or replace function public.cancel_booking(p_booking_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_start date;
begin
  select min(date) into v_start from free_slots where booking_id = p_booking_id;
  if v_start is null or v_start <= current_date then
    raise exception 'Buchung hat schon begonnen';
  end if;
  if exists (select 1 from ledger where booking_id = p_booking_id and settled_at is not null) then
    raise exception 'Schuld wurde schon beglichen — Storno nicht mehr möglich';
  end if;
  delete from bookings where id = p_booking_id and borrower_id = auth.uid();
  if not found then raise exception 'Nicht deine Buchung'; end if;
  -- free_slots.booking_id wird via FK "on delete set null" wieder frei,
  -- der Ledger-Eintrag via "on delete cascade" gelöscht.
end $$;
