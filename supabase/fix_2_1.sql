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
