// 어둑시니 화면. 규칙 판정은 DB 함수(supabase/schema.sql)가 하고, 여기서는 상태를 받아 그리고 요청을 보낸다.
// 앱에서 받은 글자는 textContent로만 넣는다(innerHTML 금지).
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { TYPES, BAL, fmtLeft, fmtClock, attackPower, defensePower, phaseAt, allianceName, effectText } from './rules.js';
import { indexMap, applyTiles, canAttack, canSettle, canReinforce, settleNeedFor, bestSource, marchPreview, incoming, ownNeighborCount, troopsLocal,
  rankGus, countTiles, reportLine, dayBest, shareText, josa, darkFront, visibleSet, scores, tileState, sideOf, isDark, hallOf } from './view.js';
import { MapView } from './map.js';
import { startScene, drawShareCard } from './story.js';
import { loadImages } from './sprites.js';
import { mountSunbar } from './sunbar.js';
import { nicknameCandidates, MAX_NICK } from './names.js';
import { CHAT } from './links.js';

const $ = id => document.getElementById(id);
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
const store = {
  get(k) { try { return localStorage.getItem('eoduk.' + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('eoduk.' + k, v); } catch { /* 저장 못 해도 동작은 한다 */ } },
};

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const S = {
  idx: null, map: null, session: null, game: null, fetchedAt: 0, offset: 0,
  selected: null, sheet: null, watchers: 0, incomingSeen: new Set(), sound: store.get('sound') === '1',
};
const now = () => Date.now() + S.offset;
const me = () => S.game?.me;
const myGu = () => (me()?.active ? me().gu : null);
const mySide = () => (me()?.active ? me().side : null);
const sideShort = sd => (sd === 'n' ? '강북' : '강남');
const guOf = id => S.idx.gu.get(id);
const phase = () => S.game?.phase?.phase || phaseAt(now()).phase;

function toast(text, ms = 2600) {
  const t = $('toast'); t.textContent = text; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, ms);
}
function friendly(error) {
  const m = String(error?.message || error);
  if (/Invalid login credentials/i.test(m)) return '이메일이나 비밀번호가 맞지 않아요.';
  if (/already registered/i.test(m)) return '이미 가입한 이메일이에요. 로그인을 눌러 주세요.';
  if (/Email not confirmed/i.test(m)) return '이메일 확인이 아직 켜져 있어 로그인할 수 없어요. 운영자에게 알려 주세요.';
  if (/Password should be/i.test(m)) return '비밀번호는 6자 이상이어야 해요.';
  if (/Failed to fetch|NetworkError/i.test(m)) return '연결이 끊겼어요. 잠시 후 다시 해 주세요.';
  return m;
}
async function rpc(name, args) {
  const { data, error } = await sb.rpc(name, args || {});
  if (error) throw new Error(friendly(error));
  return data;
}

// ---------- 소리(기본 꺼짐) ----------
let audio = null;
function beep(freq = 520, dur = 0.12) {
  if (!S.sound) return;
  try {
    audio ||= new AudioContext();
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = 'square'; o.frequency.value = freq; g.gain.value = 0.04;
    o.connect(g).connect(audio.destination); o.start(); o.stop(audio.currentTime + dur);
  } catch { /* 소리를 못 내도 그만 */ }
}

// ---------- 상태 받기 ----------
let refreshTimer = null, inflight = null;
async function refresh() {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const t0 = Date.now();
      const g = await rpc('game_state');
      S.offset = Date.parse(g.now) - (t0 + Date.now()) / 2;
      S.game = g; S.fetchedAt = now();
      applyTiles(S.idx, g.tiles);
      render();
    } catch (e) { toast(e.message); }
    finally { inflight = null; schedule(); }
  })();
  return inflight;
}
// 다음 갱신: 가장 빠른 진군 도착 직후, 밤이면 다음 침식 직후, 아니면 1분 뒤
function schedule() {
  clearTimeout(refreshTimer);
  const t = now(); let next = t + 60000;
  for (const m of S.game?.marches || []) next = Math.min(next, Date.parse(m.arrive_at) + 1500);
  const ph = S.game?.phase;
  if (ph?.next_tick) next = Math.min(next, Date.parse(ph.next_tick) + 2000);
  if (ph?.phase === 'day') next = Math.min(next, Date.parse(ph.sunset) + 2000);
  refreshTimer = setTimeout(refresh, Math.max(1500, next - t));
}
let rtTimer = null;
function subscribeRealtime() {
  const kick = () => { clearTimeout(rtTimer); rtTimer = setTimeout(refresh, 700); };
  sb.channel('world')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tiles' }, kick)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'marches' }, kick)
    .subscribe();
}

// ---------- 그리기 ----------
const isPC = () => window.innerWidth >= 1024;
const torchRatio = () => { const v = parseFloat(store.get('torch')); return Number.isFinite(v) ? v : 0.7; };
// 고른 칸에 따라 하단 첫 버튼이 할 일: 어둠·잿빛 → 개척, 다른 연합 칸 → 진군, 우리 연합 칸 → 없음(증원 사용)
function primaryAction(id) {
  const side = mySide(); if (!side) return null;
  if (!id) return 'settle';
  if (canSettle(S.idx, id, side)) return 'settle';
  if (canAttack(S.idx, id, side)) return 'attack';
  return canReinforce(S.idx, id, side) ? 'own' : 'settle';
}
function render() {
  const g = S.game; if (!g) return;
  const ph = g.phase.phase;
  document.documentElement.dataset.theme = ph === 'day' ? 'day' : 'night';
  const gu = myGu(), side = mySide();
  const inc = side ? incoming(S.idx, g.marches, side) : [];
  for (const m of inc) if (!S.incomingSeen.has(m.id)) { S.incomingSeen.add(m.id); beep(330, 0.25); }
  const mods = me()?.mods || { sight: 0 };
  const eroding = side && ph === 'night' ? darkFront(S.idx, side).map(c => c.id) : [];
  const reinforced = side ? [...S.idx.byId.values()].filter(c => c.owner && sideOf(S.idx, c.owner) === side && !c.hall && c.defense > BAL.tileStart).sort((a, b) => b.defense - a.defense).slice(0, 3).map(c => c.id) : [];
  S.map.set({ marches: g.marches, myGu: gu, mySide: side, visible: side ? visibleSet(S.idx, side, mods.sight || 0) : null,
    selected: S.selected, flags: g.flags || [], phase: g.phase,
    incomingIds: new Set(inc.map(m => m.dst)), erodingIds: new Set(eroding), reinforced: new Set(reinforced), canMarch: !!side && ph === 'day' });
  // 헤더 한 줄: 우리 구 · 등불 n칸 · 연합 점수 / 병력. 둘러보는 중이면 두 연합 점수와 참여하기
  const gg = gu ? guOf(gu) : null;
  const counts = countTiles(S.idx), sc = scores(S.idx), ranked = rankGus([...S.idx.gu.values()], counts, sc);
  $('whoDot').style.background = gg ? 'var(--ours)' : 'var(--muted)';
  $('guName').textContent = gg ? gg.name : '서울';
  const other = side === 'n' ? 's' : 'n';
  $('guSub').textContent = gg ? `등불 ${counts[gu] || 0}칸 · ${sideShort(side)} 연합 ${sc.side[side].score}점 대 ${sc.side[other].score}점`
    : `강북 연합 ${sc.side.n.score}점 · 강남 연합 ${sc.side.s.score}점`;
  $('troopBox').hidden = !gg;
  $('btnJoin').hidden = !!gg;
  $('btnJoin').textContent = S.session ? '구 고르기' : '참여하기';
  // 아래 줄: 첫 버튼은 고른 칸에 따라 개척/진군
  const bm = $('btnMarch'), act = primaryAction(S.selected);
  $('marchLbl').textContent = ph === 'night' ? '밤엔 쉬어요' : ph === 'seal' ? '봉인 중' : act === 'attack' ? '진군' : '개척';
  bm.classList.toggle('night', ph !== 'day');
  bm.disabled = !side || ph !== 'day' || act === 'own';
  $('btnReinforce').disabled = !side || ph === 'seal';
  if (ph === 'day') {
    const top = (g.flags || [])[0];
    $('flagTag').textContent = '깃발 최다';
    $('flagText').textContent = top ? `${S.idx.byId.get(top[0]).name} 칸 · 깃발 ${top[1]}개` : (side ? '칸을 눌러 깃발을 꽂아 목표를 정해요' : '구청 6곳에서 등불을 켜고 시작해요');
  } else { $('flagTag').textContent = '증원했다면'; $('flagText').textContent = '화면을 끄는 것도 전략이에요'; }
  $('menuBadge').hidden = !inc.length;
  frontLabel();
  $('btnSound').textContent = S.sound ? '소리 끔' : '소리';
  $('btnSound').setAttribute('aria-label', S.sound ? '소리 끄기' : '소리 켜기');
  renderPanel(inc, ranked, sc);
  if (S.sheet?.live) S.sheet.live();
  tick();
}

// PC 오른쪽 패널 5개 카드
function renderPanel(inc, ranked, sc) {
  const g = S.game, gu = myGu(), side = mySide(), t = now();
  const li = (...k) => h('li', {}, ...k), empty = text => h('li', { class: 'empty' }, text);
  const cd = (iso, ours) => h('span', { class: 'cd' + (ours ? ' ours' : ''), 'data-arrive': iso }, fmtLeft(Date.parse(iso) - t));
  $('pnIncN').textContent = inc.length;
  $('pnInc').replaceChildren(...(inc.length ? inc.map(m => {
    const c = S.idx.byId.get(m.dst), need = shortfall(m, c);
    const b = h('button', { class: 'btn' + (need > 0 ? ' danger' : ''), type: 'button', onclick: () => { S.map.focus(c.id); openReinforce(c.id); } }, '증원');
    return li(h('span', {}, h('b', {}, `${m.npc ? '정령' : guOf(m.gu).short} ${m.troops} → ${c.name}`), h('br'), h('small', {}, `수비 ${c.defense} · ${need > 0 ? need + ' 부족' : '막을 수 있음'}`)),
      h('span', { style: 'display:flex;flex-direction:column;align-items:flex-end;gap:4px' }, cd(m.arrive_at), b));
  }) : [empty(side ? '지금은 조용해요.' : '구를 고르면 보여요.')]));
  const mine = (g.marches || []).filter(m => side && sideOf(S.idx, m.gu) === side);
  $('pnMarch').replaceChildren(...(mine.length ? mine.map(m => {
    const joined = mine.filter(x => x.dst === m.dst).length;
    return li(h('span', {}, h('b', {}, `${m.kind === 'settle' ? '개척' : '진군'} ${S.idx.byId.get(m.dst).name}`), h('br'),
      h('small', {}, `${m.npc ? '등불 정령' : guOf(m.gu).short} ${m.troops}명` + (joined > 1 ? ` · ${joined}무리 합류` : ''))), cd(m.arrive_at, true));
  }) : [empty('움직이는 무리가 없어요.')]));
  const flags = g.flags || [];
  $('pnFlags').replaceChildren(...(flags.length ? flags.map(([id, n]) => li(h('b', {}, S.idx.byId.get(id).name), h('span', {}, `깃발 ${n}개`)))
    : [empty(side ? '아직 없어요. 칸을 눌러 깃발을 꽂아 보세요.' : '구를 고르면 보여요.')]));
  $('pnRank').replaceChildren(
    ...['n', 's'].map(sd => { const el = li(h('b', {}, allianceName(sd)), h('span', { class: 'num' }, `${sc.side[sd].score}점`)); if (sd === side) el.className = 'me'; return el; }),
    ...ranked.map((x, i) => li(h('span', {}, `${i + 1}. ${x.name}`), h('span', { class: 'num' }, `${x.score}점 · ${x.tiles}칸`))));
  const chat = $('pnChat');
  if (gu && CHAT[gu]) { chat.href = CHAT[gu]; chat.textContent = `${guOf(gu).name} 오픈채팅 열기`; chat.removeAttribute('aria-disabled'); }
  else { chat.removeAttribute('href'); chat.setAttribute('aria-disabled', 'true'); chat.textContent = gu ? `${guOf(gu).name} 오픈채팅 준비 중` : '오픈채팅'; }
}
// 막으려면 더 쌓아야 할 수비(운이 가장 나쁜 1.1배 기준). 0 이하면 막을 수 있다.
function shortfall(m, c) {
  const opts = { ownNeighbors: ownNeighborCount(S.idx, c.id, c.owner), type: guOf(c.owner).type, bridge: c.kind === 'bridge' };
  const atk = attackPower(m.troops, m.torch, guOf(m.gu).type) * 1.1, def = defensePower(c.defense, opts), unit = defensePower(1, opts);
  return Math.ceil((atk - def) / unit);
}

// 0.5초마다: 시계, 병력, 경고 카드, 안내 칩, 탭 제목
function tick() {
  const g = S.game; if (!g) return;
  const t = now(), ph = g.phase;
  S.sunbar?.(ph, t);
  const m = me();
  if (m?.active) {
    const n = troopsLocal(m.troops, m.rate, S.fetchedAt, t);
    $('troops').textContent = `병력 ${n}/${BAL.troopCap}`;
    $('troopBar').style.width = (n / BAL.troopCap * 100) + '%';
  }
  const side = mySide();
  const inc = side ? incoming(S.idx, g.marches, side) : [];
  const warn = $('warn');
  let target = null;
  warn.classList.toggle('night', ph.phase === 'night');
  if (ph.phase === 'day' && inc.length) {
    const a = inc[0], c = S.idx.byId.get(a.dst), left = fmtLeft(Date.parse(a.arrive_at) - t);
    target = c.id;
    $('warnTitle').textContent = `${a.npc ? '등불 정령' : guOf(a.gu).short} 횃불꾼 ${Math.round(a.troops * a.torch)} → ${c.name}` + (inc.length > 1 ? ` 외 ${inc.length - 1}` : '');
    $('warnSub').textContent = `수비 ${c.defense} · ${left} 후 도착`;
    document.title = `(${left}) 공격받는 중 · 어둑시니`;
  } else {
    document.title = '어둑시니';
    if (ph.phase === 'night' && side) {
      const c = darkFront(S.idx, side).sort((x, y) => x.defense - y.defense)[0];
      if (c) {
        target = c.id;
        $('warnTitle').textContent = `어둠이 ${c.name} 칸에 닿았어요`;
        $('warnSub').textContent = `수비 ${c.defense} · ` + (ph.tick < 8 ? `다음 침식 ${fmtLeft(Date.parse(ph.next_tick) - t)}` : '오늘 밤 침식 끝');
      }
    }
  }
  warn.dataset.tile = target || '';
  warn.hidden = !target || (!!S.sheet && !isPC());
  $('guide').textContent = ph.phase === 'night' ? `지금 이 칸을 보는 사람 ${S.watchers}명 · 많이 볼수록 어둠이 커져요`
    : ph.phase === 'seal' ? '봉인 — 해가 뜨면 잿빛 칸을 다시 개척할 수 있어요'
    : !side ? '구청 6곳에서 등불을 켜고 어둠을 밝혀 나가요 · 강북 3구 연합 대 강남 3구 연합'
    : isPC() ? '어둠 칸을 눌러 개척 · 다른 연합 불빛과 만나면 진군 · 우리 칸을 끌어 놓아도 돼요' : '어둠 칸을 눌러 개척 · 다른 연합 불빛과 만나면 진군';
  $('guide').hidden = !!S.sheet && !isPC();
  $('btnFront').hidden = !!S.sheet && !isPC();
}

// ---------- 시트 ----------
function openSheet(title, body, live) {
  $('sheetTitle').textContent = title;
  $('sheetBody').replaceChildren(...[].concat(body).filter(Boolean));
  $('sheet').hidden = false;
  S.sheet = { title, live };
  tick();
  setTimeout(fitToSheet, 0);
}
// 폰: 시트가 가린 만큼 지도를 위로 올리고, 고른 칸을 크게 보여 준다
function fitToSheet() {
  const mobile = !isPC() && S.sheet;
  S.map.setInset(mobile ? $('sheet').offsetHeight - document.querySelector('.bottom').offsetHeight : 0);
  if (mobile && S.selected) S.map.focus(S.selected); else S.map.clamp();
}
function closeSheet() {
  $('sheet').hidden = true; S.sheet = null;
  S.selected = null; S.map.set({ selected: null }); watchNow();
  S.map.setInset(0); render();
}
$('sheetClose').addEventListener('click', closeSheet);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.sheet) closeSheet(); });

const STATE_TEXT = { dark: '어둠(아직 아무도 밝히지 않은 칸)', gray: '잿빛(밤에 어둠에 먹힌 칸)', lit: '등불', river: '한강(건널 수 없어요)' };

// 봉인된 구 칸: 구 이름, 열어 주세요 투표
function openSealed(c) {
  const g = guOf(c.home); if (!g) return;
  const build = () => {
    const votes = S.game?.votes?.[g.id] || 0, mine = (S.game?.my_votes || []).includes(g.id);
    const t = TYPES[g.type];
    const btn = !S.session
      ? h('button', { class: 'btn primary', type: 'button', onclick: () => showOnboard('story') }, '참여하고 투표하기')
      : h('button', { class: 'btn primary', type: 'button', disabled: mine, onclick: async e => {
        e.target.disabled = true;
        try { await rpc('vote_gu', { pick: g.id }); toast(`${g.name}에 한 표를 넣었어요.`); await refresh(); } catch (err) { toast(err.message); e.target.disabled = false; }
      } }, mine ? '투표했어요' : `${g.name} 열어 주세요`);
    return [
      h('p', {}, `${c.name} · 아직 봉인된 땅이에요. 표가 모이면 다음 시즌에 열어요.`),
      h('dl', { class: 'kv' }, h('dt', {}, '구 유형'), h('dd', {}, `${t.name} · ${g.symbol}`), h('dt', {}, '열어 달라는 표'), h('dd', { class: 'num' }, `${votes}표`)),
      btn];
  };
  openSheet(`${g.name} · 봉인`, build(), () => { $('sheetBody').replaceChildren(...build()); });
}

function openTile(id) {
  const c = S.idx.byId.get(id); if (!c) return;
  if (c.sealed) { S.selected = null; S.map.set({ selected: null }); return openSealed(c); }
  S.selected = id; S.map.set({ selected: id }); watchNow(); render();
  const build = () => {
    const gu = myGu(), side = mySide(), ph = phase(), st = tileState(c);
    const inc = (S.game.marches || []).filter(m => m.dst === id);
    const kids = [];
    const kv = h('dl', { class: 'kv' }, h('dt', {}, '상태'), h('dd', {}, STATE_TEXT[st] || ''));
    if (c.owner) kv.append(h('dt', {}, '주인'), h('dd', {}, h('span', { class: 'chip' }, h('span', { class: 'dot', style: `background:var(--gu-${c.owner})` }), `${guOf(c.owner).name} · ${sideShort(sideOf(S.idx, c.owner))} 연합`)));
    if (c.kind !== 'river') {
      if (c.owner) {
        kv.append(h('dt', {}, '수비 병력'), h('dd', { class: 'num' }, `${c.defense} / ${BAL.tileCap}`));
        const nb = ownNeighborCount(S.idx, id, c.owner);
        kv.append(h('dt', {}, '연결 보너스'), h('dd', {}, `방어 +${Math.round(Math.min(BAL.linkMax, BAL.linkPer * nb) * 100)}% (붙은 연합 칸 ${nb})`));
      } else if (gu) {
        const need = settleNeedFor(S.idx, id, gu), prog = c.progress?.[side] || 0;
        kv.append(h('dt', {}, '개척 필요 병력'), h('dd', { class: 'num' }, `${need}명` + (prog ? ` · 쌓인 진행 ${prog}` : '')));
      }
      if (c.hall) kv.append(h('dt', {}, '구청'), h('dd', {}, '꺼지지 않는 시작 등불이에요. 빼앗을 수 없어요.'));
      if (c.effect) kv.append(h('dt', {}, '랜드마크 효과'), h('dd', {}, `${effectText(c.effect)} (가진 연합 전체, 같은 종류 최대 15%)`));
      if (c.kind === 'bridge') kv.append(h('dt', {}, '다리'), h('dd', {}, c.saetBridge ? `여의도로 들어가는 샛강 다리예요. 개척할 때 병력이 ${BAL.saetBridge}명 더 들어요.` : `강을 건너는 유일한 길이에요. 개척할 때 병력이 ${BAL.bridgeSettle}명 더 들어요.`));
      if (c.island) kv.append(h('dt', {}, '여의도'), h('dd', {}, '섬이라 다리 칸으로만 들어갈 수 있어요.'));
    } else kv.append(h('dt', {}, '건너기'), h('dd', {}, '다리 칸으로 건너요'));
    kids.push(kv);
    if (inc.length) {
      kids.push(h('h3', {}, '다가오는 무리'));
      kids.push(h('ul', { class: 'list' }, inc.map(m => h('li', {},
        h('span', {}, h('span', { class: 'dot', style: `background:var(--gu-${m.gu})` }), ` ${m.npc ? '등불 정령' : guOf(m.gu).short} ${m.troops}명 · ${m.kind === 'settle' ? '개척' : '진군'}`),
        h('span', { class: 'num', 'data-arrive': m.arrive_at }, fmtLeft(Date.parse(m.arrive_at) - now()))))));
    }
    const row = h('div', { class: 'row' });
    if (side && canSettle(S.idx, id, side)) row.append(h('button', { class: 'btn primary', type: 'button', disabled: ph !== 'day', onclick: () => openSettle(id) }, ph === 'day' ? '개척' : '개척(낮에만)'));
    if (side && canAttack(S.idx, id, side)) row.append(h('button', { class: 'btn primary', type: 'button', disabled: ph !== 'day', onclick: () => openMarch(id) }, ph === 'day' ? '진군' : '진군(낮에만)'));
    if (side && canReinforce(S.idx, id, side)) row.append(h('button', { class: 'btn primary', type: 'button', disabled: ph === 'seal', onclick: () => openReinforce(id) }, '증원'));
    if (side && c.kind !== 'river' && !canReinforce(S.idx, id, side)) row.append(h('button', { class: 'btn', type: 'button', onclick: () => plantFlag(id) }, me().flag === id ? '깃발 꽂음' : '깃발 꽂기'));
    if (row.childElementCount) kids.push(row);
    if (side && isDark(c) && !canSettle(S.idx, id, side)) kids.push(h('p', { class: 'hint' }, '우리 연합 땅에 붙은 칸부터 개척할 수 있어요.'));
    if (side && c.owner && c.hall && sideOf(S.idx, c.owner) !== side) kids.push(h('p', { class: 'hint' }, '구청 칸은 칠 수 없어요.'));
    if (!S.session) kids.push(h('button', { class: 'btn primary', type: 'button', onclick: () => showOnboard('story') }, '등불지기로 참여하기'));
    return kids;
  };
  openSheet(c.name, build(), () => { $('sheetBody').replaceChildren(...build().filter(Boolean)); });
}

// 개척: 우리 연합 땅에 붙은 어둠·잿빛 칸으로 병력을 보낸다. 모자라면 진행도로 쌓이고, 같은 연합 병력과 합쳐진다
function openSettle(dstId) {
  const gu = myGu(), side = mySide(); if (!side) return;
  if (!canSettle(S.idx, dstId, side)) { toast('우리 연합 땅에 붙은 어둠 칸만 개척할 수 있어요.'); return; }
  const dst = S.idx.byId.get(dstId);
  S.selected = dstId; S.map.set({ selected: dstId });
  const have = troopsLocal(me().troops, me().rate, S.fetchedAt, now());
  if (have < 1) { toast('병력이 없어요. 시간이 지나면 쌓여요.'); return; }
  const need = settleNeedFor(S.idx, dstId, gu), prog = dst.progress?.[side] || 0, remain = Math.max(1, need - prog);
  const src = bestSource(S.idx, dstId, side);
  const nIn = h('input', { type: 'range', min: 1, max: have, value: Math.min(have, remain), id: 'sN' });
  const nOut = h('span', { class: 'num' }), info = h('div', { class: 'box' });
  const go = h('button', { class: 'btn primary', type: 'button' }, '개척 보내기');
  const upd = () => {
    const n = +nIn.value;
    nOut.textContent = `${n}명`;
    const pv = marchPreview(S.idx, src, dstId, gu, me().mods || {});
    const arrive = now() + pv.minutes * 60000, late = arrive > Date.parse(S.game.phase.sunset);
    info.replaceChildren(...[
      h('p', {}, `필요 병력 ${need}명` + (prog ? ` · 이미 쌓인 진행 ${prog}명` : '') + ` (구청에서 멀수록 비싸요)`),
      h('p', {}, '도착 ', h('b', { class: 'num' }, fmtClock(arrive)), ` (${pv.minutes}분 뒤) · 출발 ${S.idx.byId.get(src).name}`),
      n >= remain ? h('p', { class: 'good' }, `도착하면 불이 켜지고 수비 ${Math.max(BAL.minHold, n - remain)}으로 시작해요${n - remain > BAL.minHold ? '(필요보다 더 보낸 만큼)' : ''}.`)
        : h('p', {}, `진행도로 쌓여요(${prog + n}/${need}). 같은 연합이 보태면 켜져요. 자정에 사라져요.`),
      late ? h('p', { class: 'bad' }, '일몰 전에 도착하지 못해 보낼 수 없어요.') : null].filter(Boolean));
    go.disabled = late;
  };
  nIn.addEventListener('input', upd);
  go.addEventListener('click', async () => {
    go.disabled = true;
    try {
      const r = await rpc('settle', { dst: dstId, n: +nIn.value, torch: 0.5 });
      toast(`개척 출발! ${fmtClock(Date.parse(r.arrive_at))} 도착`); beep(660); closeSheet(); refresh();
    } catch (e) { toast(e.message); go.disabled = false; }
  });
  openSheet(`${dst.name} 개척`, [h('div', { class: 'slider' }, h('label', { for: 'sN' }, '보낼 병력', nOut), nIn), info, go]);
  upd();
}

function openMarch(dstId, srcId) {
  const gu = myGu(), side = mySide(); if (!side) return;
  if (canSettle(S.idx, dstId, side)) return openSettle(dstId);
  if (!canAttack(S.idx, dstId, side)) { toast('다른 연합의 칸 중 우리 땅에 맞닿은 칸만 칠 수 있어요.'); return; }
  const dst = S.idx.byId.get(dstId);
  const src = srcId && canReinforce(S.idx, srcId, side) ? srcId : bestSource(S.idx, dstId, side);
  S.selected = dstId; S.map.set({ selected: dstId });
  const have = troopsLocal(me().troops, me().rate, S.fetchedAt, now());
  if (have < 1) { toast('병력이 없어요. 시간이 지나면 쌓여요.'); return; }
  const nIn = h('input', { type: 'range', min: 1, max: have, value: Math.min(have, Math.max(1, Math.ceil(have * 0.8))), id: 'mN' });
  const rIn = h('input', { type: 'range', min: 0, max: 100, step: 10, value: Math.round(torchRatio() * 100), id: 'mR' });
  const nOut = h('span', { class: 'num' }), rOut = h('span', {}), info = h('div', { class: 'box' });
  const go = h('button', { class: 'btn primary', type: 'button' }, '진군 보내기');
  const upd = () => {
    const n = +nIn.value, r = +rIn.value / 100;
    nOut.textContent = `${n}명`;
    rOut.textContent = `횃불꾼 ${Math.round(n * r)} · 등롱지기 ${n - Math.round(n * r)}`;
    const pv = marchPreview(S.idx, src, dstId, gu, me().mods || {});
    const arrive = now() + pv.minutes * 60000;
    const atk = attackPower(n, r, guOf(gu).type);
    const def = defensePower(dst.defense, { ownNeighbors: ownNeighborCount(S.idx, dstId, dst.owner), type: guOf(dst.owner).type, bridge: dst.kind === 'bridge' });
    const odds = atk * 0.9 > def ? ['확실', 'good'] : atk * 1.1 > def ? ['반반', ''] : ['어려움', 'bad'];
    const late = arrive > Date.parse(S.game.phase.sunset);
    info.replaceChildren(...[
      h('p', {}, `출발 ${S.idx.byId.get(src).name} → ${dst.name} · 거리 ${pv.dist}칸`),
      h('p', {}, '도착 ', h('b', { class: 'num' }, fmtClock(arrive)), ` (${pv.minutes}분 뒤)`),
      h('p', {}, `공격력 약 ${Math.round(atk)} 대 방어력 약 ${Math.round(def)} · 승산 `, h('b', { class: odds[1] }, odds[0])),
      late ? h('p', { class: 'bad' }, '일몰 전에 도착하지 못해 보낼 수 없어요.') : null].filter(Boolean));
    go.disabled = late;
  };
  nIn.addEventListener('input', upd); rIn.addEventListener('input', upd);
  go.addEventListener('click', async () => {
    go.disabled = true;
    try {
      store.set('torch', String(+rIn.value / 100));
      const r = await rpc('send_march', { src, dst: dstId, n: +nIn.value, torch: +rIn.value / 100 });
      toast(`진군 출발! ${fmtClock(Date.parse(r.arrive_at))} 도착`); beep(660); closeSheet(); refresh();
    } catch (e) { toast(e.message); go.disabled = false; }
  });
  openSheet(`${dst.name} 진군`, [
    h('div', { class: 'slider' }, h('label', { for: 'mN' }, '보낼 병력', nOut), nIn),
    h('div', { class: 'slider' }, h('label', { for: 'mR' }, '횃불꾼 비율', rOut), rIn,
      h('p', { class: 'hint' }, '횃불꾼은 공격 1.2, 등롱지기는 공격 0.8이에요. 이기면 남은 병력이 칸을 지켜요.')),
    info, h('p', { class: 'hint' }, '출발 칸은 가장 가까운 우리 연합 칸이에요. 우리 칸을 끌어 적 칸에 놓아도 돼요.'), go]);
  upd();
}

function openReinforce(id) {
  const side = mySide(), c = S.idx.byId.get(id);
  if (!canReinforce(S.idx, id, side)) { toast('우리 연합 칸에만 증원할 수 있어요.'); return; }
  const have = troopsLocal(me().troops, me().rate, S.fetchedAt, now());
  const room = BAL.tileCap - c.defense, max = Math.min(have, room);
  if (max < 1) { toast(room < 1 ? '이 칸은 수비가 가득 찼어요.' : '병력이 없어요. 시간이 지나면 쌓여요.'); return; }
  const nIn = h('input', { type: 'range', min: 1, max, value: max, id: 'rN' });
  const out = h('span', { class: 'num' });
  const upd = () => { out.textContent = `${nIn.value}명 → 수비 ${c.defense + +nIn.value}`; };
  nIn.addEventListener('input', upd);
  const go = h('button', { class: 'btn primary', type: 'button' }, '증원하기');
  go.addEventListener('click', async () => {
    go.disabled = true;
    try { const r = await rpc('reinforce', { tile: id, n: +nIn.value }); toast(`${c.name} 수비 ${r.defense}`); beep(780); closeSheet(); refresh(); }
    catch (e) { toast(e.message); go.disabled = false; }
  });
  const night = phase() === 'night', ally = c.owner !== myGu();
  openSheet(`${c.name} 증원`, [
    h('div', { class: 'slider' }, h('label', { for: 'rN' }, '쌓을 병력', out), nIn),
    ally ? h('p', { class: 'hint' }, `${guOf(c.owner).name} 칸이에요. 같은 연합이라 증원할 수 있어요.`) : null,
    h('p', { class: 'hint' }, night ? '밤에는 어둠과 맞닿은 가장자리 칸부터 채워 주세요. 등롱지기는 어둠 저항이 20% 높아요.' : '진군선을 보고 도착 전에 쌓아 주세요. 칸 수비는 300까지 쌓을 수 있어요.'),
    go]);
  upd();
}

async function plantFlag(id) {
  try { await rpc('plant_flag', { tile: id }); toast('깃발을 꽂았어요. 가장 많이 꽂힌 칸이 오늘 우리 연합의 목표가 돼요.'); refresh(); }
  catch (e) { toast(e.message); }
}
// 고른 칸이 없을 때 개척할 칸: 깃발 최다 → 개척 비용이 가장 싼 칸
function autoSettleTarget() {
  const side = mySide(), gu = myGu();
  const flagged = (S.game.flags || []).find(([id]) => canSettle(S.idx, id, side))?.[0];
  if (flagged) return flagged;
  let best = null;
  for (const c of S.idx.byId.values()) if (canSettle(S.idx, c.id, side)) { const n = settleNeedFor(S.idx, c.id, gu); if (!best || n < best.n) best = { id: c.id, n }; }
  return best?.id ?? null;
}

// 아래 버튼: 고른 칸이 맞으면 바로, 아니면 알맞은 칸을 찾는다
$('btnMarch').addEventListener('click', () => {
  const side = mySide(); if (!side || phase() !== 'day') return;
  const act = primaryAction(S.selected);
  if (S.selected && act === 'attack') return openMarch(S.selected);
  if (S.selected && canSettle(S.idx, S.selected, side)) return openSettle(S.selected);
  const t = autoSettleTarget();
  if (t) { S.map.focus(t); return openSettle(t); }
  toast('개척할 칸을 지도에서 눌러 주세요.');
});
$('btnReinforce').addEventListener('click', () => {
  const side = mySide(); if (!side) return;
  if (S.selected && canReinforce(S.idx, S.selected, side)) return openReinforce(S.selected);
  const inc = incoming(S.idx, S.game.marches, side)[0];
  const pick = inc ? inc.dst : (phase() === 'night' ? darkFront(S.idx, side).sort((a, b) => a.defense - b.defense)[0]?.id : null);
  if (pick) { S.map.focus(pick); return openReinforce(pick); }
  toast('증원할 우리 연합 칸을 지도에서 눌러 주세요.');
});
$('warn').addEventListener('click', e => {
  const id = +$('warn').dataset.tile; if (!id) return;
  S.map.focus(id);
  if (e.target.closest('#warnBtn')) openReinforce(id); else openTile(id);
});
// 둘러보는 중: 시범 전선 ↔ 서울 전체, 구가 있으면: 우리 전선으로
function frontLabel() { $('frontLbl').textContent = myGu() ? '우리 전선으로' : S.map.view === 'open' ? '서울 전체' : '시범 전선'; }
$('btnFront').addEventListener('click', () => {
  if (!myGu() && S.map.view === 'open') S.map.fitAll(); else if (!myGu()) S.map.fitOpen(); else S.map.home();
  frontLabel();
});
$('btnJoin').addEventListener('click', () => showOnboard(S.session ? 'gu' : 'story'));
$('btnMenu').addEventListener('click', openMenu);
$('btnMenuPc').addEventListener('click', openMenu);
$('btnSound').addEventListener('click', () => { S.sound = !S.sound; store.set('sound', S.sound ? '1' : '0'); beep(); render(); });
$('emblem').addEventListener('click', () => (S.session ? openRanking() : showOnboard('story')));

function openMenu() {
  const m = me(), gu = myGu();
  const items = [
    m?.active ? h('div', { class: 'box' }, h('b', {}, `${m.nickname} · ${guOf(gu).name} · ${allianceName(m.side)}`),
      h('span', { class: 'hint' }, `${TYPES[guOf(gu).type].name} — ${TYPES[guOf(gu).type].good} / ${TYPES[guOf(gu).type].bad}`),
      h('span', { class: 'hint' }, `기여도 ${m.contrib} · 병력 생산 시간당 ${m.rate}`)) : null,
    h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', onclick: openRanking }, '순위'),
      h('button', { class: 'btn', type: 'button', onclick: openReport }, '일출 리포트')),
    gu ? (CHAT[gu]
      ? h('a', { class: 'btn', href: CHAT[gu], target: '_blank', rel: 'noopener', style: 'text-align:center;text-decoration:none' }, `${guOf(gu).short} 오픈채팅 열기`)
      : h('p', { class: 'hint' }, `${guOf(gu).short} 오픈채팅 링크는 아직 없어요.`)) : null,
    h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', onclick: e => { S.sound = !S.sound; store.set('sound', S.sound ? '1' : '0'); e.target.textContent = S.sound ? '소리 끄기' : '소리 켜기'; beep(); } }, S.sound ? '소리 끄기' : '소리 켜기'),
      h('button', { class: 'btn', type: 'button', onclick: openHelp }, '규칙')),
    h('button', { class: 'btn', type: 'button', onclick: () => showOnboard('home') }, '홈 화면에 추가하는 법'),
    S.session ? h('button', { class: 'linkbtn', type: 'button', onclick: async () => { await sb.auth.signOut(); closeSheet(); } }, '로그아웃')
      : h('button', { class: 'btn primary', type: 'button', onclick: () => showOnboard('story') }, '등불지기로 참여하기'),
  ];
  openSheet('메뉴', items);
}

function openHelp() {
  const p = t => h('p', {}, t);
  openSheet('규칙', [
    p('해가 지면 도시는 어둑시니에게 먹혀요. 시즌이 시작되면 도시 전체가 어둠이고, 각 구는 구청 칸 하나만 불을 켠 채 시작해요. 시간은 실제 서울 일출·일몰을 따라요.'),
    h('h3', {}, '낮 — 개척과 쟁탈'),
    p('개척: 우리 연합 땅에 붙은 어둠 칸에 병력을 보내 불을 켜요. 필요 병력은 20 + 5 × 구청까지의 칸 거리예요(한강 다리는 +10, 여의도로 가는 샛강 다리는 +45, 잿빛 칸은 절반). 모자라면 진행도로 쌓이고, 같은 연합이 보태면 켜져요.'),
    p('쟁탈: 다른 연합 땅과 맞닿은 등불 칸만 칠 수 있어요. 공격력 × (0.9~1.1)이 방어력보다 크면 점령해요. 붙어 있는 같은 연합 칸마다 방어가 5%씩(최대 30%) 올라가요. 구청 칸은 빼앗을 수 없어요.'),
    p('증원: 같은 연합이면 어느 구의 칸이든 증원할 수 있어요. 병력은 시간당 30명씩, 90명까지 쌓여요. 일몰 전에 도착하지 못하는 무리는 보낼 수 없어요.'),
    h('h3', {}, '밤 — 어둑시니'),
    p('일몰부터 자정까지는 증원만 할 수 있어요. 어둑시니는 어둠과 맞닿은 개척지 가장자리부터 여덟 번 압력을 넣고, 수비가 모자라면 그 칸은 잿빛이 돼요. 그 칸을 들여다보는 사람이 많을수록 압력이 세져요. 자정부터 일출까지는 봉인 시간이에요.'),
    h('h3', {}, '랜드마크와 점수'),
    p('남산서울타워·보라매공원(시야 +2칸), 서울역·영등포역·더현대·파크원(병력 생산 +5%), 국회의사당(시간 -10%), 63빌딩(밤 저항 +10%). 여의도는 섬이라 다리로만 들어가요. 시즌 점수는 밝힌 칸 + 랜드마크 칸 × 3이고, 일요일 긴 밤(압력 1.5배)이 끝나면 연합 점수로 승패를 정해요.'),
    h('h3', {}, '등불 정령'),
    p('사람이 적을 때 등불 정령이 함께 움직여요. 사람과 같은 규칙으로 움직이고, 등불지기가 늘면 정령은 떠나요. 랜드마크 칸의 마지막 불은 사람만 켤 수 있어요.'),
  ]);
}

async function openRanking() {
  openSheet('순위', [h('p', { class: 'hint' }, '불러오는 중')]);
  try {
    const r = await rpc('ranking');
    const sc = scores(S.idx), counts = countTiles(S.idx);
    const ranked = rankGus([...S.idx.gu.values()], counts, sc), side = mySide();
    const maxS = Math.max(1, sc.side.n.score, sc.side.s.score), max = Math.max(1, ...ranked.map(g => g.score));
    const kids = [h('p', { class: 'hint' }, `시즌 ${r.season} · 점수 = 밝힌 칸 + 랜드마크 칸 × 3`)];
    for (const sd of ['n', 's']) kids.push(h('div', { class: 'rankrow' + (sd === side ? ' me' : '') },
      h('span', {}, ''), h('span', {}, `${sideShort(sd)} 연합`),
      h('span', { class: 'rankbar' }, h('i', { style: `width:${sc.side[sd].score / maxS * 100}%;background:var(--${sd === side ? 'ours' : 'enemy'})` })),
      h('span', { class: 'num' }, sc.side[sd].score)));
    kids.push(h('h3', {}, '구별'));
    ranked.forEach((g, i) => kids.push(h('div', { class: 'rankrow' + (g.id === myGu() ? ' me' : '') },
      h('span', { class: 'num' }, i + 1), h('span', {}, g.short),
      h('span', { class: 'rankbar' }, h('i', { style: `width:${g.score / max * 100}%;background:var(--gu-${g.id})` })),
      h('span', { class: 'num' }, g.score))));
    if (r.me) kids.push(h('div', { class: 'box' }, h('b', {}, `내 기여도 ${r.me.contrib} · 우리 구 ${r.me.rank}위`),
      h('span', { class: 'hint' }, '증원한 병력 1명당 1점, 개척 1번에 10점, 점령 1번에 20점'),
      h('ol', { class: 'list' }, (r.top || []).map(([n, c]) => h('li', {}, h('span', {}, n), h('span', { class: 'num' }, c))))));
    const npcs = (r.gus || []).reduce((a, g) => a + (g.npcs || 0), 0);
    kids.push(h('p', { class: 'hint' }, `사람이 적을 때 등불 정령이 함께 움직여요. 등불지기가 늘면 정령은 떠나요. 지금 정령 ${npcs}명.`));
    if (r.last) kids.push(h('p', { class: 'hint' }, `지난 시즌(${r.last.id}) 우승: ${r.last.winner_side ? allianceName(r.last.winner_side) : guOf(r.last.winner)?.name || '-'}`));
    openSheet('순위', kids);
  } catch (e) { toast(e.message); }
}

async function openReport(auto) {
  try {
    const r = await rpc('sunrise_report');
    const gu = myGu();
    const kids = [h('p', { class: 'hint' }, `${r.night} 밤${r.long_night ? '(긴 밤)' : ''}의 결과`)];
    // 오늘의 성적: 밝힌 칸·지킨 비율 1위 구
    const best = dayBest(r);
    if (best) {
      const g1 = r.gus.find(g => g.id === best.settled), g2 = r.gus.find(g => g.id === best.kept);
      kids.push(h('div', { class: 'box' }, h('b', {}, '오늘의 성적'),
        h('span', {}, `가장 많이 밝힌 구: ${guOf(g1.id).name} (${g1.settled}칸)`),
        h('span', {}, `가장 잘 지킨 구: ${guOf(g2.id).name} (${Math.round((g2.kept_ratio ?? 1) * 100)}%)`)));
    }
    if (gu) {
      const line = reportLine(r, gu, S.idx);
      kids.push(h('div', { class: 'box' },
        h('b', {}, `${guOf(gu).name}: 밝힌 칸 ${line.settled ?? '-'} · 남은 등불 ${line.kept ?? '-'}칸 · 잃은 칸 ${line.lost.length}`),
        h('span', { class: 'hint' }, line.lost.length ? '어둠에 먹힌 칸: ' + line.lost.join(', ') : '어둠에 내준 칸이 없어요.')));
      const card = h('button', { class: 'btn primary', type: 'button' }, '공유 카드 만들기');
      card.addEventListener('click', () => shareCard(r, line));
      kids.push(card);
    }
    kids.push(h('ul', { class: 'list' }, r.gus.map(g => h('li', {}, h('span', {}, guOf(g.id).short),
      h('span', {}, `밝힘 ${g.settled ?? '-'} · 지킴 ${g.kept_ratio == null ? '-' : Math.round(g.kept_ratio * 100) + '%'} · 잃음 ${g.lost.length}`)))));
    if (auto && gu && reportLine(r, gu, S.idx).kept == null) return; // 기록 없는 첫날은 저절로 열지 않는다
    openSheet('일출 리포트', kids);
  } catch (e) { if (!auto) toast(e.message); }
}

async function shareCard(r, line) {
  const gu = myGu();
  const cv = document.createElement('canvas'); cv.width = 1080; cv.height = 1350;
  await document.fonts.ready;
  drawShareCard(cv, { idx: S.idx, gu, guName: guOf(gu).name, kept: line.kept, lost: line.lost.length, night: r.night });
  const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
  const file = new File([blob], `eoduk-${r.night}.png`, { type: 'image/png' });
  const text = shareText(guOf(gu).short, line.kept, line.lost.length);
  try {
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text, url: location.origin }); return; }
  } catch { /* 공유를 닫으면 내려받기로 */ }
  const a = h('a', { href: URL.createObjectURL(blob), download: file.name }); document.body.append(a); a.click(); a.remove();
  toast('카드를 내려받았어요.');
}

// ---------- 어둑시니 응시: 지금 보는 칸을 알린다(밤에 압력이 세진다) ----------
let watchTimer = null;
async function watchNow() {
  clearTimeout(watchTimer);
  if (document.hidden) return;
  try { S.watchers = await rpc('watch', { tile: S.selected || null }); } catch { S.watchers = 0; }
  watchTimer = setTimeout(watchNow, 45000);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) { refresh(); watchNow(); } });

// ---------- 온보딩 ----------
const STORY = [
  ['해가 지면 도시는 어둑시니에게 먹혀요.', '어둑시니는 어둠 속에서 쳐다볼수록 커진다는 요괴예요. 해가 지면 깨어나 불 꺼진 땅부터 삼켜요.'],
  ['도시는 어둠에 덮여 있어요.', '구청의 등불에서 시작해 어둠을 밝혀 나가요. 다른 연합의 불빛과 만나면, 그때부터는 등불을 두고 다퉈요.'],
  ['지금은 베타 시범 전선이에요', '강북 3구(마포·용산·중구)와 강남 3구(영등포·동작·관악)가 연합을 이뤘어요. 각 구는 구청에서 등불을 켜고 시작해요. 같은 연합끼리는 서로 증원할 수 있어요. 사람이 적을 때는 등불 정령이 함께 움직여요.'],
];
let pickedGu = null;
function showOnboard(step, i = 0) {
  const card = $('obCard'); $('onboard').hidden = false;
  const steps = (n) => h('div', { class: 'ob-steps', 'aria-hidden': 'true' }, [0, 1, 2, 3, 4].map(k => h('i', { class: k === n ? 'on' : '' })));
  const close = h('button', { class: 'linkbtn', type: 'button', onclick: hideOnboard }, '먼저 지도 둘러보기');
  if (step === 'story') {
    const cv = h('canvas', { width: 320, height: 180, 'aria-hidden': 'true' });
    card.replaceChildren(steps(i), cv, h('h1', { class: 'ob-title' }, STORY[i][0]), h('p', {}, STORY[i][1]),
      h('div', { class: 'ob-foot' },
        h('button', { class: 'btn primary', type: 'button', onclick: () => (i < 2 ? showOnboard('story', i + 1) : showOnboard('gu')) }, i < 2 ? '다음' : '우리 구 고르기'),
        h('div', { class: 'row', style: 'justify-content:space-between' }, close,
          h('button', { class: 'linkbtn', type: 'button', onclick: () => showOnboard('login') }, '이미 등불지기예요'))));
    startScene(cv, i, S.mapData, S.game?.tiles);
    return;
  }
  if (step === 'gu') {
    // 스크롤 없이 한 화면: 왼쪽 한강 북쪽 3개, 오른쪽 남쪽 3개. 고르면 아래 상자에 자세히, 정하기 버튼은 늘 아래에 붙어 있다.
    const counts = Object.fromEntries((S.game?.gus || []).map(g => [g.id, g]));
    const detail = h('div', { class: 'gudetail', 'aria-live': 'polite' });
    const go = h('button', { class: 'btn primary', type: 'button', onclick: () => (S.session ? showOnboard('nick') : showOnboard('signup')) });
    const cells = [];
    const update = () => {
      for (const c of cells) c.setAttribute('aria-pressed', String(c.dataset.gu === pickedGu));
      go.disabled = !pickedGu;
      go.textContent = pickedGu ? `${josa(guOf(pickedGu).name, '으로', '로')} 정하기` : '구를 골라 주세요';
      if (!pickedGu) { detail.replaceChildren(h('p', { class: 'hint' }, '구를 누르면 강점과 약점이 여기 나와요. 같은 연합끼리 서로 증원하고, 승패는 연합 점수로 정해요.')); return; }
      const g = guOf(pickedGu), t = TYPES[g.type];
      detail.replaceChildren(
        h('b', {}, `${g.name} · ${allianceName(g.side)} · ${t.name}`),
        h('span', { class: 'good' }, '+ ' + t.good), h('span', { class: 'bad' }, '- ' + t.bad));
    };
    const col = side => h('div', { class: 'gucol' }, h('p', { class: 'side' }, allianceName(side)),
      [...S.idx.gu.values()].filter(g => g.side === side && g.open).map(g => {
        const c = h('button', { class: 'gucell', type: 'button', 'data-gu': g.id, onclick: () => { pickedGu = g.id; update(); } },
          h('b', {}, h('span', { class: 'dot', style: `background:var(--gu-${g.id})` }), g.name),
          h('small', {}, `${hallOf(S.idx, g.id)?.name || ''} · ${counts[g.id]?.players ?? 0}명`));
        cells.push(c); return c;
      }));
    card.replaceChildren(steps(3), h('h1', { class: 'ob-title' }, '어느 구의 등불을 지킬까'),
      h('p', { class: 'hint' }, '시즌(한 주) 동안은 바꿀 수 없어요.'),
      h('div', { class: 'gugrid' }, col('n'), col('s')), detail,
      h('div', { class: 'ob-foot' }, go, close));
    update();
    return;
  }
  if (step === 'signup' || step === 'login' || step === 'nick') {
    const signup = step === 'signup', nickOnly = step === 'nick';
    const msg = h('p', { class: 'hint', role: 'status' });
    const f = h('form', { class: 'sheet-body' },
      (signup || nickOnly) ? h('div', { class: 'field' }, h('label', { for: 'obNick' }, '닉네임 (1~12자, 순위에 보여요. 고쳐도 돼요)'),
        h('div', { class: 'nickrow' }, h('input', { id: 'obNick', type: 'text', maxlength: MAX_NICK, required: true, value: me()?.nickname || '', autocomplete: 'off' }),
          h('button', { class: 'btn small', type: 'button', onclick: () => fillNickname(true) }, '다른 추천'))) : null,
      nickOnly ? null : h('div', { class: 'field' }, h('label', { for: 'obEmail' }, '이메일'), h('input', { id: 'obEmail', type: 'email', autocomplete: 'email', required: true })),
      nickOnly ? null : h('div', { class: 'field' }, h('label', { for: 'obPw' }, '비밀번호 (6자 이상)'), h('input', { id: 'obPw', type: 'password', minlength: 6, autocomplete: signup ? 'new-password' : 'current-password', required: true })),
      h('button', { class: 'btn primary', type: 'submit' }, signup ? '등불지기 등록' : nickOnly ? '시작하기' : '로그인'), msg);
    f.addEventListener('submit', async e => {
      e.preventDefault(); msg.textContent = '처리 중…';
      try {
        if (!nickOnly && !(signup && S.session)) { // 가입은 됐는데 닉네임이 겹쳐 다시 누른 경우는 건너뛴다
          const email = $('obEmail').value.trim(), password = $('obPw').value;
          const { data, error } = signup ? await sb.auth.signUp({ email, password }) : await sb.auth.signInWithPassword({ email, password });
          if (error) throw new Error(friendly(error));
          if (signup && !data.session) throw new Error('가입은 됐지만 이메일 확인이 켜져 있어 바로 들어갈 수 없어요. 운영자에게 알려 주세요.');
          S.session = data.session;
        }
        if (signup || nickOnly) {
          await rpc('join_game', { nick: $('obNick').value, pick: pickedGu });
          await refresh();
          showOnboard('home', 1);
        } else {
          await refresh();
          if (me()?.active) hideOnboard(); else showOnboard('gu');
        }
      } catch (err) { msg.textContent = err.message; }
    });
    card.replaceChildren(steps(4), h('h1', {}, signup ? '등불지기 등록' : nickOnly ? '이번 시즌 이름' : '다시 오셨군요'),
      signup ? h('p', { class: 'hint' }, `${guOf(pickedGu).name} · 한 사람이 한 계정으로 참여해요.`) : null, f,
      h('div', { class: 'row', style: 'justify-content:space-between' },
        h('button', { class: 'linkbtn', type: 'button', onclick: () => showOnboard('gu') }, '구 다시 고르기'),
        nickOnly ? null : h('button', { class: 'linkbtn', type: 'button', onclick: () => showOnboard(signup ? 'login' : 'signup') }, signup ? '이미 있어요, 로그인' : '처음이에요, 등록')));
    if ((signup || nickOnly) && !me()?.nickname) fillNickname(false);
    return;
  }
  if (step === 'home') {
    const ios = /iPhone|iPad/.test(navigator.userAgent);
    card.replaceChildren(h('h1', {}, i ? '등불을 밝혔어요' : '홈 화면에 추가'),
      i ? h('p', {}, `${guOf(myGu())?.name || ''}의 등불지기가 됐어요. 병력 60명으로 시작해요. 구청에서 가까운 어둠 칸부터 개척하고, 밤이 오기 전에 가장자리를 채워 주세요.`) : null,
      h('p', {}, ios ? 'Safari 아래쪽 공유 버튼 › "홈 화면에 추가"를 누르면 앱처럼 열려요.' : '브라우저 메뉴(⋮) › "홈 화면에 추가" 또는 "앱 설치"를 누르면 앱처럼 열려요.'),
      h('p', { class: 'hint' }, '30초면 충분해요. 점심, 퇴근 전 일몰 러시, 자기 전 증원.'),
      h('button', { class: 'btn primary', type: 'button', onclick: hideOnboard }, '지도로'));
  }
}
// 추천 닉네임: 후보 여러 개 중 아무도 안 쓰는 첫 번째를 칸에 넣는다(연결이 안 되면 그냥 첫 후보)
async function fillNickname(again) {
  const input = $('obNick'); if (!input) return;
  const cands = nicknameCandidates(10).filter(n => !again || n !== input.value);
  let pick = cands[0];
  try { const free = await rpc('nicknames_free', { names: cands }); if (free?.length) pick = free[0]; } catch { /* 첫 후보로 */ }
  if ($('obNick') === input) { input.value = pick; if (again) input.focus(); }
}
function hideOnboard() { $('onboard').hidden = true; store.set('seenStory', '1'); }

// ---------- 시작 ----------
let raf = 0;
function loop() { S.map.render(now()); raf = requestAnimationFrame(loop); }
setInterval(() => { if (S.game) { tick(); document.querySelectorAll('[data-arrive]').forEach(el => { el.textContent = fmtLeft(Date.parse(el.dataset.arrive) - now()); }); } }, 500);

async function start() {
  const [map] = await Promise.all([(await fetch('data/map.json')).json(), loadImages()]);
  S.mapData = map;
  S.idx = indexMap(map);
  // 시작 전 지도: 구청 칸만 켜져 있다(서버 상태가 오면 바뀐다)
  for (const c of S.idx.byId.values()) if (c.hall) { c.owner = c.hall; c.defense = BAL.hallStart; }
  S.sunbar = mountSunbar($('sunbar'));
  S.map = new MapView($('map'), S.idx, {
    onTap: id => (id ? openTile(id) : S.sheet && closeSheet()),
    onDragMarch: (src, dst) => (canSettle(S.idx, dst, mySide()) ? openSettle(dst) : openMarch(dst, src)),
  });
  document.documentElement.dataset.theme = phaseAt(Date.now()).phase === 'day' ? 'day' : 'night';
  loop();
  if (location.hostname === 'localhost') window.eodukDebug = { S, openTile, openMarch, openSettle, render }; // 로컬 시험용
  const { data } = await sb.auth.getSession();
  S.session = data.session;
  await refresh();
  subscribeRealtime();
  watchNow();
  if (!S.session) { if (!store.get('seenStory') || new URLSearchParams(location.search).has('join')) showOnboard('story'); }
  else if (!me()?.active) showOnboard('gu');
  else if (phase() !== 'night' && store.get('report') !== S.game.phase.date) { store.set('report', S.game.phase.date); openReport(true); }
  sb.auth.onAuthStateChange((ev, session) => {
    const changed = !!session !== !!S.session; S.session = session;
    if (changed) refresh();
  });
}
start().catch(e => toast('불러오지 못했어요: ' + e.message, 8000));
