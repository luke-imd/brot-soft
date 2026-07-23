-- scripts/db-smoke.sql — läuft in einer Transaktion, rollt immer zurück.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'owner@test.local'),
  ('00000000-0000-0000-0000-000000000002', 'borrower@test.local');

update public.spots set owner_id = '00000000-0000-0000-0000-000000000001' where id = 1;
insert into public.free_slots (spot_id, date, half) values
  (1, current_date + 1, 'am'),
  (1, current_date + 1, 'pm');

-- als Borrower agieren (auth.uid() liest request.jwt.claims)
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

do $$
declare
  v_booking uuid;
  v_amount int;
  v_raised boolean := false;
begin
  -- ganzer Tag buchen -> 500 Cents Schuld
  v_booking := public.book_spot(1, jsonb_build_array(
    jsonb_build_object('date', current_date + 1, 'half', 'am'),
    jsonb_build_object('date', current_date + 1, 'half', 'pm')));
  select amount_cents into v_amount from public.ledger where booking_id = v_booking;
  assert v_amount = 500, format('expected 500 cents, got %s', v_amount);

  -- Doppelbuchung muss scheitern
  begin
    perform public.book_spot(1, jsonb_build_array(
      jsonb_build_object('date', current_date + 1, 'half', 'am')));
  exception when others then v_raised := true;
  end;
  assert v_raised, 'double booking did not raise';

  -- Storno gibt Slots frei und löscht die Schuld
  perform public.cancel_booking(v_booking);
  assert (select count(*) from public.free_slots
          where spot_id = 1 and booking_id is not null) = 0, 'slots not freed';
  assert (select count(*) from public.ledger where booking_id = v_booking) = 0,
    'ledger entry not deleted';
end $$;

rollback;
