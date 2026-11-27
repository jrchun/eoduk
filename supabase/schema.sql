-- =====================================================================
-- 어둑시니 Supabase 스키마 v3 (개척형 · 2개 연합 · 등불 정령). 여러 번 실행해도 안전하다.
-- 처음부터: 이 파일 → supabase/seed.sql(구·칸 목록, scripts/build_map.mjs가 만든다) → select private.init_world();
--
-- 규칙은 화면이 아니라 여기(함수)에 있다. 화면은 공개 키(publishable)로 접속하므로
-- 표는 읽기만 열고, 쓰기는 모두 security definer 함수(join_game, settle, send_march, reinforce …)로만 한다.
-- 계산 숫자는 web/js/rules.js의 BAL과 같다. 하나를 바꾸면 둘 다 고친다. 내부 함수는 API에 드러나지 않는 private 스키마.
--
-- 칸 상태: 어둠(미개척) = owner null & gray false / 등불 = owner 있음 / 잿빛 = owner null & gray true
-- 연합: gus.side (n = 강북 3구 연합, s = 강남 3구 연합). 칸 색·구별 점수는 구, 승패는 연합.
-- =====================================================================

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------- 고정 데이터 ----------
create table if not exists public.gus (
  id text primary key, name text not null, short text not null,
  type text not null check (type in ('river', 'mount', 'city', 'village', 'legend')),
  side text not null check (side in ('n', 's'))
);
-- 열린 구(시범 전선)만 게임에 쓴다. 봉인된 구는 화면에 지도로만 보이고 "열어 주세요" 투표를 받는다.
alter table public.gus add column if not exists open boolean not null default true;
create table if not exists public.tile_defs (
  id int primary key, q int not null, r int not null,
  kind text not null check (kind in ('land', 'river', 'bridge')),
  home_gu text references public.gus (id), name text not null,
  edge boolean not null default false, landmark boolean not null default false,
  hall_gu text references public.gus (id),   -- 구청 칸(시즌 시작 때 켜진 유일한 칸, 꺼지거나 빼앗기지 않는다)
  effect text,                               -- 랜드마크 효과: prod+5, speed+10, nightres+10, sight+2
  unique (q, r)
);
create table if not exists public.tile_adj (a int not null references public.tile_defs (id), b int not null references public.tile_defs (id), primary key (a, b));

-- ---------- 움직이는 데이터 ----------
create table if not exists public.tiles (
  id int primary key references public.tile_defs (id),
  owner text references public.gus (id),
  defense int not null default 0 check (defense between 0 and 300),
  gray boolean not null default false,
  progress jsonb not null default '{}',      -- 개척 진행도 {구: 병력}. 자정에 사라진다
  updated_at timestamptz not null default now()
);
create table if not exists public.players (
  id uuid primary key,                       -- 사람은 auth.users의 id, 등불 정령은 임의 id
  nickname text not null check (char_length(nickname) between 1 and 12),
  gu text references public.gus (id),
  season date,
  troops double precision not null default 0,
  troops_at timestamptz not null default now(),
  contrib int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.players add column if not exists is_npc boolean not null default false;
alter table public.players add column if not exists last_action_at timestamptz;
alter table public.players add column if not exists npc_next_at timestamptz;
alter table public.players drop constraint if exists players_id_fkey;
drop index if exists public.players_nickname_unique;
-- 닉네임은 겹칠 수 없다(대소문자·앞뒤 공백 무시). 등불 정령은 모두 '등불 정령'이라 빼고 센다.
create unique index if not exists players_nickname_unique_human on public.players (lower(btrim(nickname))) where not is_npc;
create table if not exists public.marches (
  id bigint generated always as identity primary key,
  season date not null, player uuid not null references public.players (id) on delete cascade,
  gu text not null references public.gus (id),
  src int not null references public.tile_defs (id), dst int not null references public.tile_defs (id),
  troops int not null check (troops > 0), torch real not null, power real not null,
  kind text not null default 'attack' check (kind in ('settle', 'attack', 'reinforce')),
  npc boolean not null default false,
  created_at timestamptz not null default now(), arrive_at timestamptz not null,
  status text not null default 'moving' check (status in ('moving', 'won', 'lost', 'merged', 'void'))
);
create index if not exists marches_moving on public.marches (arrive_at) where status = 'moving';
create table if not exists public.events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(), season date not null,
  kind text not null check (kind in ('capture', 'repel', 'settle', 'gray')),
  tile int not null references public.tile_defs (id), gu text, other_gu text, n int, npc boolean not null default false
);
create index if not exists events_at on public.events (at desc);
create table if not exists public.daily (
  date date not null, gu text not null references public.gus (id), season date not null,
  tiles int not null, settled int not null default 0, kept_ratio real, score int not null default 0,
  primary key (date, gu)
);
create table if not exists public.seasons (id date primary key, winner text references public.gus (id), result jsonb, closed_at timestamptz default now());
alter table public.seasons add column if not exists winner_side text;
create table if not exists public.flags (
  player uuid not null references public.players (id) on delete cascade, date date not null,
  gu text not null, tile int not null references public.tile_defs (id), primary key (player, date)
);
create table if not exists public.presence (player uuid primary key references public.players (id) on delete cascade, tile int, seen_at timestamptz not null default now());
create table if not exists public.acts (  -- 행동 기록(운영 지표, 정령 비율 제한). 지표는 npc = false만으로 센다
  id bigint generated always as identity primary key, at timestamptz not null default now(),
  side text not null, gu text not null, npc boolean not null default false, kind text not null
);
create index if not exists acts_at on public.acts (at desc);
create table if not exists public.gu_votes (
  voter uuid not null references auth.users (id) on delete cascade, gu text not null references public.gus (id),
  created_at timestamptz not null default now(), primary key (voter, gu)
);
create table if not exists public.game_state (id int primary key check (id = 1), tick_date date not null, tick_done int not null default 0, season date not null);

-- ---------- 권한: 읽기는 공개, 쓰기는 함수로만 ----------
do $$ declare t text; begin
  foreach t in array array['gus', 'tile_defs', 'tile_adj', 'tiles', 'players', 'marches', 'events', 'daily', 'seasons', 'flags', 'presence', 'acts', 'gu_votes', 'game_state'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
  foreach t in array array['gus', 'tile_defs', 'tile_adj', 'tiles', 'marches', 'events', 'daily', 'seasons'] loop
    execute format('drop policy if exists "누구나 읽기" on public.%I', t);
    execute format('create policy "누구나 읽기" on public.%I for select to anon, authenticated using (true)', t);
  end loop;
end $$;
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
drop policy if exists "내 정보 읽기" on public.players;
create policy "내 정보 읽기" on public.players for select to authenticated using (id = (select auth.uid()));
-- 깃발은 같은 연합끼리만 본다(적에게 목표가 새지 않게)
drop policy if exists "우리 구 깃발 읽기" on public.flags;
drop policy if exists "우리 연합 깃발 읽기" on public.flags;
create policy "우리 연합 깃발 읽기" on public.flags for select to authenticated
  using ((select side from public.gus where id = flags.gu) = (select g.side from public.players p join public.gus g on g.id = p.gu where p.id = (select auth.uid())));

-- 실시간(Realtime): 칸과 진군이 바뀌면 화면에 바로 알린다
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'tiles') then alter publication supabase_realtime add table public.tiles; end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'marches') then alter publication supabase_realtime add table public.marches; end if;
end $$;

-- =====================================================================
-- 시간: 실제 서울 일출·일몰(suncalc와 같은 식, web/js/rules.js sunTimes)
-- =====================================================================
create or replace function private.kst_date(ts timestamptz) returns date
language sql immutable set search_path = '' as $$ select (ts at time zone 'Asia/Seoul')::date $$;
create or replace function private.kst_midnight(d date) returns timestamptz
language sql immutable set search_path = '' as $$ select (d::timestamp) at time zone 'Asia/Seoul' $$;
create or replace function private.season_of(d date) returns date
language sql immutable set search_path = '' as $$ select d - (extract(isodow from d)::int - 1) $$;

create or replace function private.sun_times(d date, out sunrise timestamptz, out sunset timestamptz)
language plpgsql immutable set search_path = '' as $$
declare
  rad double precision := pi() / 180;
  lw double precision := rad * -126.978;
  phi double precision := rad * 37.5665;
  e double precision := rad * 23.4397;
  noon double precision := extract(epoch from ((d::timestamp + interval '12 hours') at time zone 'Asia/Seoul'));
  dd double precision; n double precision; ds double precision; m double precision; c double precision;
  l double precision; dec double precision; jnoon double precision; w double precision; jset double precision; jrise double precision;
begin
  dd := noon / 86400.0 - 0.5 + 2440588 - 2451545;
  n := round(dd - 0.0009 - lw / (2 * pi()));
  ds := 0.0009 + lw / (2 * pi()) + n;
  m := rad * (357.5291 + 0.98560028 * ds);
  c := rad * (1.9148 * sin(m) + 0.02 * sin(2 * m) + 0.0003 * sin(3 * m));
  l := m + c + rad * 102.9372 + pi();
  dec := asin(sin(e) * sin(l));
  jnoon := 2451545 + ds + 0.0053 * sin(m) - 0.0069 * sin(2 * l);
  w := acos((sin(-0.833 * rad) - sin(phi) * sin(dec)) / (cos(phi) * cos(dec)));
  jset := 2451545 + (0.0009 + (w + lw) / (2 * pi()) + n) + 0.0053 * sin(m) - 0.0069 * sin(2 * l);
  jrise := jnoon - (jset - jnoon);
  sunrise := to_timestamp((jrise + 0.5 - 2440588) * 86400);
  sunset := to_timestamp((jset + 0.5 - 2440588) * 86400);
end $$;

create or replace function private.phase_at(ts timestamptz) returns jsonb
language plpgsql stable set search_path = '' as $$
declare d date := private.kst_date(ts); st record; mid timestamptz; len interval; k int; ph text;
begin
  select * into st from private.sun_times(d);
  mid := private.kst_midnight(d + 1);
  len := (mid - st.sunset) / 8;
  if ts < st.sunrise then ph := 'seal'; k := 0;
  elsif ts < st.sunset then ph := 'day'; k := 0;
  else ph := 'night'; k := least(8, floor(extract(epoch from ts - st.sunset) / extract(epoch from len))::int);
  end if;
  return jsonb_build_object('phase', ph, 'date', d, 'sunrise', st.sunrise, 'sunset', st.sunset, 'midnight', mid,
    'tick', k, 'next_tick', case when ph = 'night' then st.sunset + len * (k + 1) end,
    'season', private.season_of(d), 'day', extract(isodow from d)::int, 'long_night', extract(isodow from d) = 7,
    'rush', ph = 'day' and st.sunset - ts <= interval '30 minutes');
end $$;

-- =====================================================================
-- 규칙 도우미
-- =====================================================================
create or replace function private.gu_type(g text) returns text
language sql stable set search_path = '' as $$ select type from public.gus where id = g $$;
create or replace function private.gu_side(g text) returns text
language sql stable set search_path = '' as $$ select side from public.gus where id = g $$;
create or replace function private.side_name(sd text) returns text
language sql immutable set search_path = '' as $$ select case sd when 'n' then '강북 3구 연합' when 's' then '강남 3구 연합' end $$;
create or replace function private.hex_dist(a int, b int) returns int
language sql stable set search_path = '' as $$
  select (abs(x.q - y.q) + abs(x.r - y.r) + abs(x.q + x.r - y.q - y.r)) / 2 from public.tile_defs x, public.tile_defs y where x.id = a and y.id = b
$$;
-- 칸 t에 붙은 연합 sd의 등불 칸 수(연결 보너스·인접 판정)
create or replace function private.side_neighbors(t int, sd text) returns int
language sql stable set search_path = '' as $$
  select count(*)::int from public.tile_adj a join public.tiles n on n.id = a.b join public.gus g on g.id = n.owner where a.a = t and g.side = sd
$$;
-- 연합이 가진 랜드마크 효과 합(종류별 최대 15%, 시야는 칸 수)
create or replace function private.side_mods(sd text, out prod double precision, out speed double precision, out nightres double precision, out sight int)
language sql stable set search_path = '' as $$
  select least(0.15, coalesce(sum(case when split_part(d.effect, '+', 1) = 'prod' then split_part(d.effect, '+', 2)::int end), 0) / 100.0),
         least(0.15, coalesce(sum(case when split_part(d.effect, '+', 1) = 'speed' then split_part(d.effect, '+', 2)::int end), 0) / 100.0),
         least(0.15, coalesce(sum(case when split_part(d.effect, '+', 1) = 'nightres' then split_part(d.effect, '+', 2)::int end), 0) / 100.0),
         coalesce(sum(case when split_part(d.effect, '+', 1) = 'sight' then split_part(d.effect, '+', 2)::int end), 0)::int
  from public.tiles t join public.tile_defs d on d.id = t.id join public.gus g on g.id = t.owner
  where d.effect is not null and g.side = sd
$$;
-- 인원 보정: 1/√(구 인원 ÷ 열린 구 평균), 0.7~1.3. 사람만 센다(정령 제외)
create or replace function private.pop_factor(g text) returns double precision
language plpgsql stable set search_path = '' as $$
declare s date := private.season_of(private.kst_date(now())); n double precision; total double precision; avg double precision;
begin
  select count(*) filter (where gu = g), count(*) into n, total from public.players where season = s and not is_npc;
  avg := total / greatest(1, (select count(*) from public.gus where open));
  if n = 0 or avg = 0 then return 1; end if;
  return least(1.3, greatest(0.7, 1 / sqrt(n / avg)));
end $$;
create or replace function private.prod_rate(g text, ph text) returns double precision
language sql stable set search_path = '' as $$
  select 30.0 * (case when ph = 'day' then 1 else 0.5 end)
    * (case private.gu_type(g) when 'village' then 1.2 when 'mount' then 0.9 else 1 end) * private.pop_factor(g)
    * (1 + coalesce((select prod from private.side_mods(private.gu_side(g))), 0))
$$;
create or replace function private.troops_now(p public.players) returns double precision
language sql stable set search_path = '' as $$
  select least(90.0, greatest(p.troops, p.troops + extract(epoch from now() - p.troops_at) / 3600.0
    * private.prod_rate(p.gu, private.phase_at(now()) ->> 'phase')))
$$;
-- 방어력(web/js/rules.js defensePower). 연결 보너스는 같은 연합 칸 기준
create or replace function private.def_power(t public.tiles) returns double precision
language plpgsql stable set search_path = '' as $$
declare ty text; p double precision := t.defense * 1.2; br boolean;
begin
  if t.owner is null then return p; end if;
  ty := private.gu_type(t.owner);
  select kind = 'bridge' into br from public.tile_defs where id = t.id;
  p := p * (1 + least(0.30, 0.05 * private.side_neighbors(t.id, private.gu_side(t.owner))));
  if ty = 'mount' then p := p * 1.15; end if;
  if br and ty = 'river' then p := p * 1.3; end if;
  return p;
end $$;
-- 개척 필요 병력 = 20 + 5 × 내 구 구청까지 칸 거리 (+다리 10, 잿빛 칸은 절반)
create or replace function private.settle_need(dst int, g text) returns int
language sql stable set search_path = '' as $$
  select ceil((20 + 5 * coalesce(private.hex_dist(dst, (select id from public.tile_defs where hall_gu = g)), 0)
    + case when d.kind = 'bridge' then (case when d.name in ('여의교', '서울교') then 45 else 10 end) else 0 end) * case when t.gray then 0.5 else 1 end)::int
  from public.tile_defs d join public.tiles t on t.id = d.id where d.id = dst
$$;
-- 진군·개척 시간(분): 10 + 3 × 거리(최대 40) × 구 유형 × (1 - speed 효과), 잿빛 칸 절반
create or replace function private.march_minutes(src int, dst int, g text) returns double precision
language plpgsql stable set search_path = '' as $$
declare ty text := private.gu_type(g); t public.tiles; m double precision;
begin
  select * into t from public.tiles where id = dst;
  m := least(40, 10 + 3 * private.hex_dist(src, dst));
  m := m * case ty when 'city' then 0.75 when 'village' then 1.15 else 1 end;
  if ty = 'river' and private.gu_type(t.owner) = 'mount' then m := m * 1.2; end if;
  if t.gray then m := m * 0.5; end if;
  m := m * (1 - coalesce((select speed from private.side_mods(private.gu_side(g))), 0));
  return greatest(1, round(m));
end $$;
-- 출발 칸: 목표에 가장 가까운 연합 등불 칸
create or replace function private.nearest_lit(dst int, sd text) returns int
language sql stable set search_path = '' as $$
  select t.id from public.tiles t join public.gus g on g.id = t.owner where g.side = sd
  order by private.hex_dist(t.id, dst), t.defense desc limit 1
$$;
create or replace function private.log_act(p public.players, k text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.acts (side, gu, npc, kind) values (private.gu_side(p.gu), p.gu, p.is_npc, k);
  if not p.is_npc then update public.players set last_action_at = now() where id = p.id; end if;
end $$;

-- =====================================================================
-- 세계 초기화(시즌 시작): 도시 전체가 어둠, 구청 칸만 켜진다
-- =====================================================================
create or replace function private.reset_world() returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.tiles (id) select id from public.tile_defs where kind <> 'river' on conflict (id) do nothing;
  update public.tiles t set owner = d.hall_gu, defense = case when d.hall_gu is not null then 100 else 0 end,
    gray = false, progress = '{}', updated_at = now()
  from public.tile_defs d where d.id = t.id;
  update public.marches set status = 'void' where status = 'moving';
  delete from public.presence;
  delete from public.players where is_npc;
end $$;

-- 진군·개척 도착 판정(지연 계산: 누가 화면을 열거나 예약 작업이 돌 때 도착 시각이 지난 것부터 차례로)
create or replace function private.resolve_marches(upto timestamptz) returns int
language plpgsql security definer set search_path = '' as $$
declare m record; t public.tiles; d public.tile_defs; sd text; dp double precision; atk double precision; hold int; done int := 0;
  prog jsonb; total int; top text; need int;
begin
  for m in select * from public.marches where status = 'moving' and arrive_at <= upto order by arrive_at, id for update loop
    select * into t from public.tiles where id = m.dst for update;
    select * into d from public.tile_defs where id = m.dst;
    sd := private.gu_side(m.gu);
    if t.owner is not null and private.gu_side(t.owner) = sd then
      -- 그사이 우리 연합이 켰다 → 증원으로 합류
      update public.tiles set defense = least(300, defense + m.troops), updated_at = m.arrive_at where id = t.id;
      update public.marches set status = 'merged' where id = m.id;
    elsif t.owner is not null then
      -- 다른 연합 칸 → 공격 판정(구청 칸은 빼앗을 수 없다)
      dp := private.def_power(t);
      atk := m.power * (0.9 + 0.2 * random());
      if atk > dp and d.hall_gu is null then
        hold := least(300, greatest(10, round(m.troops * (atk - dp) / atk)::int));
        update public.tiles set owner = m.gu, defense = hold, gray = false, progress = '{}', updated_at = m.arrive_at where id = t.id;
        update public.marches set status = 'won' where id = m.id;
        if not m.npc then update public.players set contrib = contrib + 20 where id = m.player; end if;
        insert into public.events (at, season, kind, tile, gu, other_gu, n, npc) values (m.arrive_at, m.season, 'capture', t.id, m.gu, t.owner, hold, m.npc);
      else
        update public.tiles set defense = greatest(case when d.hall_gu is null then 0 else 1 end, round(t.defense * (1 - least(1, atk / dp)))::int), updated_at = m.arrive_at where id = t.id;
        update public.marches set status = 'lost' where id = m.id;
        insert into public.events (at, season, kind, tile, gu, other_gu, n, npc) values (m.arrive_at, m.season, 'repel', t.id, t.owner, m.gu, m.troops, m.npc);
      end if;
    else
      -- 어둠·잿빛 → 개척: 진행도에 보태고, 연합 합계가 필요 병력 이상이면 가장 많이 보낸 구의 칸으로 켠다
      prog := jsonb_set(t.progress, array[m.gu], to_jsonb(coalesce((t.progress ->> m.gu)::int, 0) + m.troops));
      select coalesce(sum(e.value::int), 0) into total from jsonb_each_text(prog) e join public.gus g on g.id = e.key where g.side = sd;
      select e.key into top from jsonb_each_text(prog) e join public.gus g on g.id = e.key where g.side = sd order by e.value::int desc, e.key limit 1;
      need := private.settle_need(t.id, top);
      -- 랜드마크 칸은 정령의 병력만으로는 켜지지 않는다(마지막은 사람이)
      if total >= need and not (d.effect is not null and m.npc) then
        update public.tiles set owner = top, defense = greatest(10, total - need), gray = false, progress = '{}', updated_at = m.arrive_at where id = t.id;
        update public.marches set status = 'won' where id = m.id;
        if not m.npc then update public.players set contrib = contrib + 10 where id = m.player; end if;
        insert into public.events (at, season, kind, tile, gu, n, npc) values (m.arrive_at, m.season, 'settle', t.id, top, total, m.npc);
      else
        update public.tiles set progress = prog, updated_at = m.arrive_at where id = t.id;
        update public.marches set status = 'merged' where id = m.id;
      end if;
    end if;
    done := done + 1;
  end loop;
  return done;
end $$;

-- 밤 침식 한 번(k = 1~8). 어둠(미개척·지난밤까지 잿빛·지도 밖)과 맞닿은 등불 칸 = 개척지 가장자리. 구청은 먹히지 않는다
create or replace function private.night_tick(d date, k int, tt timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare mult double precision := case when extract(isodow from d) = 7 then 1.5 else 1 end;
  dusk timestamptz := (private.sun_times(d)).sunset;
begin
  create temp table if not exists _erode (id int, owner text, p double precision, res double precision, def int) on commit drop;
  truncate _erode;
  insert into _erode
  select t.id, t.owner,
    (30 + 10 * k) * mult + least(30, 3 * coalesce(w.n, 0)),
    1.2 * case g.type when 'legend' then 1.25 when 'city' then 0.85 else 1 end * (1 + coalesce((select nightres from private.side_mods(g.side)), 0)),
    t.defense
  from public.tiles t
  join public.tile_defs td on td.id = t.id
  join public.gus g on g.id = t.owner
  -- 응시: 그 칸을 본 로그인한 사람(정령 제외) 고유 수
  left join (select pr.tile, count(distinct pr.player) as n from public.presence pr join public.players pl on pl.id = pr.player
             where not pl.is_npc and pr.seen_at >= tt - interval '3 minutes' group by pr.tile) w on w.tile = t.id
  where td.hall_gu is null
    and (td.edge or exists (select 1 from public.tile_adj a join public.tiles n on n.id = a.b
         where a.a = t.id and n.owner is null and (not n.gray or n.updated_at < dusk)));

  insert into public.events (at, season, kind, tile, gu, n)
  select tt, private.season_of(d), 'gray', id, owner, round(p)::int from _erode where p > def * res;
  update public.tiles t set
    owner = case when e.p > e.def * e.res then null else t.owner end,
    gray = e.p > e.def * e.res,
    progress = case when e.p > e.def * e.res then '{}'::jsonb else t.progress end,
    defense = case when e.p > e.def * e.res then 0 else greatest(0, round(e.def - e.p * 0.25 / e.res)::int) end,
    updated_at = tt
  from _erode e where e.id = t.id;
end $$;

-- 자정: 구별 오늘의 성적(밝힌 칸·지킨 비율·점수) 기록, 개척 진행도 비우기. 일요일 밤이면 시즌 정산 후 세계 초기화
create or replace function private.close_night(d date) returns void
language plpgsql security definer set search_path = '' as $$
declare dusk timestamptz := (private.sun_times(d)).sunset; mid timestamptz := private.kst_midnight(d + 1); res jsonb; win text; wside text;
begin
  insert into public.daily (date, gu, season, tiles, settled, kept_ratio, score)
  select d, g.id, private.season_of(d), x.lit,
    (select count(*) from public.events e where e.kind = 'settle' and e.gu = g.id and e.at >= private.kst_midnight(d) and e.at < mid),
    case when x.lit + x.lost > 0 then x.lit::real / (x.lit + x.lost) else 1 end,
    x.lit + 3 * x.lm
  from public.gus g, lateral (select
      (select count(*) from public.tiles t where t.owner = g.id)::int as lit,
      (select count(*) from public.tiles t join public.tile_defs td on td.id = t.id where t.owner = g.id and td.effect is not null)::int as lm,
      (select count(*) from public.events e where e.kind = 'gray' and e.gu = g.id and e.at >= dusk and e.at <= mid)::int as lost) x
  where g.open
  on conflict (date, gu) do update set tiles = excluded.tiles, settled = excluded.settled, kept_ratio = excluded.kept_ratio, score = excluded.score;
  update public.tiles set progress = '{}' where progress <> '{}';
  if extract(isodow from d) = 7 then
    select jsonb_build_object('sides', (select jsonb_object_agg(side, sc) from (select g.side, sum(dl.score) as sc from public.daily dl join public.gus g on g.id = dl.gu where dl.date = d group by g.side) a),
                              'gus', (select jsonb_object_agg(gu, score) from public.daily where date = d)) into res;
    select g.side into wside from public.daily dl join public.gus g on g.id = dl.gu where dl.date = d group by g.side order by sum(dl.score) desc, g.side limit 1;
    select gu into win from public.daily where date = d order by score desc, gu limit 1;
    insert into public.seasons (id, winner, winner_side, result) values (private.season_of(d), win, wside, res)
    on conflict (id) do update set winner = excluded.winner, winner_side = excluded.winner_side, result = excluded.result, closed_at = now();
    perform private.reset_world();
  end if;
end $$;

-- =====================================================================
-- 등불 정령(NPC): 사람이 적을 때 함께 움직이는 보조 플레이어. 사람인 척하지 않는다(닉네임 '등불 정령', npc 표시)
-- 사람과 같은 규칙·같은 병력 생산. 연합마다 max(0, 8 - 최근 24시간 활동한 사람), 최대 6. 양쪽 연합에 같은 규칙
-- =====================================================================
-- 다음 접속 시각: 08~20시(한국 시각) 사이 2~3시간마다(하루 4~6번)
create or replace function private.npc_next(ts timestamptz) returns timestamptz
language plpgsql volatile set search_path = '' as $$
declare nx timestamptz := ts + make_interval(mins => (120 + floor(random() * 60))::int); h int;
begin
  h := extract(hour from nx at time zone 'Asia/Seoul');
  if h >= 20 or h < 8 then
    nx := private.kst_midnight(private.kst_date(nx) + case when h >= 20 then 1 else 0 end) + interval '8 hours' + make_interval(mins => floor(random() * 90)::int);
  end if;
  return nx;
end $$;

create or replace function private.npc_manage() returns void
language plpgsql security definer set search_path = '' as $$
declare sd text; s date := private.season_of(private.kst_date(now())); active int; want int; cur int; p public.players; g text;
begin
  foreach sd in array array['n', 's'] loop
    select count(*) into active from public.players pl join public.gus gg on gg.id = pl.gu
      where gg.side = sd and not pl.is_npc and pl.season = s and pl.last_action_at > now() - interval '24 hours';
    want := least(6, greatest(0, 8 - active));
    select count(*) into cur from public.players pl join public.gus gg on gg.id = pl.gu where gg.side = sd and pl.is_npc and pl.season = s;
    if cur > want then  -- 하나씩 은퇴: 남은 병력은 그 구 구청 칸 수비로
      select pl.* into p from public.players pl join public.gus gg on gg.id = pl.gu where gg.side = sd and pl.is_npc and pl.season = s order by pl.created_at limit 1;
      update public.tiles set defense = least(300, defense + floor(private.troops_now(p))::int) where id = (select id from public.tile_defs where hall_gu = p.gu);
      delete from public.players where id = p.id;
    elsif cur < want then  -- 하나씩 생성: 그 연합에서 사람이 가장 적은 구
      select gg.id into g from public.gus gg where gg.side = sd and gg.open
        order by (select count(*) from public.players pl where pl.gu = gg.id and pl.season = s and not pl.is_npc),
                 (select count(*) from public.players pl where pl.gu = gg.id and pl.season = s and pl.is_npc), gg.id limit 1;
      insert into public.players (id, nickname, gu, season, troops, troops_at, is_npc, npc_next_at)
      values (gen_random_uuid(), '등불 정령', g, s, 60, now(), true, private.npc_next(now() - interval '100 minutes'));
    end if;
  end loop;
end $$;

-- 정령이 진군·개척을 보낸다(사람의 send_march·settle과 같은 판정)
create or replace function private.npc_send(p public.players, dst int, n int, k text, tor real) returns boolean
language plpgsql security definer set search_path = '' as $$
declare sd text := private.gu_side(p.gu); src int; mins double precision; arrive timestamptz; ph jsonb := private.phase_at(now());
begin
  src := private.nearest_lit(dst, sd);
  if src is null or n < 1 then return false; end if;
  mins := private.march_minutes(src, dst, p.gu);
  arrive := now() + make_interval(mins => mins::int);
  if arrive > (ph ->> 'sunset')::timestamptz then return false; end if;
  update public.players set troops = private.troops_now(p) - n, troops_at = now() where id = p.id;
  insert into public.marches (season, player, gu, src, dst, troops, torch, power, kind, npc, arrive_at)
  values (p.season, p.id, p.gu, src, dst, n, tor, n * (0.8 + 0.4 * tor) * case when private.gu_type(p.gu) = 'legend' then 0.9 else 1 end, k, true, arrive);
  perform private.log_act(p, k);
  return true;
end $$;

create or replace function private.npc_act(p public.players) returns void
language plpgsql security definer set search_path = '' as $$
declare sd text := private.gu_side(p.gu); ph text := private.phase_at(now()) ->> 'phase'; have int := floor(private.troops_now(p));
  today timestamptz := private.kst_midnight(private.kst_date(now())); npc_n int; hum_n int; npcs int; cap double precision;
  m record; tgt int; need int; t public.tiles; addn int; hall int;
begin
  -- 정령 비율 제한: 정령 행동 ≤ 연합 하루 행동의 40%(= 사람 행동의 2/3). 사람이 아주 적을 때는 정령 1명당 하루 2번까지 허용
  select count(*) filter (where npc), count(*) filter (where not npc) into npc_n, hum_n from public.acts where side = sd and at >= today;
  select count(*) into npcs from public.players pl join public.gus g on g.id = pl.gu where g.side = sd and pl.is_npc;
  cap := greatest(hum_n * 2.0 / 3.0, 2 * npcs);
  if npc_n >= cap or have < 5 then return; end if;
  if ph = 'day' then
    -- 1) 우리 연합 칸으로 30분 안에 오는 공격: 50% 확률로 필요한 만큼 증원
    select mm.* into m from public.marches mm join public.tiles tt on tt.id = mm.dst join public.gus g on g.id = tt.owner
      where mm.status = 'moving' and mm.kind <> 'settle' and g.side = sd and private.gu_side(mm.gu) <> sd
        and mm.arrive_at between now() + interval '5 minutes' and now() + interval '30 minutes' order by mm.arrive_at limit 1;
    if m.id is not null and random() < 0.5 then
      select * into t from public.tiles where id = m.dst;
      addn := least(have, 300 - t.defense, greatest(5, ceil((m.power * 1.1 - private.def_power(t)) / 1.2)::int + 5));
      if addn > 0 then
        update public.tiles set defense = defense + addn where id = t.id;
        update public.players set troops = private.troops_now(p) - addn, troops_at = now() where id = p.id;
        perform private.log_act(p, 'reinforce');
        return;
      end if;
    end if;
    -- 3) 20%: 경계에서 가장 약한 적 칸 공격(이길 확률이 높을 때만)
    if random() < 0.2 then
      select tt.id into tgt from public.tiles tt join public.tile_defs td on td.id = tt.id join public.gus g on g.id = tt.owner
        where g.side <> sd and td.hall_gu is null and private.side_neighbors(tt.id, sd) > 0
          and have * 1.2 * 0.9 > private.def_power(tt) order by private.def_power(tt) limit 1;
      if tgt is not null and private.npc_send(p, tgt, have, 'attack', 1.0) then return; end if;
    end if;
    -- 2) 개척: 깃발이 가장 많은 칸 → 가까운 랜드마크 → 구청에서 가까운 어둠 칸
    select id into hall from public.tile_defs where hall_gu = p.gu;
    select c.id into tgt from (
      select tt.id,
        (select count(*) from public.flags f join public.gus g2 on g2.id = f.gu where f.tile = tt.id and g2.side = sd and f.date = private.kst_date(now())) as fl,
        (td.effect is not null) as lm, private.hex_dist(tt.id, hall) as dist
      from public.tiles tt join public.tile_defs td on td.id = tt.id
      where tt.owner is null and private.side_neighbors(tt.id, sd) > 0) c
      order by c.fl desc, c.lm desc, c.dist, c.id limit 1;
    if tgt is not null then
      need := private.settle_need(tgt, p.gu);
      select coalesce(sum(e.value::int), 0) into addn from public.tiles tt, jsonb_each_text(tt.progress) e join public.gus g on g.id = e.key where tt.id = tgt and g.side = sd;
      need := greatest(5, need - addn + 5);
      if have >= least(need, 20) then perform private.npc_send(p, tgt, least(have, need), 'settle', 0.5); end if;
    end if;
  elsif ph = 'night' then
    -- 4) 밤: 침식 대상 중 가장 위험한(수비가 가장 낮은) 칸에 한 번 증원
    select tt.* into t from public.tiles tt join public.tile_defs td on td.id = tt.id join public.gus g on g.id = tt.owner
      where g.side = sd and td.hall_gu is null
        and (td.edge or exists (select 1 from public.tile_adj a join public.tiles n on n.id = a.b where a.a = tt.id and n.owner is null))
      order by tt.defense limit 1;
    if t.id is not null then
      addn := least(have / 2, 300 - t.defense);
      if addn > 0 then
        update public.tiles set defense = defense + addn where id = t.id;
        update public.players set troops = private.troops_now(p) - addn, troops_at = now() where id = p.id;
        perform private.log_act(p, 'reinforce');
      end if;
    end if;
  end if;
end $$;

create or replace function private.npc_step() returns void
language plpgsql security definer set search_path = '' as $$
declare p public.players; h int := extract(hour from now() at time zone 'Asia/Seoul');
begin
  perform private.npc_manage();
  for p in select * from public.players where is_npc and npc_next_at <= now() and season = private.season_of(private.kst_date(now())) loop
    if h >= 8 and h < 20 then perform private.npc_act(p); end if;
    update public.players set npc_next_at = private.npc_next(now()) where id = p.id;
  end loop;
end $$;

-- 시간이 지나 생긴 일을 모두 처리한다. 여러 번 불러도 안전하다(이미 한 일은 다시 하지 않는다).
create or replace function private.advance(wait boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.game_state; st record; mid timestamptz; tt timestamptz; today date := private.kst_date(now()); guard int := 0;
begin
  if wait then perform pg_advisory_xact_lock(4242);
  elsif not pg_try_advisory_xact_lock(4242) then return; end if;
  select * into s from public.game_state where id = 1 for update;
  if not found then return; end if;
  perform private.resolve_marches(now());
  if s.tick_date < today - 1 then s.tick_date := today - 1; s.tick_done := 0; end if;
  <<nights>> loop
    guard := guard + 1; exit when guard > 4;
    select * into st from private.sun_times(s.tick_date);
    mid := private.kst_midnight(s.tick_date + 1);
    while s.tick_done < 8 loop
      tt := st.sunset + (mid - st.sunset) * (s.tick_done + 1) / 8;
      exit nights when tt > now();
      perform private.night_tick(s.tick_date, s.tick_done + 1, tt);
      s.tick_done := s.tick_done + 1;
    end loop;
    perform private.close_night(s.tick_date);
    if extract(isodow from s.tick_date) = 7 then s.season := s.tick_date + 1; end if;
    s.tick_date := s.tick_date + 1; s.tick_done := 0;
  end loop;
  if s.season <> private.season_of(today) then
    perform private.reset_world(); s.season := private.season_of(today);
  end if;
  update public.game_state set tick_date = s.tick_date, tick_done = s.tick_done, season = s.season where id = 1;
  perform private.npc_step();
end $$;

-- 내 플레이어(이번 시즌). 없으면 오류.
create or replace function private.me() returns public.players
language plpgsql stable security definer set search_path = '' as $$
declare p public.players;
begin
  if auth.uid() is null then raise exception '로그인이 필요해요.' using errcode = 'P0001'; end if;
  select * into p from public.players where id = auth.uid();
  if not found or p.gu is null or p.season is distinct from private.season_of(private.kst_date(now())) then
    raise exception '이번 시즌의 구를 먼저 골라 주세요.' using errcode = 'P0001';
  end if;
  return p;
end $$;
create or replace function private.settle_troops(p public.players) returns double precision
language plpgsql security definer set search_path = '' as $$
declare n double precision := private.troops_now(p);
begin
  update public.players set troops = n, troops_at = now() where id = p.id;
  return n;
end $$;

-- =====================================================================
-- 화면이 부르는 함수(API). 모두 안에서 advance()를 먼저 부른다.
-- =====================================================================
create or replace function public.game_state() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.players; ph jsonb; me jsonb := null; flagtop jsonb := null; myflag int; sd text; mods record;
begin
  perform private.advance(false);
  ph := private.phase_at(now());
  if auth.uid() is not null then select * into p from public.players where id = auth.uid(); end if;
  if p.id is not null then
    sd := private.gu_side(p.gu);
    select * into mods from private.side_mods(sd);
    select tile into myflag from public.flags where player = p.id and date = private.kst_date(now());
    me := jsonb_build_object('nickname', p.nickname, 'gu', p.gu, 'side', sd, 'season', p.season,
      'active', p.gu is not null and p.season = (ph ->> 'season')::date,
      'troops', floor(private.troops_now(p)), 'rate', round(private.prod_rate(p.gu, ph ->> 'phase')::numeric, 1),
      'contrib', p.contrib, 'flag', myflag,
      'mods', jsonb_build_object('prod', mods.prod, 'speed', mods.speed, 'nightres', mods.nightres, 'sight', mods.sight));
    if p.gu is not null then
      select coalesce(jsonb_agg(jsonb_build_array(tile, n) order by n desc, tile), '[]') into flagtop from (
        select f.tile, count(*) as n from public.flags f join public.gus g on g.id = f.gu
        where g.side = sd and f.date = private.kst_date(now()) group by f.tile order by n desc, f.tile limit 3) f;
    end if;
  end if;
  return jsonb_build_object(
    'now', now(), 'phase', ph, 'me', me, 'flags', flagtop,
    'votes', (select coalesce(jsonb_object_agg(gu, n), '{}') from (select gu, count(*) as n from public.gu_votes group by gu) v),
    'my_votes', (select coalesce(jsonb_agg(gu), '[]') from public.gu_votes where voter = auth.uid()),
    -- 칸: [id, 주인, 수비, 잿빛, 연합별 개척 진행도 {n, s}]
    'tiles', (select jsonb_agg(jsonb_build_array(t.id, t.owner, t.defense, t.gray,
        case when t.progress = '{}' then null else (select jsonb_object_agg(x.side, x.s) from (select g.side, sum(e.value::int) as s from jsonb_each_text(t.progress) e join public.gus g on g.id = e.key group by g.side) x) end
      ) order by t.id) from public.tiles t),
    'marches', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'gu', gu, 'src', src, 'dst', dst, 'troops', troops, 'kind', kind, 'npc', npc,
      'torch', torch, 'created_at', created_at, 'arrive_at', arrive_at, 'mine', player = auth.uid()) order by arrive_at), '[]')
      from public.marches where status = 'moving'),
    'gus', (select jsonb_agg(jsonb_build_object('id', g.id, 'side', g.side,
      'players', (select count(*) from public.players x where x.gu = g.id and x.season = (ph ->> 'season')::date and not x.is_npc),
      'npcs', (select count(*) from public.players x where x.gu = g.id and x.season = (ph ->> 'season')::date and x.is_npc),
      'tiles', (select count(*) from public.tiles t where t.owner = g.id)) order by g.id) from public.gus g where g.open),
    'recent', (select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'tile', tile, 'gu', gu, 'other', other_gu, 'at', at, 'npc', npc) order by at desc), '[]')
      from (select * from public.events where at > now() - interval '30 minutes' order by at desc limit 12) e)
  );
end $$;

-- 구 고르기(시즌 중 변경 불가). 닉네임은 언제든 바꿀 수 있다.
create or replace function public.join_game(nick text, pick text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s date; p public.players; n int; total int; cnt int;
begin
  if auth.uid() is null then raise exception '로그인이 필요해요.' using errcode = 'P0001'; end if;
  nick := btrim(coalesce(nick, ''));
  if char_length(nick) < 1 or char_length(nick) > 12 then raise exception '닉네임은 1~12자로 정해 주세요.' using errcode = 'P0001'; end if;
  if nick = '등불 정령' then raise exception '등불 정령은 쓸 수 없는 이름이에요.' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.gus where id = pick and open) then raise exception '아직 열리지 않은 구예요.' using errcode = 'P0001'; end if;
  perform private.advance(true);
  s := private.season_of(private.kst_date(now()));
  select * into p from public.players where id = auth.uid();
  if exists (select 1 from public.players x where lower(btrim(x.nickname)) = lower(nick) and x.id <> auth.uid() and not x.is_npc) then
    raise exception '이미 누가 쓰는 닉네임이에요. 다른 이름을 골라 주세요.' using errcode = 'P0001';
  end if;
  if p.id is not null and p.season = s and p.gu is not null then
    if p.gu <> pick then raise exception '시즌 중에는 구를 바꿀 수 없어요.' using errcode = 'P0001'; end if;
    update public.players set nickname = nick where id = p.id;
    return jsonb_build_object('ok', true, 'gu', p.gu);
  end if;
  select count(*) filter (where gu = pick), count(*) into n, total from public.players where season = s and not is_npc;
  select count(*) into cnt from public.gus where open;
  if n >= 10 and n > 1.5 * (total::double precision / cnt) then
    raise exception '이 구는 인원이 꽉 찼어요. 다른 구를 골라 주세요.' using errcode = 'P0001';
  end if;
  insert into public.players (id, nickname, gu, season, troops, troops_at, contrib, last_action_at)
  values (auth.uid(), nick, pick, s, 60, now(), 0, now())
  on conflict (id) do update set nickname = excluded.nickname, gu = excluded.gu, season = excluded.season,
    troops = 60, troops_at = now(), contrib = 0, last_action_at = now();
  return jsonb_build_object('ok', true, 'gu', pick);
end $$;

-- 개척: 우리 연합 등불 칸에 붙은 어둠·잿빛 칸으로. 낮에만, 일몰 전에 도착해야 한다. 출발 칸은 가장 가까운 연합 등불 칸
create or replace function public.settle(dst int, n int, torch real) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.players; ph jsonb; t public.tiles; td public.tile_defs; sd text; src int; have double precision; mins double precision; arrive timestamptz; mid bigint;
begin
  perform private.advance(true);
  p := private.me(); sd := private.gu_side(p.gu);
  ph := private.phase_at(now());
  if ph ->> 'phase' <> 'day' then raise exception '개척은 낮에만 할 수 있어요.' using errcode = 'P0001'; end if;
  select * into t from public.tiles where id = dst;
  select * into td from public.tile_defs where id = dst;
  if t.id is null or td.kind = 'river' then raise exception '그 칸으로는 갈 수 없어요.' using errcode = 'P0001'; end if;
  if t.owner is not null then raise exception '이미 불이 켜진 칸이에요.' using errcode = 'P0001'; end if;
  if private.side_neighbors(dst, sd) = 0 then raise exception '우리 연합 땅에 붙은 칸만 개척할 수 있어요.' using errcode = 'P0001'; end if;
  have := private.settle_troops(p);
  if n is null or n < 1 or n > floor(have) then raise exception '병력이 모자라요.' using errcode = 'P0001'; end if;
  torch := least(1, greatest(0, coalesce(torch, 0.5)));
  src := private.nearest_lit(dst, sd);
  mins := private.march_minutes(src, dst, p.gu);
  arrive := now() + make_interval(mins => mins::int);
  if arrive > (ph ->> 'sunset')::timestamptz then
    raise exception '일몰 전에 도착하지 못해요(도착 %).', to_char(arrive at time zone 'Asia/Seoul', 'HH24:MI') using errcode = 'P0001';
  end if;
  update public.players set troops = troops - n where id = p.id;
  insert into public.marches (season, player, gu, src, dst, troops, torch, power, kind, arrive_at)
  values (p.season, p.id, p.gu, src, dst, n, torch, n * (0.8 + 0.4 * torch) * case when private.gu_type(p.gu) = 'legend' then 0.9 else 1 end, 'settle', arrive)
  returning id into mid;
  perform private.log_act(p, 'settle');
  return jsonb_build_object('ok', true, 'id', mid, 'arrive_at', arrive, 'need', private.settle_need(dst, p.gu));
end $$;

-- 공격(진군): 우리 연합 등불 칸(src)에서, 우리 연합 땅에 맞닿은 다른 연합의 등불 칸(dst)으로. 구청 칸은 칠 수 없다
create or replace function public.send_march(src int, dst int, n int, torch real) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.players; ph jsonb; s public.tiles; t public.tiles; td public.tile_defs; sd text;
  have double precision; mins double precision; arrive timestamptz; pw double precision; mid bigint;
begin
  perform private.advance(true);
  p := private.me(); sd := private.gu_side(p.gu);
  ph := private.phase_at(now());
  if ph ->> 'phase' <> 'day' then raise exception '진군은 낮에만 할 수 있어요.' using errcode = 'P0001'; end if;
  select * into s from public.tiles where id = src;
  select * into t from public.tiles where id = dst;
  select * into td from public.tile_defs where id = dst;
  if s.id is null or s.owner is null or private.gu_side(s.owner) <> sd then raise exception '출발 칸은 우리 연합 칸이어야 해요.' using errcode = 'P0001'; end if;
  if t.id is null or td.kind = 'river' then raise exception '그 칸으로는 갈 수 없어요.' using errcode = 'P0001'; end if;
  if t.owner is null then raise exception '불이 꺼진 칸은 개척으로 켜요.' using errcode = 'P0001'; end if;
  if private.gu_side(t.owner) = sd then raise exception '이미 우리 연합 칸이에요. 증원을 써 주세요.' using errcode = 'P0001'; end if;
  if td.hall_gu is not null then raise exception '구청 칸은 칠 수 없어요.' using errcode = 'P0001'; end if;
  if private.side_neighbors(dst, sd) = 0 then raise exception '우리 연합 땅에 맞닿은 칸만 칠 수 있어요.' using errcode = 'P0001'; end if;
  have := private.settle_troops(p);
  if n is null or n < 1 or n > floor(have) then raise exception '병력이 모자라요.' using errcode = 'P0001'; end if;
  torch := least(1, greatest(0, coalesce(torch, 0.5)));
  mins := private.march_minutes(src, dst, p.gu);
  arrive := now() + make_interval(mins => mins::int);
  if arrive > (ph ->> 'sunset')::timestamptz then
    raise exception '일몰 전에 도착하지 못해요(도착 %).', to_char(arrive at time zone 'Asia/Seoul', 'HH24:MI') using errcode = 'P0001';
  end if;
  pw := n * (0.8 + 0.4 * torch) * case when private.gu_type(p.gu) = 'legend' then 0.9 else 1 end;
  update public.players set troops = troops - n where id = p.id;
  insert into public.marches (season, player, gu, src, dst, troops, torch, power, kind, arrive_at)
  values (p.season, p.id, p.gu, src, dst, n, torch, pw, 'attack', arrive) returning id into mid;
  perform private.log_act(p, 'attack');
  return jsonb_build_object('ok', true, 'id', mid, 'arrive_at', arrive);
end $$;

-- 증원: 같은 연합이면 어느 구의 칸이든(낮·밤, 칸 상한 300)
create or replace function public.reinforce(tile int, n int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.players; ph text; t public.tiles; have double precision; add int;
begin
  perform private.advance(true);
  p := private.me();
  ph := private.phase_at(now()) ->> 'phase';
  if ph = 'seal' then raise exception '자정부터 일출까지는 봉인 시간이에요.' using errcode = 'P0001'; end if;
  select * into t from public.tiles where id = tile for update;
  if t.id is null or t.owner is null or private.gu_side(t.owner) <> private.gu_side(p.gu) then raise exception '우리 연합 칸에만 증원할 수 있어요.' using errcode = 'P0001'; end if;
  have := private.settle_troops(p);
  add := least(coalesce(n, 0), floor(have)::int, 300 - t.defense);
  if add < 1 then raise exception '증원할 병력이 없거나 칸이 가득 찼어요.' using errcode = 'P0001'; end if;
  update public.tiles set defense = defense + add, updated_at = now() where id = tile;
  update public.players set troops = troops - add, contrib = contrib + add where id = p.id;
  perform private.log_act(p, 'reinforce');
  return jsonb_build_object('ok', true, 'added', add, 'defense', t.defense + add);
end $$;

-- 깃발: 오늘 우리 연합이 노릴 칸에 한 표(하루 한 번, 바꾸면 옮겨진다). 우리 연합 칸이 아닌 칸에만
create or replace function public.plant_flag(tile int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.players;
begin
  p := private.me();
  if not exists (select 1 from public.tiles t where t.id = tile and (t.owner is null or private.gu_side(t.owner) <> private.gu_side(p.gu))) then
    raise exception '우리 연합 칸이 아닌 칸에만 깃발을 꽂을 수 있어요.' using errcode = 'P0001';
  end if;
  insert into public.flags (player, date, gu, tile) values (p.id, private.kst_date(now()), p.gu, tile)
  on conflict (player, date) do update set tile = excluded.tile, gu = excluded.gu;
  return jsonb_build_object('ok', true);
end $$;

-- 어둑시니 응시: 지금 보고 있는 칸을 알린다. 그 칸을 보는 사람 수를 돌려준다(정령 제외).
create or replace function public.watch(tile int) returns int
language plpgsql security definer set search_path = '' as $$
declare cnt int;
begin
  if auth.uid() is not null and exists (select 1 from public.players where id = auth.uid() and not is_npc) then
    insert into public.presence (player, tile, seen_at) values (auth.uid(), tile, now())
    on conflict (player) do update set tile = excluded.tile, seen_at = now();
  end if;
  select count(distinct pr.player) into cnt from public.presence pr join public.players pl on pl.id = pr.player
    where pr.tile = watch.tile and pr.seen_at > now() - interval '2 minutes' and not pl.is_npc;
  return cnt;
end $$;

-- 순위: 연합 점수, 구별 점수(등불 칸 + 랜드마크 칸 × 3), 내 기여도와 우리 구 상위 기여자(정령 제외)
create or replace function public.ranking() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s date := private.season_of(private.kst_date(now())); p public.players;
begin
  if auth.uid() is not null then select * into p from public.players where id = auth.uid(); end if;
  return jsonb_build_object(
    'season', s,
    'gus', (select jsonb_agg(jsonb_build_object('id', g.id, 'side', g.side,
      'tiles', (select count(*) from public.tiles t where t.owner = g.id),
      'landmarks', (select count(*) from public.tiles t join public.tile_defs td on td.id = t.id where t.owner = g.id and td.effect is not null),
      'npcs', (select count(*) from public.players x where x.gu = g.id and x.season = s and x.is_npc),
      'days', (select coalesce(jsonb_agg(jsonb_build_array(d.date, d.tiles, d.score) order by d.date), '[]') from public.daily d where d.gu = g.id and d.season = s)))
      from public.gus g where g.open),
    'me', case when p.id is null then null else jsonb_build_object('contrib', p.contrib,
      'rank', (select count(*) + 1 from public.players x where x.gu = p.gu and x.season = s and not x.is_npc and x.contrib > p.contrib)) end,
    'top', case when p.id is null then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_array(nickname, contrib) order by contrib desc), '[]')
      from (select nickname, contrib from public.players where gu = p.gu and season = s and not is_npc order by contrib desc limit 5) x) end,
    'last', (select jsonb_build_object('id', id, 'winner', winner, 'winner_side', winner_side, 'result', result) from public.seasons order by id desc limit 1)
  );
end $$;

-- 일출 리포트: 가장 최근에 끝난 밤 동안 구마다 잃은 칸·남은 칸, 오늘의 성적(밝힌 칸·지킨 비율)
create or replace function public.sunrise_report() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare ph jsonb := private.phase_at(now()); d date; st record;
begin
  d := (ph ->> 'date')::date - 1;
  select * into st from private.sun_times(d);
  return jsonb_build_object('night', d, 'long_night', extract(isodow from d) = 7,
    'gus', (select jsonb_agg(jsonb_build_object('id', g.id, 'side', g.side,
      'kept', (select tiles from public.daily x where x.date = d and x.gu = g.id),
      'settled', (select settled from public.daily x where x.date = d and x.gu = g.id),
      'kept_ratio', (select kept_ratio from public.daily x where x.date = d and x.gu = g.id),
      'lost', (select coalesce(jsonb_agg(e.tile order by e.at), '[]') from public.events e
        where e.kind = 'gray' and e.gu = g.id and e.at >= st.sunset and e.at <= private.kst_midnight(d + 1)))) from public.gus g where g.open));
end $$;

-- 봉인된 구 열어 주세요: 한 사람이 구마다 한 표(로그인 필요). 그 구의 표 수를 돌려준다.
create or replace function public.vote_gu(pick text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if auth.uid() is null then raise exception '로그인이 필요해요.' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.gus where id = pick and not open) then raise exception '이미 열려 있거나 없는 구예요.' using errcode = 'P0001'; end if;
  insert into public.gu_votes (voter, gu) values (auth.uid(), pick) on conflict do nothing;
  select count(*) into n from public.gu_votes where gu = pick;
  return jsonb_build_object('ok', true, 'gu', pick, 'votes', n);
end $$;

-- 추천 닉네임 중 아직 아무도 안 쓰는 것만 돌려준다(가입 전에도 부른다). 한 번에 20개까지.
create or replace function public.nicknames_free(names text[]) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(n order by ord), '{}') from unnest(names[1:20]) with ordinality as u(n, ord)
  where char_length(btrim(n)) between 1 and 12 and btrim(n) <> '등불 정령'
    and not exists (select 1 from public.players p where lower(btrim(p.nickname)) = lower(btrim(n)) and not p.is_npc)
$$;

-- 예약 작업(10분마다, src/jobs.js)과 잠들기 방지용. 공개 키로 불러도 시간이 된 일만 처리한다.
create or replace function public.tick() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.advance(true);
  return (select jsonb_build_object('tick_date', tick_date, 'tick_done', tick_done, 'season', season) from public.game_state where id = 1);
end $$;

create or replace function public.keepalive() returns integer
language sql stable security invoker set search_path = '' as $$ select 1 $$;

-- 칸 이웃 목록과 첫 상태(seed.sql을 넣은 뒤 부른다). 이미 있으면 상태는 건드리지 않는다.
create or replace function private.init_world() returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.tile_adj (a, b)
  select x.id, y.id from public.tile_defs x join public.tile_defs y
    on (y.q - x.q, y.r - x.r) in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, -1), (-1, 1))
  on conflict do nothing;
  if not exists (select 1 from public.tiles) then perform private.reset_world(); end if;
  insert into public.game_state (id, tick_date, tick_done, season)
  values (1, private.kst_date(now()), 0, private.season_of(private.kst_date(now())))
  on conflict (id) do nothing;
end $$;

-- 함수 권한: 화면용만 열고 나머지는 막는다(Supabase는 새 함수에 anon 실행 권한을 기본으로 주므로 직접 뺀다)
revoke all on all functions in schema private from public, anon, authenticated;
do $$ declare f text; begin
  foreach f in array array['game_state()', 'join_game(text, text)', 'settle(int, int, real)', 'send_march(int, int, int, real)', 'reinforce(int, int)',
    'plant_flag(int)', 'watch(int)', 'ranking()', 'sunrise_report()', 'vote_gu(text)', 'nicknames_free(text[])', 'tick()', 'keepalive()'] loop
    execute 'revoke all on function public.' || f || ' from public, anon, authenticated';
  end loop;
end $$;
grant execute on function public.game_state(), public.watch(int), public.ranking(), public.sunrise_report(), public.nicknames_free(text[]), public.tick(), public.keepalive() to anon, authenticated;
grant execute on function public.join_game(text, text), public.settle(int, int, real), public.send_march(int, int, int, real), public.reinforce(int, int), public.plant_flag(int), public.vote_gu(text) to authenticated;
