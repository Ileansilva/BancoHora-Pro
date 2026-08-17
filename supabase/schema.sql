-- BancoHora Pro 2.0 - schema multiempresa com RLS
-- Execute no SQL Editor de um projeto Supabase NOVO/exclusivo para este sistema.

create extension if not exists pgcrypto;
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  name text not null,
  cnpj text,
  phone text,
  address text,
  logo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.company_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','operator')),
  full_name text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(company_id,user_id)
);

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  full_name text not null,
  registration text not null,
  cpf text,
  role_title text,
  department text,
  phone text,
  email text,
  admission_date date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,registration)
);

create table if not exists public.time_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  entry_type text not null check (entry_type in ('credit','debit')),
  minutes integer not null check (minutes > 0 and minutes <= 100000),
  occurred_on date not null default current_date,
  reason text not null,
  notes text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_company_members_user on public.company_members(user_id);
create index if not exists idx_company_members_company on public.company_members(company_id);
create index if not exists idx_employees_company on public.employees(company_id);
create index if not exists idx_employees_company_active on public.employees(company_id,active);
create index if not exists idx_entries_company on public.time_entries(company_id);
create index if not exists idx_entries_employee on public.time_entries(employee_id);
create index if not exists idx_entries_company_date on public.time_entries(company_id,occurred_on);
create index if not exists idx_audit_company_date on public.audit_logs(company_id,created_at desc);

create or replace function private.is_company_member(target_company uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.company_members cm
    where cm.company_id = target_company
      and cm.user_id = (select auth.uid())
      and cm.active = true
  );
$$;

create or replace function private.is_company_admin(target_company uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.company_members cm
    where cm.company_id = target_company
      and cm.user_id = (select auth.uid())
      and cm.active = true
      and cm.role in ('owner','admin')
  );
$$;

create or replace function private.can_manage_time(target_company uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.company_members cm
    where cm.company_id = target_company
      and cm.user_id = (select auth.uid())
      and cm.active = true
      and cm.role in ('owner','admin','operator')
  );
$$;

revoke all on function private.is_company_member(uuid) from public, anon;
revoke all on function private.is_company_admin(uuid) from public, anon;
revoke all on function private.can_manage_time(uuid) from public, anon;
grant execute on function private.is_company_member(uuid) to authenticated;
grant execute on function private.is_company_admin(uuid) to authenticated;
grant execute on function private.can_manage_time(uuid) to authenticated;

alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.employees enable row level security;
alter table public.time_entries enable row level security;
alter table public.audit_logs enable row level security;

-- Companies
create policy companies_select on public.companies for select to authenticated
using (owner_user_id = (select auth.uid()) or private.is_company_member(id));
create policy companies_insert on public.companies for insert to authenticated
with check (owner_user_id = (select auth.uid()));
create policy companies_update on public.companies for update to authenticated
using (owner_user_id = (select auth.uid()) or private.is_company_admin(id))
with check (private.is_company_admin(id) or owner_user_id = (select auth.uid()));
create policy companies_delete on public.companies for delete to authenticated
using (owner_user_id = (select auth.uid()));

-- Memberships: o proprietário cria a própria membership; convites posteriores são feitos pela Edge Function.
create policy members_select on public.company_members for select to authenticated
using (user_id = (select auth.uid()) or private.is_company_admin(company_id));
create policy members_insert_owner_self on public.company_members for insert to authenticated
with check (
  user_id = (select auth.uid()) and role = 'owner' and exists (
    select 1 from public.companies c where c.id = company_id and c.owner_user_id = (select auth.uid())
  )
);
create policy members_update_owner on public.company_members for update to authenticated
using (exists (select 1 from public.companies c where c.id = company_id and c.owner_user_id = (select auth.uid())))
with check (exists (select 1 from public.companies c where c.id = company_id and c.owner_user_id = (select auth.uid())));
create policy members_delete_owner on public.company_members for delete to authenticated
using (exists (select 1 from public.companies c where c.id = company_id and c.owner_user_id = (select auth.uid())));

-- Employees
create policy employees_select on public.employees for select to authenticated using (private.is_company_member(company_id));
create policy employees_insert on public.employees for insert to authenticated with check (private.is_company_admin(company_id));
create policy employees_update on public.employees for update to authenticated using (private.is_company_admin(company_id)) with check (private.is_company_admin(company_id));
create policy employees_delete on public.employees for delete to authenticated using (private.is_company_admin(company_id));

-- Time entries
create policy entries_select on public.time_entries for select to authenticated using (private.is_company_member(company_id));
create policy entries_insert on public.time_entries for insert to authenticated
with check (private.can_manage_time(company_id) and created_by = (select auth.uid()) and exists (select 1 from public.employees e where e.id = employee_id and e.company_id = company_id));
create policy entries_update on public.time_entries for update to authenticated using (private.is_company_admin(company_id)) with check (private.is_company_admin(company_id));
create policy entries_delete on public.time_entries for delete to authenticated using (private.is_company_admin(company_id));

-- Audit is leitura para administradores. Inserções são feitas por triggers privadas.
create policy audit_select on public.audit_logs for select to authenticated using (private.is_company_admin(company_id));

-- Grants explícitos para Data API
revoke all on public.companies, public.company_members, public.employees, public.time_entries, public.audit_logs from anon;
grant select,insert,update,delete on public.companies to authenticated;
grant select,insert,update,delete on public.company_members to authenticated;
grant select,insert,update,delete on public.employees to authenticated;
grant select,insert,update,delete on public.time_entries to authenticated;
grant select on public.audit_logs to authenticated;

create or replace function private.protect_company_owner()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.owner_user_id is distinct from old.owner_user_id and (select auth.uid()) is distinct from old.owner_user_id then
    raise exception 'Somente o proprietário atual pode transferir a propriedade da empresa.';
  end if;
  return new;
end $$;
create trigger protect_company_owner before update on public.companies for each row execute function private.protect_company_owner();

create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path='' as $$ begin new.updated_at=now(); return new; end $$;
create trigger companies_updated_at before update on public.companies for each row execute function private.set_updated_at();
create trigger employees_updated_at before update on public.employees for each row execute function private.set_updated_at();

create or replace function private.audit_employee()
returns trigger language plpgsql security definer set search_path='' as $$
declare r public.employees; act text;
begin
  if TG_OP='DELETE' then r := old; else r := new; end if;
  act := lower(TG_OP);
  insert into public.audit_logs(company_id,actor_user_id,entity_type,entity_id,action,details)
  values(r.company_id,(select auth.uid()),'employee',r.id,act,jsonb_build_object('full_name',r.full_name,'registration',r.registration,'active',r.active));
  return case when TG_OP='DELETE' then old else new end;
end $$;
create trigger audit_employee_changes after insert or update or delete on public.employees for each row execute function private.audit_employee();

create or replace function private.audit_entry()
returns trigger language plpgsql security definer set search_path='' as $$
declare r public.time_entries; act text;
begin
  if TG_OP='DELETE' then r := old; else r := new; end if;
  act := lower(TG_OP);
  insert into public.audit_logs(company_id,actor_user_id,entity_type,entity_id,action,details)
  values(r.company_id,(select auth.uid()),'time_entry',r.id,act,jsonb_build_object('employee_id',r.employee_id,'entry_type',r.entry_type,'minutes',r.minutes,'occurred_on',r.occurred_on,'reason',r.reason));
  return case when TG_OP='DELETE' then old else new end;
end $$;
create trigger audit_time_entry_changes after insert or update or delete on public.time_entries for each row execute function private.audit_entry();

-- Logo pública; escrita apenas por admin da empresa e somente dentro da pasta {company_id}/...
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('company-logos','company-logos',true,2097152,array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy company_logo_insert on storage.objects for insert to authenticated
with check (bucket_id='company-logos' and private.is_company_admin(((storage.foldername(name))[1])::uuid));
create policy company_logo_select_manage on storage.objects for select to authenticated
using (bucket_id='company-logos' and private.is_company_admin(((storage.foldername(name))[1])::uuid));
create policy company_logo_update on storage.objects for update to authenticated
using (bucket_id='company-logos' and private.is_company_admin(((storage.foldername(name))[1])::uuid))
with check (bucket_id='company-logos' and private.is_company_admin(((storage.foldername(name))[1])::uuid));
create policy company_logo_delete on storage.objects for delete to authenticated
using (bucket_id='company-logos' and private.is_company_admin(((storage.foldername(name))[1])::uuid));
-- BancoHora Pro 2.1.0 - correções de fluxo e robustez

create or replace function private.is_company_owner(target_company uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.companies c
    where c.id = target_company
      and c.owner_user_id = (select auth.uid())
  );
$$;

revoke all on function private.is_company_owner(uuid) from public, anon;
grant execute on function private.is_company_owner(uuid) to authenticated;

-- Exclusão definitiva de funcionário somente pelo proprietário.
drop policy if exists employees_delete on public.employees;
create policy employees_delete on public.employees
for delete to authenticated
using (private.is_company_owner(company_id));

-- Cria funcionário e saldo inicial em uma única transação.
create or replace function public.create_employee_with_initial_balance(
  p_company_id uuid,
  p_full_name text,
  p_registration text,
  p_cpf text default null,
  p_role_title text default null,
  p_department text default null,
  p_phone text default null,
  p_email text default null,
  p_admission_date date default null,
  p_initial_minutes integer default 0,
  p_initial_type text default 'credit'
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_employee_id uuid;
begin
  if p_full_name is null or btrim(p_full_name) = '' then
    raise exception 'Nome do funcionário é obrigatório.';
  end if;

  if p_registration is null or btrim(p_registration) = '' then
    raise exception 'Matrícula é obrigatória.';
  end if;

  if p_initial_minutes < 0 or p_initial_minutes > 100000 then
    raise exception 'Saldo inicial inválido.';
  end if;

  if p_initial_type not in ('credit','debit') then
    raise exception 'Tipo de saldo inicial inválido.';
  end if;

  insert into public.employees(
    company_id, full_name, registration, cpf, role_title, department,
    phone, email, admission_date
  ) values (
    p_company_id, btrim(p_full_name), btrim(p_registration), nullif(btrim(p_cpf), ''),
    nullif(btrim(p_role_title), ''), nullif(btrim(p_department), ''),
    nullif(btrim(p_phone), ''), nullif(btrim(p_email), ''), p_admission_date
  )
  returning id into new_employee_id;

  if p_initial_minutes > 0 then
    insert into public.time_entries(
      company_id, employee_id, entry_type, minutes, occurred_on,
      reason, notes, created_by
    ) values (
      p_company_id, new_employee_id, p_initial_type, p_initial_minutes, current_date,
      'Saldo inicial', 'Saldo cadastrado na inclusão do funcionário', (select auth.uid())
    );
  end if;

  return new_employee_id;
end;
$$;

revoke all on function public.create_employee_with_initial_balance(uuid,text,text,text,text,text,text,text,date,integer,text) from public, anon;
grant execute on function public.create_employee_with_initial_balance(uuid,text,text,text,text,text,text,text,date,integer,text) to authenticated;

-- Habilita sincronização em tempo real para os dados que aparecem no painel.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='employees') then
      execute 'alter publication supabase_realtime add table public.employees';
    end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='time_entries') then
      execute 'alter publication supabase_realtime add table public.time_entries';
    end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='company_members') then
      execute 'alter publication supabase_realtime add table public.company_members';
    end if;
  end if;
end $$;
