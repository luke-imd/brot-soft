-- scripts/db-smoke.sql — läuft in einer Transaktion, rollt immer zurück.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'owner@test.local'),
  ('00000000-0000-0000-0000-000000000002', 'borrower@test.local');

update public.spots set owner_id = '00000000-0000-0000-0000-000000000001' where id = 1;
insert into public.free_slots (spot_id, date, hour) values
  (1, current_date + 1, 10),
  (1, current_date + 1, 11),
  (1, current_date + 2, 8);

-- als Borrower agieren (auth.uid() liest request.jwt.claims)
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

do $$
declare
  v_booking uuid;
  v_amount int;
  v_raised boolean := false;
begin
  -- 3 Stunden über 2 Tage buchen -> Tagespauschale: 2 × 300 = 600 Cents
  v_booking := public.book_spot(1, jsonb_build_array(
    jsonb_build_object('date', current_date + 1, 'hour', 10),
    jsonb_build_object('date', current_date + 1, 'hour', 11),
    jsonb_build_object('date', current_date + 2, 'hour', 8)));
  select amount_cents into v_amount from public.ledger where booking_id = v_booking;
  assert v_amount = 600, format('expected 600 cents, got %s', v_amount);

  -- Doppelbuchung derselben Stunde muss scheitern
  begin
    perform public.book_spot(1, jsonb_build_array(
      jsonb_build_object('date', current_date + 1, 'hour', 10)));
  exception when others then v_raised := true;
  end;
  assert v_raised, 'double booking did not raise';

  -- Storno gibt Stunden frei und löscht die Schuld
  perform public.cancel_booking(v_booking);
  assert (select count(*) from public.free_slots
          where spot_id = 1 and booking_id is not null) = 0, 'slots not freed';
  assert (select count(*) from public.ledger where booking_id = v_booking) = 0,
    'ledger entry not deleted';

  -- claim_spot: besitzerlosen aktiven Platz eintragen ...
  perform public.claim_spot(2);
  assert (select owner_id from public.spots where id = 2)
         = '00000000-0000-0000-0000-000000000002', 'claim did not set owner';

  -- ... schon vergebener Platz scheitert
  v_raised := false;
  begin
    perform public.claim_spot(1);
  exception when others then v_raised := true;
  end;
  assert v_raised, 'claiming an owned spot did not raise';

  -- ... inaktiver Platz (Fahrrad/Traktor) scheitert
  v_raised := false;
  begin
    perform public.claim_spot(5);
  exception when others then v_raised := true;
  end;
  assert v_raised, 'claiming an inactive spot did not raise';
end $$;

rollback;
