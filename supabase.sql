-- =====================================================================
-- MAD VENTURE 2026 — FIRST MOVE
-- Paste this whole file into Supabase > SQL Editor and click RUN.
-- Safe to run more than once. Every table/function starts with "fm_",
-- so it does not touch anything else in the project.
-- =====================================================================

create table if not exists fm_teams (
  team_no       int primary key check (team_no between 1 and 24),
  code_hash     text,                       -- scrambled leader IC last-4 (never the digits themselves)
  fail_count    int not null default 0,
  lock_count    int not null default 0,
  locked_until  timestamptz,
  completed_at  timestamptz,
  hidden_result text,
  draw_seed     int                         -- random 6-digit number recorded at the moment of the move
);

insert into fm_teams (team_no)
select g from generate_series(1, 24) g
on conflict (team_no) do nothing;

-- The pool of hidden results. One row = one slot. A team takes one random free slot.
create table if not exists fm_pool (
  id        bigint generated always as identity primary key,
  result    text not null,
  taken_by  int unique references fm_teams(team_no)
);

create table if not exists fm_ip_fails (
  ip  text not null,
  at  timestamptz not null default now()
);
create index if not exists fm_ip_fails_idx on fm_ip_fails (ip, at);

-- Lock everything down: no public access at all. Only the server key can reach these.
alter table fm_teams    enable row level security;
alter table fm_pool     enable row level security;
alter table fm_ip_fails enable row level security;
revoke all on fm_teams, fm_pool, fm_ip_fails from anon, authenticated;

-- ---------------------------------------------------------------------
-- Guess limiting by network address (30 wrong tries per 15 minutes)
-- ---------------------------------------------------------------------
create or replace function fm_ip_blocked(p_ip text) returns boolean
language sql security definer set search_path = public as $$
  select count(*) >= 30 from fm_ip_fails
  where ip = p_ip and at > now() - interval '15 minutes';
$$;

create or replace function fm_ip_fail(p_ip text) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into fm_ip_fails (ip) values (p_ip);
  delete from fm_ip_fails where at < now() - interval '1 day';
end $$;

-- ---------------------------------------------------------------------
-- Verify a team leader. Returns VERIFIED / ALREADY_COMPLETED / INVALID / RATE_LIMITED
-- ---------------------------------------------------------------------
create or replace function fm_verify(p_team int, p_hash text, p_ip text) returns text
language plpgsql security definer set search_path = public as $$
declare t fm_teams%rowtype;
begin
  if fm_ip_blocked(p_ip) then return 'RATE_LIMITED'; end if;

  select * into t from fm_teams where team_no = p_team for update;
  if not found then
    perform fm_ip_fail(p_ip);
    return 'INVALID';
  end if;

  if t.locked_until is not null and t.locked_until > now() then
    return 'RATE_LIMITED';
  end if;

  if t.code_hash is null or t.code_hash <> p_hash then
    perform fm_ip_fail(p_ip);
    if t.fail_count + 1 >= 5 then
      -- 5 wrong tries: lock 15 min, then 30, 60, 120 ... (max 24h)
      update fm_teams
         set fail_count = 0,
             lock_count = t.lock_count + 1,
             locked_until = now() + least(interval '15 minutes' * power(2, t.lock_count), interval '24 hours')
       where team_no = p_team;
    else
      update fm_teams set fail_count = t.fail_count + 1 where team_no = p_team;
    end if;
    return 'INVALID';
  end if;

  update fm_teams set fail_count = 0, lock_count = 0, locked_until = null where team_no = p_team;
  if t.completed_at is not null then return 'ALREADY_COMPLETED'; end if;
  return 'VERIFIED';
end $$;

-- ---------------------------------------------------------------------
-- THE FIRST MOVE. One time per team, ever. Returns SUCCESS / ALREADY_COMPLETED
--
-- >>> ALLOCATION LOGIC LIVES HERE (and only here). <<<
-- Current rule: take one random free slot from fm_pool.
-- If the pool is empty the move is still locked in and the result stays
-- blank until the organiser fills it from the admin page.
-- ---------------------------------------------------------------------
create or replace function fm_make_move(p_team int) returns text
language plpgsql security definer set search_path = public as $$
declare t fm_teams%rowtype; v_slot bigint; v_result text;
begin
  select * into t from fm_teams where team_no = p_team for update;
  if not found then return 'ERROR'; end if;
  if t.completed_at is not null then return 'ALREADY_COMPLETED'; end if;

  select id, result into v_slot, v_result
    from fm_pool where taken_by is null
   order by random() limit 1
     for update skip locked;

  if v_slot is not null then
    update fm_pool set taken_by = p_team where id = v_slot;
  end if;

  update fm_teams
     set completed_at = now(),
         hidden_result = v_result,
         draw_seed = 100000 + floor(random() * 900000)::int
   where team_no = p_team;
  return 'SUCCESS';
end $$;

-- ---------------------------------------------------------------------
-- Organiser (admin) functions
-- ---------------------------------------------------------------------
create or replace function fm_admin_list() returns json
language sql security definer set search_path = public as $$
  select json_build_object(
    'teams', (select json_agg(row_to_json(x) order by x.team_no) from (
        select team_no,
               code_hash is not null as has_code,
               completed_at, hidden_result, draw_seed,
               (locked_until is not null and locked_until > now()) as locked
          from fm_teams) x),
    'pool', (select coalesce(json_agg(row_to_json(p) order by p.result), '[]'::json) from (
        select result,
               count(*) filter (where taken_by is null) as free,
               count(*) as total
          from fm_pool group by result) p)
  );
$$;

create or replace function fm_admin_set_codes(p_codes jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare e jsonb; n int := 0;
begin
  for e in select * from jsonb_array_elements(p_codes) loop
    update fm_teams
       set code_hash = e->>'hash', fail_count = 0, lock_count = 0, locked_until = null
     where team_no = (e->>'team')::int;
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- Replace all UNUSED slots with a new list. Slots already taken by a team are kept.
create or replace function fm_admin_set_pool(p_results text[]) returns int
language plpgsql security definer set search_path = public as $$
begin
  delete from fm_pool where taken_by is null;
  insert into fm_pool (result)
  select trim(r) from unnest(p_results) r where trim(r) <> '';
  return (select count(*) from fm_pool where taken_by is null);
end $$;

-- Give a result to teams that already moved while the pool was empty (in the order they moved).
create or replace function fm_admin_fill_blanks() returns int
language plpgsql security definer set search_path = public as $$
declare r record; v_slot bigint; v_result text; n int := 0;
begin
  for r in select team_no from fm_teams
            where completed_at is not null and hidden_result is null
            order by completed_at loop
    select id, result into v_slot, v_result
      from fm_pool where taken_by is null order by random() limit 1 for update;
    exit when v_slot is null;
    update fm_pool set taken_by = r.team_no where id = v_slot;
    update fm_teams set hidden_result = v_result where team_no = r.team_no;
    n := n + 1;
    v_slot := null;
  end loop;
  return n;
end $$;

-- Manually set / overwrite one team's hidden result.
create or replace function fm_admin_set_result(p_team int, p_result text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update fm_pool set taken_by = null where taken_by = p_team;
  update fm_teams set hidden_result = nullif(trim(p_result), '') where team_no = p_team;
end $$;

-- Wipe one team's move so it can be done again (for testing before launch).
create or replace function fm_admin_reset_team(p_team int) returns void
language plpgsql security definer set search_path = public as $$
begin
  update fm_pool set taken_by = null where taken_by = p_team;
  update fm_teams
     set completed_at = null, hidden_result = null, draw_seed = null,
         fail_count = 0, lock_count = 0, locked_until = null
   where team_no = p_team;
end $$;

create or replace function fm_admin_unlock(p_team int) returns void
language sql security definer set search_path = public as $$
  update fm_teams set fail_count = 0, lock_count = 0, locked_until = null where team_no = p_team;
  delete from fm_ip_fails;
$$;

-- Only the server key may call these functions.
do $$
declare f text;
begin
  for f in select oid::regprocedure::text from pg_proc
            where proname like 'fm\_%' and pronamespace = 'public'::regnamespace loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
