-- Einladungs-Code für Selbstregistrierung über einen geheimen Link (?join=CODE).
-- Single-Row-Tabelle; nur Admins dürfen den Code lesen/rotieren.
-- Die join-Edge-Function liest den Code mit Service-Role (umgeht RLS).
create table public.invites (
  id boolean primary key default true check (id),
  code text not null
);

insert into public.invites (code) values (replace(gen_random_uuid()::text, '-', ''));

alter table public.invites enable row level security;

create policy "admin_reads" on public.invites for select to authenticated
  using (public.is_admin());
create policy "admin_updates" on public.invites for update to authenticated
  using (public.is_admin());
