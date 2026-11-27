-- =====================================================================
-- 어둑시니 Supabase 스키마. 여러 번 실행해도 안전하다(시즌 데이터는 지우지 않는다).
-- 적용 순서: 이 파일 → supabase/seed.sql(칸 목록, scripts/build_map.mjs가 만든다) → 맨 아래 init_world()
--
-- 규칙은 화면이 아니라 여기(함수)에 있다. 화면은 공개 키(publishable)로 접속하므로
-- 표는 읽기만 열고, 쓰기는 모두 security definer 함수(join_game, send_march, reinforce …)로만 한다.
-- 계산 숫자는 web/js/rules.js와 같다. 하나를 바꾸면 둘 다 고친다.
-- 내부 함수는 API에 드러나지 않는 private 스키마에 둔다.
-- =====================================================================

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------- 고정 데이터 ----------
create table if not exists public.gus (
  id text primary key, name text not null, short text not null,
  type text not null check (type in ('river', 'mount', 'city', 'village', 'legend')),
  side text not null check (side in ('n', 's'))
);
create table if not exists public.tile_defs (
  id int primary key, q int not null, r int not null,
  kind text not null check (kind in ('land', 'river', 'bridge')),
  home_gu text references public.gus (id), name text not null,
  edge boolean not null default false, landmark boolean not null default false,
  unique (q, r)
);
create table if not exists public.tile_adj (a int not null references public.tile_defs (id), b int not null references public.tile_defs (id), primary key (a, b));

-- ---------- 움직이는 데이터 ----------
create table if not exists public.tiles (
  id int primary key references public.tile_defs (id),
  owner text references public.gus (id),
  defense int not null default 0 check (defense between 0 and 300),
  gray boolean not null default false,
  updated_at timestamptz not null default now()
);
create table if not exists public.players (
  id uuid primary key references auth.users (id) on delete cascade,
  nickname text not null check (char_length(nickname) between 1 and 12),
  gu text references public.gus (id),
  season date,
  troops double precision not null default 0,
  troops_at timestamptz not null default now(),
  contrib int not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.marches (
  id bigint generated always as identity primary key,
  season date not null, player uuid not null references public.players (id) on delete cascade,
  gu text not null references public.gus (id),
  src int not null references public.tile_defs (id), dst int not null references public.tile_defs (id),
  troops int not null check (troops > 0), torch real not null, power real not null,
  created_at timestamptz not null default now(), arrive_at timestamptz not null,
  status text not null default 'moving' check (status in ('moving', 'won', 'lost', 'merged', 'void'))
);
create index if not exists marches_moving on public.marches (arrive_at) where status = 'moving';
create table if not exists public.events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(), season date not null,
  kind text not null check (kind in ('capture', 'repel', 'consume')),
  tile int not null references public.tile_defs (id), gu text, other_gu text, n int
);
create index if not exists events_at on public.events (at desc);
create table if not exists public.daily (
  date date not null, gu text not null references public.gus (id), season date not null, tiles int not null,
  primary key (date, gu)
);
create table if not exists public.seasons (id date primary key, winner text references public.gus (id), result jsonb, closed_at timestamptz default now());
create table if not exists public.flags (
  player uuid not null references public.players (id) on delete cascade, date date not null,
  gu text not null, tile int not null references public.tile_defs (id), primary key (player, date)
);
create table if not exists public.presence (player uuid primary key references public.players (id) on delete cascade, tile int, seen_at timestamptz not null default now());
create table if not exists public.game_state (id int primary key check (id = 1), tick_date date not null, tick_done int not null default 0, season date not null);

-- ---------- 권한: 읽기는 공개, 쓰기는 함수로만 ----------
alter table public.gus enable row level security;
alter table public.tile_defs enable row level security;
alter table public.tile_adj enable row level security;
alter table public.tiles enable row level security;
alter table public.players enable row level security;
alter table public.marches enable row level security;
alter table public.events enable row level security;
alter table public.daily enable row level security;
alter table public.seasons enable row level security;
alter table public.flags enable row level security;
alter table public.presence enable row level security;
alter table public.game_state enable row level security;

revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;

do $$ declare t text; begin
  foreach t in array array['gus', 'tile_defs', 'tile_adj', 'tiles', 'marches', 'events', 'daily', 'seasons'] loop
    execute format('drop policy if exists "누구나 읽기" on public.%I', t);
    execute format('create policy "누구나 읽기" on public.%I for select to anon, authenticated using (true)', t);
  end loop;
end $$;
drop policy if exists "내 정보 읽기" on public.players;
create policy "내 정보 읽기" on public.players for select to authenticated using (id = (select auth.uid()));
-- 깃발은 같은 구 사람끼리만 본다(적에게 목표가 새지 않게). presence·game_state는 함수로만 읽는다.
drop policy if exists "우리 구 깃발 읽기" on public.flags;
create policy "우리 구 깃발 읽기" on public.flags for select to authenticated
  using (gu = (select p.gu from public.players p where p.id = (select auth.uid())));

-- 실시간(Realtime): 칸과 진군이 바뀌면 화면에 바로 알린다
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'tiles') then
    alter publication supabase_realtime add table public.tiles;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'marches') then
    alter publication supabase_realtime add table public.marches;
  end if;
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

-- 지금이 하루 흐름의 어디인지(seal: 자정~일출, day, night: 일몰~자정)
create or replace function private.phase_at(ts timestamptz) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  d date := private.kst_date(ts); st record; mid timestamptz; len interval; k int; ph text;
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

create or replace function private.own_neighbors(t int, g text) returns int
language sql stable set search_path = '' as $$
  select count(*)::int from public.tile_adj a join public.tiles n on n.id = a.b where a.a = t and n.owner = g
$$;

-- 인원 보정: 1/√(구 인원 ÷ 6개 구 평균), 0.7~1.3
create or replace function private.pop_factor(g text) returns double precision
language plpgsql stable set search_path = '' as $$
declare s date := private.season_of(private.kst_date(now())); n double precision; total double precision; avg double precision;
begin
  select count(*) filter (where gu = g), count(*) into n, total from public.players where season = s;
  avg := total / greatest(1, (select count(*) from public.gus));
  if n = 0 or avg = 0 then return 1; end if;
  return least(1.3, greatest(0.7, 1 / sqrt(n / avg)));
end $$;

-- 시간당 병력 생산
create or replace function private.prod_rate(g text, ph text) returns double precision
language sql stable set search_path = '' as $$
  select 30.0 * (case when ph = 'day' then 1 else 0.5 end)
    * (case private.gu_type(g) when 'village' then 1.2 when 'mount' then 0.9 else 1 end) * private.pop_factor(g)
$$;

-- 지금 병력(저장값 + 쌓인 양, 상한 90)
create or replace function private.troops_now(p public.players) returns double precision
language sql stable set search_path = '' as $$
  select least(90.0, greatest(p.troops, p.troops + extract(epoch from now() - p.troops_at) / 3600.0
    * private.prod_rate(p.gu, private.phase_at(now()) ->> 'phase')))
$$;

-- 방어력(web/js/rules.js defensePower)
create or replace function private.def_power(t public.tiles) returns double precision
language plpgsql stable set search_path = '' as $$
declare ty text; p double precision := t.defense * 1.2; br boolean;
begin
  if t.owner is null then return p; end if;
  ty := private.gu_type(t.owner);
  select kind = 'bridge' into br from public.tile_defs where id = t.id;
  p := p * (1 + least(0.30, 0.05 * private.own_neighbors(t.id, t.owner)));
  if ty = 'mount' then p := p * 1.15; end if;
  if br and ty = 'river' then p := p * 1.3; end if;
  return p;
end $$;

-- =====================================================================
-- 세계 초기화(시즌 시작): 칸 중심이 속한 구가 주인, 다리는 중립
-- =====================================================================
create or replace function private.reset_world() returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.tiles (id) select id from public.tile_defs where kind <> 'river' on conflict (id) do nothing;
  update public.tiles t set
    owner = case when d.kind = 'bridge' then null else d.home_gu end,
    defense = case when d.kind = 'bridge' then 40 else 100 end,
    gray = false, updated_at = now()
  from public.tile_defs d where d.id = t.id;
  update public.marches set status = 'void' where status = 'moving';
  delete from public.presence;
end $$;

-- 진군 도착 판정(지연 계산: 누가 화면을 열거나 예약 작업이 돌 때 도착 시각이 지난 것부터 차례로)
create or replace function private.resolve_marches(upto timestamptz) returns int
language plpgsql security definer set search_path = '' as $$
declare m record; t public.tiles; dp double precision; atk double precision; hold int; done int := 0;
begin
  for m in select * from public.marches where status = 'moving' and arrive_at <= upto order by arrive_at, id for update loop
    select * into t from public.tiles where id = m.dst for update;
    if t.owner = m.gu then
      update public.tiles set defense = least(300, defense + m.troops), updated_at = m.arrive_at where id = t.id;
      update public.marches set status = 'merged' where id = m.id;
    else
      dp := private.def_power(t);
      atk := m.power * (0.9 + 0.2 * random());
      if atk > dp then
        hold := least(300, greatest(10, round(m.troops * (atk - dp) / atk)::int));
        update public.tiles set owner = m.gu, defense = hold, gray = false, updated_at = m.arrive_at where id = t.id;
        update public.marches set status = 'won' where id = m.id;
        update public.players set contrib = contrib + 20 where id = m.player;
        insert into public.events (at, season, kind, tile, gu, other_gu, n) values (m.arrive_at, m.season, 'capture', t.id, m.gu, t.owner, hold);
      else
        update public.tiles set defense = greatest(0, round(t.defense * (1 - atk / dp))::int), updated_at = m.arrive_at where id = t.id;
        update public.marches set status = 'lost' where id = m.id;
        insert into public.events (at, season, kind, tile, gu, other_gu, n) values (m.arrive_at, m.season, 'repel', t.id, t.owner, m.gu, m.troops);
      end if;
    end if;
    done := done + 1;
  end loop;
  return done;
end $$;

-- 밤 침식 한 번(k = 1~8). 어둠(지도 밖, 잿빛 칸)과 맞닿은 칸에 압력을 준다.
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
    1.2 * case g.type when 'legend' then 1.25 when 'city' then 0.85 else 1 end,
    t.defense
  from public.tiles t
  join public.tile_defs td on td.id = t.id
  join public.gus g on g.id = t.owner
  left join (select tile, count(*) as n from public.presence where seen_at >= tt - interval '3 minutes' group by tile) w on w.tile = t.id
  -- 어둠: 지도 밖(가장자리) + 이번 밤 전에 이미 잿빛이 된 칸. 오늘 밤 먹힌 칸은 다음 밤부터 어둠이 된다(하룻밤에 한 겹).
  where td.edge or exists (select 1 from public.tile_adj a join public.tiles n on n.id = a.b where a.a = t.id and n.gray and n.updated_at < dusk);

  insert into public.events (at, season, kind, tile, gu, n)
  select tt, private.season_of(d), 'consume', id, owner, round(p)::int from _erode where p > def * res;
  update public.tiles t set
    owner = case when e.p > e.def * e.res then null else t.owner end,
    gray = e.p > e.def * e.res,
    defense = case when e.p > e.def * e.res then 0 else greatest(0, round(e.def - e.p * 0.25 / e.res)::int) end,
    updated_at = tt
  from _erode e where e.id = t.id;
end $$;

-- 밤이 끝나면(자정) 구별 살아남은 등불을 기록. 일요일 밤이면 시즌 정산 후 세계 초기화.
create or replace function private.close_night(d date) returns void
language plpgsql security definer set search_path = '' as $$
declare res jsonb; win text;
begin
  insert into public.daily (date, gu, season, tiles)
  select d, g.id, private.season_of(d), (select count(*) from public.tiles t where t.owner = g.id) from public.gus g
  on conflict (date, gu) do update set tiles = excluded.tiles;
  if extract(isodow from d) = 7 then
    select jsonb_object_agg(gu, tiles), (array_agg(gu order by tiles desc, gu))[1] into res, win
    from public.daily where date = d;
    insert into public.seasons (id, winner, result) values (private.season_of(d), win, res)
    on conflict (id) do update set winner = excluded.winner, result = excluded.result, closed_at = now();
    perform private.reset_world();
  end if;
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
  -- 오래 멈춰 있었으면(프로젝트 정지 등) 지난 밤들은 건너뛴다
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
  -- 건너뛴 사이에 주가 바뀌었으면 새 시즌으로
  if s.season <> private.season_of(today) then
    perform private.reset_world(); s.season := private.season_of(today);
  end if;
  update public.game_state set tick_date = s.tick_date, tick_done = s.tick_done, season = s.season where id = 1;
end $$;

-- 내 플레이어(이번 시즌). 없으면 오류.
create or replace function private.me() returns public.players
language plpgsql stable security definer set search_path = '' as $$
declare p public.players;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.' using errcode = 'P0001'; end if;
  select * into p from public.players where id = auth.uid();
  if not found or p.gu is null or p.season is distinct from private.season_of(private.kst_date(now())) then
    raise exception '이번 시즌의 구를 먼저 고르세요.' using errcode = 'P0001';
  end if;
  return p;
end $$;

create or replace function private.settle(p public.players) returns double precision
language plpgsql security definer set search_path = '' as $$
declare n double precision := private.troops_now(p);
begin
  update public.players set troops = n, troops_at = now() where id = p.id;
  return n;
end $$;

-- =====================================================================
-- 화면이 부르는 함수(API). 모두 안에서 advance()를 먼저 부른다.
-- =====================================================================

-- 한 번에 화면에 필요한 상태 전부
create or replace function public.game_state() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.players; ph jsonb; me jsonb := null; flagtop jsonb := null; myflag int;
begin
  perform private.advance(false);
  ph := private.phase_at(now());
  if auth.uid() is not null then select * into p from public.players where id = auth.uid(); end if;
  if p.id is not null then
    select tile into myflag from public.flags where player = p.id and date = private.kst_date(now());
    me := jsonb_build_object('nickname', p.nickname, 'gu', p.gu, 'season', p.season,
      'active', p.gu is not null and p.season = (ph ->> 'season')::date,
      'troops', floor(private.troops_now(p)), 'rate', round(private.prod_rate(p.gu, ph ->> 'phase')::numeric, 1),
      'contrib', p.contrib, 'flag', myflag);
    if p.gu is not null then
      select coalesce(jsonb_agg(jsonb_build_array(tile, n) order by n desc, tile), '[]') into flagtop from (
        select tile, count(*) as n from public.flags where gu = p.gu and date = private.kst_date(now()) group by tile order by n desc, tile limit 3) f;
    end if;
  end if;
  return jsonb_build_object(
    'now', now(), 'phase', ph, 'me', me, 'flags', flagtop,
    'tiles', (select jsonb_agg(jsonb_build_array(id, owner, defense, gray) order by id) from public.tiles),
    'marches', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'gu', gu, 'src', src, 'dst', dst, 'troops', troops,
      'torch', torch, 'created_at', created_at, 'arrive_at', arrive_at, 'mine', player = auth.uid()) order by arrive_at), '[]')
      from public.marches where status = 'moving'),
    'gus', (select jsonb_agg(jsonb_build_object('id', g.id, 'players',
      (select count(*) from public.players x where x.gu = g.id and x.season = (ph ->> 'season')::date),
      'tiles', (select count(*) from public.tiles t where t.owner = g.id)) order by g.id) from public.gus g),
    'recent', (select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'tile', tile, 'gu', gu, 'other', other_gu, 'at', at) order by at desc), '[]')
      from (select * from public.events where at > now() - interval '30 minutes' order by at desc limit 12) e)
  );
end $$;

-- 구 고르기(시즌 중 변경 불가). 닉네임은 언제든 바꿀 수 있다.
create or replace function public.join_game(nick text, pick text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s date; p public.players; n int; total int; cnt int;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.' using errcode = 'P0001'; end if;
  nick := btrim(coalesce(nick, ''));
  if char_length(nick) < 1 or char_length(nick) > 12 then raise exception '닉네임은 1~12자로 정해 주세요.' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.gus where id = pick) then raise exception '없는 구입니다.' using errcode = 'P0001'; end if;
  perform private.advance(true);
  s := private.season_of(private.kst_date(now()));
  select * into p from public.players where id = auth.uid();
  if found and p.season = s and p.gu is not null then
    if p.gu <> pick then raise exception '시즌 중에는 구를 바꿀 수 없습니다.' using errcode = 'P0001'; end if;
    update public.players set nickname = nick where id = p.id;
    return jsonb_build_object('ok', true, 'gu', p.gu);
  end if;
  -- 꽉 찬 구는 신규 가입 제한: 10명 이상이면서 평균의 1.5배를 넘을 때
  select count(*) filter (where gu = pick), count(*) into n, total from public.players where season = s;
  select count(*) into cnt from public.gus;
  if n >= 10 and n > 1.5 * (total::double precision / cnt) then
    raise exception '이 구는 인원이 꽉 찼습니다. 다른 구를 골라 주세요.' using errcode = 'P0001';
  end if;
  insert into public.players (id, nickname, gu, season, troops, troops_at, contrib)
  values (auth.uid(), nick, pick, s, 60, now(), 0)
  on conflict (id) do update set nickname = excluded.nickname, gu = excluded.gu, season = excluded.season,
    troops = 60, troops_at = now(), contrib = 0;
  return jsonb_build_object('ok', true, 'gu', pick);
end $$;

-- 진군: 우리 칸(src)에서 우리 땅에 맞닿은 남의 칸(dst)으로. 낮에만, 일몰 전에 도착해야 한다.
create or replace function public.send_march(src int, dst int, n int, torch real) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.players; ph jsonb; s public.tiles; t public.tiles; sd public.tile_defs; td public.tile_defs;
  have double precision; dist int; mins double precision; arrive timestamptz; ty text; pw double precision; mid bigint;
begin
  perform private.advance(true);
  p := private.me();
  ph := private.phase_at(now());
  if ph ->> 'phase' <> 'day' then raise exception '진군은 낮에만 할 수 있습니다.' using errcode = 'P0001'; end if;
  select * into s from public.tiles where id = src;
  select * into t from public.tiles where id = dst;
  select * into sd from public.tile_defs where id = src;
  select * into td from public.tile_defs where id = dst;
  if s.id is null or s.owner is distinct from p.gu then raise exception '출발 칸은 우리 구 칸이어야 합니다.' using errcode = 'P0001'; end if;
  if t.id is null or td.kind = 'river' then raise exception '그 칸으로는 갈 수 없습니다.' using errcode = 'P0001'; end if;
  if t.owner is not distinct from p.gu then raise exception '이미 우리 칸입니다. 증원을 쓰세요.' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.tile_adj a join public.tiles x on x.id = a.b where a.a = dst and x.owner = p.gu) then
    raise exception '우리 땅에 맞닿은 칸만 칠 수 있습니다.' using errcode = 'P0001';
  end if;
  have := private.settle(p);
  if n is null or n < 1 or n > floor(have) then raise exception '병력이 모자랍니다.' using errcode = 'P0001'; end if;
  torch := least(1, greatest(0, coalesce(torch, 0.5)));
  dist := (abs(sd.q - td.q) + abs(sd.r - td.r) + abs(sd.q + sd.r - td.q - td.r)) / 2;
  ty := private.gu_type(p.gu);
  mins := least(40, 10 + 3 * dist);
  mins := mins * case ty when 'city' then 0.75 when 'village' then 1.15 else 1 end;
  if ty = 'river' and private.gu_type(t.owner) = 'mount' then mins := mins * 1.2; end if;
  if t.gray then mins := mins * 0.5; end if;
  arrive := now() + make_interval(mins => greatest(1, round(mins))::int);
  if arrive > (ph ->> 'sunset')::timestamptz then
    raise exception '일몰 전에 도착하지 못합니다(도착 %).', to_char(arrive at time zone 'Asia/Seoul', 'HH24:MI') using errcode = 'P0001';
  end if;
  pw := n * (0.8 + 0.4 * torch) * case when ty = 'legend' then 0.9 else 1 end;
  update public.players set troops = troops - n where id = p.id;
  insert into public.marches (season, player, gu, src, dst, troops, torch, power, arrive_at)
  values (p.season, p.id, p.gu, src, dst, n, torch, pw, arrive) returning id into mid;
  return jsonb_build_object('ok', true, 'id', mid, 'arrive_at', arrive);
end $$;

-- 증원: 우리 칸에 병력을 쌓는다(낮·밤, 칸 상한 300)
create or replace function public.reinforce(tile int, n int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.players; ph text; t public.tiles; have double precision; add int;
begin
  perform private.advance(true);
  p := private.me();
  ph := private.phase_at(now()) ->> 'phase';
  if ph = 'seal' then raise exception '자정부터 일출까지는 봉인 시간입니다.' using errcode = 'P0001'; end if;
  select * into t from public.tiles where id = tile for update;
  if t.id is null or t.owner is distinct from p.gu then raise exception '우리 구 칸에만 증원할 수 있습니다.' using errcode = 'P0001'; end if;
  have := private.settle(p);
  add := least(coalesce(n, 0), floor(have)::int, 300 - t.defense);
  if add < 1 then raise exception '증원할 병력이 없거나 칸이 가득 찼습니다.' using errcode = 'P0001'; end if;
  update public.tiles set defense = defense + add, updated_at = now() where id = tile;
  update public.players set troops = troops - add, contrib = contrib + add where id = p.id;
  return jsonb_build_object('ok', true, 'added', add, 'defense', t.defense + add);
end $$;

-- 깃발: 오늘 우리 구가 노릴 칸에 한 표(하루 한 번, 바꾸면 옮겨진다)
create or replace function public.plant_flag(tile int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.players;
begin
  p := private.me();
  if not exists (select 1 from public.tiles t where t.id = tile and t.owner is distinct from p.gu) then
    raise exception '우리 칸이 아닌 칸에만 깃발을 꽂을 수 있습니다.' using errcode = 'P0001';
  end if;
  insert into public.flags (player, date, gu, tile) values (p.id, private.kst_date(now()), p.gu, tile)
  on conflict (player, date) do update set tile = excluded.tile, gu = excluded.gu;
  return jsonb_build_object('ok', true);
end $$;

-- 어둑시니 응시: 지금 보고 있는 칸을 알린다. 그 칸을 보는 사람 수를 돌려준다.
create or replace function public.watch(tile int) returns int
language plpgsql security definer set search_path = '' as $$
declare cnt int;
begin
  if auth.uid() is not null and exists (select 1 from public.players where id = auth.uid()) then
    insert into public.presence (player, tile, seen_at) values (auth.uid(), tile, now())
    on conflict (player) do update set tile = excluded.tile, seen_at = now();
  end if;
  select count(*) into cnt from public.presence p where p.tile = watch.tile and p.seen_at > now() - interval '2 minutes';
  return cnt;
end $$;

-- 순위: 구별 지금 등불 수, 이번 시즌 날마다 기록, 내 기여도와 우리 구 상위 기여자
create or replace function public.ranking() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s date := private.season_of(private.kst_date(now())); p public.players;
begin
  if auth.uid() is not null then select * into p from public.players where id = auth.uid(); end if;
  return jsonb_build_object(
    'season', s,
    'gus', (select jsonb_agg(jsonb_build_object('id', g.id, 'tiles', (select count(*) from public.tiles t where t.owner = g.id),
      'days', (select coalesce(jsonb_agg(jsonb_build_array(d.date, d.tiles) order by d.date), '[]') from public.daily d where d.gu = g.id and d.season = s)))
      from public.gus g),
    'me', case when p.id is null then null else jsonb_build_object('contrib', p.contrib,
      'rank', (select count(*) + 1 from public.players x where x.gu = p.gu and x.season = s and x.contrib > p.contrib)) end,
    'top', case when p.id is null then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_array(nickname, contrib) order by contrib desc), '[]')
      from (select nickname, contrib from public.players where gu = p.gu and season = s order by contrib desc limit 5) x) end,
    'last', (select jsonb_build_object('id', id, 'winner', winner, 'result', result) from public.seasons order by id desc limit 1)
  );
end $$;

-- 일출 리포트: 가장 최근에 끝난 밤 동안 구마다 잃은 칸과 남은 칸
create or replace function public.sunrise_report() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare ph jsonb := private.phase_at(now()); d date; st record;
begin
  d := (ph ->> 'date')::date - 1;  -- 오늘 낮·봉인·밤 모두, 끝난 밤은 어젯밤
  select * into st from private.sun_times(d);
  return jsonb_build_object('night', d, 'long_night', extract(isodow from d) = 7,
    'gus', (select jsonb_agg(jsonb_build_object('id', g.id,
      'kept', (select tiles from public.daily x where x.date = d and x.gu = g.id),
      'lost', (select coalesce(jsonb_agg(e.tile order by e.at), '[]') from public.events e
        where e.kind = 'consume' and e.gu = g.id and e.at >= st.sunset and e.at <= private.kst_midnight(d + 1)))) from public.gus g));
end $$;

-- 예약 작업(10분마다, src/jobs.js)과 잠들기 방지용. 공개 키로 불러도 시간이 된 일만 처리한다.
create or replace function public.tick() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.advance(true);
  return (select jsonb_build_object('tick_date', tick_date, 'tick_done', tick_done, 'season', season) from public.game_state where id = 1);
end $$;

create or replace function public.keepalive() returns integer
language sql stable security invoker set search_path = '' as $$ select 1 $$;

-- 함수 권한: 화면용만 열고 나머지는 막는다
revoke all on all functions in schema private from public, anon, authenticated;
revoke all on function public.game_state(), public.join_game(text, text), public.send_march(int, int, int, real),
  public.reinforce(int, int), public.plant_flag(int), public.watch(int), public.ranking(), public.sunrise_report(),
  public.tick(), public.keepalive() from public;
grant execute on function public.game_state(), public.watch(int), public.ranking(), public.sunrise_report(), public.tick(), public.keepalive() to anon, authenticated;
grant execute on function public.join_game(text, text), public.send_march(int, int, int, real), public.reinforce(int, int), public.plant_flag(int) to authenticated;
-- Supabase는 새 함수에 anon 실행 권한을 기본으로 주므로 로그인 전용 함수는 따로 뺀다
revoke execute on function public.join_game(text, text), public.send_march(int, int, int, real), public.reinforce(int, int), public.plant_flag(int) from anon;

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
revoke all on function private.init_world() from public, anon, authenticated;
