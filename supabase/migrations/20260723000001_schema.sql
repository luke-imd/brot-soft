-- supabase/migrations/20260723000001_schema.sql
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  is_admin boolean not null default false
);

create table public.spots (
  id int primary key,
  owner_id uuid references public.profiles(id),
  grid_row int not null,
  grid_col int not null
);

create table public.settings (
  id boolean primary key default true check (id), -- ponytail: single-row table via bool-PK
  day_rate_cents int not null default 500
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  spot_id int not null references public.spots(id),
  borrower_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

-- Eine Zeile pro freigegebenem Halbtag. booking_id null = frei, gesetzt = gebucht.
-- Der PK macht Doppelbuchung/Doppel-Freigabe auf DB-Ebene unmöglich.
create table public.free_slots (
  spot_id int not null references public.spots(id),
  date date not null,
  half text not null check (half in ('am','pm')),
  booking_id uuid references public.bookings(id) on delete set null,
  primary key (spot_id, date, half)
);

create table public.ledger (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid unique references public.bookings(id) on delete cascade,
  debtor_id uuid not null references public.profiles(id),
  creditor_id uuid not null references public.profiles(id),
  amount_cents int not null,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  settled_by uuid references public.profiles(id)
);

insert into public.settings (day_rate_cents) values (500);

insert into public.spots (id, grid_row, grid_col)
select n, (n - 1) / 12 + 1, (n - 1) % 12 + 1
from generate_series(1, 24) as n;

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
