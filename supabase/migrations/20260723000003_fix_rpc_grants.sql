-- revoke from anon in migration 2 was ineffective: EXECUTE is granted to PUBLIC by default
revoke execute on function public.book_spot(int, jsonb) from public;
revoke execute on function public.cancel_booking(uuid) from public;
revoke execute on function public.settle_ledger(uuid) from public;
grant execute on function public.book_spot(int, jsonb) to authenticated;
grant execute on function public.cancel_booking(uuid) to authenticated;
grant execute on function public.settle_ledger(uuid) to authenticated;
