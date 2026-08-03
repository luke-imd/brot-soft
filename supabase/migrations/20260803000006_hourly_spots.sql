-- Stunden statt Halbtage, Tagespauschale, 23 echte Plätze (Plan Objekt 2), claim_spot.

-- 1) free_slots: half -> hour. am -> Stunden 0-11, pm -> 12-23, Buchungszuordnung bleibt.
alter table public.free_slots drop constraint free_slots_pkey;
alter table public.free_slots add column hour int;

-- Bestandszeilen zu je 12 Stunden-Zeilen auffächern: 11 neue Zeilen je Halbtag ...
insert into public.free_slots (spot_id, date, half, hour, booking_id)
select f.spot_id, f.date, f.half,
       case when f.half = 'am' then gs.h else gs.h + 12 end,
       f.booking_id
from public.free_slots f
cross join generate_series(1, 11) as gs(h)
where f.hour is null;

-- ... und die Originalzeile wird Stunde 0 bzw. 12.
update public.free_slots set hour = case when half = 'am' then 0 else 12 end
where hour is null;

alter table public.free_slots alter column hour set not null;
alter table public.free_slots add constraint free_slots_hour_check check (hour between 0 and 23);
alter table public.free_slots drop column half;
alter table public.free_slots add primary key (spot_id, date, hour);

-- 2) spots: aktiv-Flag, Fahrrad-/Traktor-Plätze deaktivieren, Platz 24 existiert nicht.
alter table public.spots add column active boolean not null default true;
update public.spots set active = false, owner_id = null where id in (5, 7, 9, 19);
delete from public.free_slots where spot_id = 24 and booking_id is null;
delete from public.spots where id = 24; -- schlägt bewusst fehl, falls echte Buchungen existieren
alter table public.spots drop column grid_row;
alter table public.spots drop column grid_col;

-- 3) profiles: Platzsucher-Marker (rein informativ, Anzeige in der Admin-Liste).
alter table public.profiles add column seeker boolean not null default false;

-- 4) Tagespauschale 3 €.
update public.settings set day_rate_cents = 300;

-- 5) book_spot: Slots sind jetzt {date, hour}; Preis = distinct Tage × Tagessatz.
create or replace function public.book_spot(p_spot_id int, p_slots jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_booking_id uuid;
  v_expected int;
  v_count int;
  v_days int;
  v_owner uuid;
  v_rate int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select owner_id into v_owner from spots where id = p_spot_id;
  if v_owner is null then raise exception 'Platz hat keinen Besitzer'; end if;
  if v_owner = auth.uid() then raise exception 'Eigenen Platz kann man nicht buchen'; end if;
  v_expected := jsonb_array_length(p_slots);
  if v_expected is null or v_expected = 0 then raise exception 'Keine Stunden angegeben'; end if;

  insert into bookings (spot_id, borrower_id) values (p_spot_id, auth.uid())
  returning id into v_booking_id;

  update free_slots f set booking_id = v_booking_id
  from jsonb_to_recordset(p_slots) as s(date date, hour int)
  where f.spot_id = p_spot_id and f.date = s.date and f.hour = s.hour
    and f.booking_id is null and f.date >= current_date;
  get diagnostics v_count = row_count;
  if v_count <> v_expected then
    raise exception 'Nicht alle Stunden sind (mehr) frei';
  end if;

  -- Tagespauschale: jeder angefangene Kalendertag zählt voll.
  select count(distinct s.date) into v_days
  from jsonb_to_recordset(p_slots) as s(date date, hour int);
  select day_rate_cents into v_rate from settings;
  insert into ledger (booking_id, debtor_id, creditor_id, amount_cents)
  values (v_booking_id, auth.uid(), v_owner, v_days * v_rate);
  return v_booking_id;
end $$;

-- 6) Selbst-Eintragen eines besitzerlosen aktiven Platzes, race-sicher.
create function public.claim_spot(p_spot_id int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  update spots set owner_id = auth.uid()
  where id = p_spot_id and owner_id is null and active;
  if not found then raise exception 'Platz ist schon vergeben oder nicht verfügbar'; end if;
end $$;

revoke execute on function public.claim_spot(int) from public, anon;
grant execute on function public.claim_spot(int) to authenticated;
