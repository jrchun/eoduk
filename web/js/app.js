// 어둑시니 화면. 규칙 판정은 DB 함수(supabase/schema.sql)가 하고, 여기서는 상태를 받아 그리고 요청을 보낸다.
// 앱에서 받은 글자는 textContent로만 넣는다(innerHTML 금지).
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { TYPES, BAL, fmtLeft, fmtClock, attackPower, defensePower, phaseAt } from './rules.js';
import { indexMap, applyTiles, canAttack, bestSource, marchPreview, incoming, ownNeighborCount, troopsLocal, rankGus, countTiles, reportLine, shareText, josa, darkFront } from './view.js';
import { MapView } from './map.js';
import { drawStory, drawShareCard } from './story.js';
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
const guOf = id => S.idx.gu.get(id);
const phase = () => S.game?.phase?.phase || phaseAt(now()).phase;

function toast(text, ms = 2600) {
  const t = $('toast'); t.textContent = text; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, ms);
}
function friendly(error) {
  const m = String(error?.message || error);
  if (/Invalid login credentials/i.test(m)) return '이메일이나 비밀번호가 맞지 않습니다.';
  if (/already registered/i.test(m)) return '이미 가입한 이메일입니다. 로그인을 눌러 주세요.';
  if (/Email not confirmed/i.test(m)) return '이메일 확인이 아직 켜져 있어 로그인할 수 없습니다. 운영자에게 알려 주세요.';
  if (/Password should be/i.test(m)) return '비밀번호는 6자 이상이어야 합니다.';
  if (/Failed to fetch|NetworkError/i.test(m)) return '연결이 끊겼습니다. 잠시 후 다시 해 주세요.';
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
function render() {
  const g = S.game; if (!g) return;
  document.documentElement.dataset.theme = g.phase.phase === 'day' ? 'day' : 'night';
  const gu = myGu();
  const inc = gu ? incoming(S.idx, g.marches, gu) : [];
  for (const m of inc) if (!S.incomingSeen.has(m.id)) { S.incomingSeen.add(m.id); beep(330, 0.25); }
  S.map.set({ marches: g.marches, myGu: gu, selected: S.selected, flags: g.flags || [], phase: g.phase,
    incomingIds: new Set(inc.map(m => m.dst)), canMarch: !!gu && g.phase.phase === 'day' });
  // 위: 구 문장
  const gg = gu ? guOf(gu) : null;
  $('emblemMark').textContent = gg ? gg.short[0] : '등';
  $('emblemMark').style.background = gg ? `var(--gu-${gg.id})` : 'var(--ours)';
  $('guName').textContent = gg ? gg.name : '어둑시니';
  const counts = countTiles(S.idx);
  $('guSub').textContent = gg ? `등불 ${counts[gu] || 0}칸 · ${me().nickname}` : (S.session ? '구를 골라 주세요' : '둘러보는 중');
  $('btnMarch').disabled = !gu || g.phase.phase !== 'day';
  $('btnReinforce').disabled = !gu || g.phase.phase === 'seal';
  if (S.sheet?.live) S.sheet.live();
  tick();
}

// 0.5초마다: 시계, 병력, 공격 경고, 탭 제목, 밤 정보
function tick() {
  const g = S.game; if (!g) return;
  const t = now(), ph = g.phase;
  let lbl, val;
  if (ph.phase === 'day') { lbl = ph.rush ? '마지막 러시' : '일몰까지'; val = fmtLeft(Date.parse(ph.sunset) - t); }
  else if (ph.phase === 'night') { lbl = ph.long_night ? '긴 밤 · 봉인까지' : '봉인까지'; val = fmtLeft(Date.parse(ph.midnight) - t); }
  else { lbl = '일출까지'; val = fmtLeft(Date.parse(ph.sunrise) + 86400000 * (Date.parse(ph.sunrise) < t ? 1 : 0) - t); }
  $('clockLbl').textContent = lbl; $('clockVal').textContent = val;
  const m = me();
  if (m?.active) {
    const n = troopsLocal(m.troops, m.rate, S.fetchedAt, t);
    $('troops').textContent = `${n}/${BAL.troopCap}`;
    $('troopBar').style.width = (n / BAL.troopCap * 100) + '%';
  } else { $('troops').textContent = '-'; $('troopBar').style.width = '0'; }
  const gu = myGu();
  const inc = gu ? incoming(S.idx, g.marches, gu) : [];
  const al = $('alert');
  if (inc.length) {
    const a = inc[0], dst = S.idx.byId.get(a.dst), left = fmtLeft(Date.parse(a.arrive_at) - t);
    al.hidden = false;
    al.textContent = `공격! ${dst.name} ← ${guOf(a.gu).short} ${a.troops}명 · ${left} 뒤 도착` + (inc.length > 1 ? ` (외 ${inc.length - 1})` : '');
    al.dataset.tile = a.dst;
    document.title = `(${left}) 공격받는 중 · 어둑시니`;
  } else { al.hidden = true; document.title = '어둑시니'; }
  // 밤 정보
  const ni = $('nightInfo');
  if (ph.phase !== 'day') {
    ni.hidden = !!S.sheet && window.innerWidth < 900;
    if (ph.phase === 'night') {
      $('nightTitle').textContent = ph.long_night ? '긴 밤 — 어둑시니가 깨어났다' : '밤 — 어둑시니가 깨어났다';
      $('nightNext').textContent = ph.tick < 8 ? `다음 침식 ${fmtLeft(Date.parse(ph.next_tick) - t)} (${ph.tick}/8)` : '';
    } else { $('nightTitle').textContent = '봉인 — 어둠도 잠든 시간'; $('nightNext').textContent = ''; }
    const sel = S.selected && S.idx.byId.get(S.selected);
    $('nightWatch').textContent = ph.phase === 'night'
      ? (sel ? `지금 '${sel.name}'을 보는 사람 ${S.watchers}명 · 많이 볼수록 어둠이 세진다` : '증원만 할 수 있다. 오래 들여다보면 어둠이 커진다. 증원하고 화면을 꺼라.')
      : '자정부터 일출까지는 휴전. 해가 뜨면 잿빛 칸을 두고 쟁탈이 시작된다.';
  } else ni.hidden = true;
}

// ---------- 시트 ----------
function openSheet(title, body, live) {
  $('sheetTitle').textContent = title;
  $('sheetBody').replaceChildren(...[].concat(body).filter(Boolean));
  $('sheet').hidden = false; $('app').classList.add('has-sheet');
  S.sheet = { title, live };
  setTimeout(() => { S.map.resize(); fitToSheet(); }, 0);
}
// 폰: 시트가 가린 만큼 지도를 위로 올리고, 고른 칸을 크게 보여 준다
function fitToSheet() {
  const mobile = window.innerWidth < 900 && S.sheet;
  S.map.setInset(mobile ? $('sheet').offsetHeight - document.querySelector('.bottom').offsetHeight : 0);
  if (mobile && S.selected) S.map.focus(S.selected); else S.map.clampPan();
}
function closeSheet() {
  $('sheet').hidden = true; $('app').classList.remove('has-sheet'); S.sheet = null;
  S.selected = null; S.map.set({ selected: null }); watchNow();
  S.map.setInset(0); S.map.setZoom(1);
  setTimeout(() => S.map.resize(), 0);
}
$('sheetClose').addEventListener('click', closeSheet);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.sheet) closeSheet(); });

function ownerLabel(c) {
  if (c.kind === 'river') return '한강(건널 수 없음)';
  if (c.gray) return '잿빛 칸(주인 없음)';
  if (!c.owner) return '중립 다리';
  return guOf(c.owner).name;
}

function openTile(id) {
  const c = S.idx.byId.get(id); if (!c) return;
  S.selected = id; S.map.set({ selected: id }); watchNow();
  const build = () => {
    const gu = myGu(), ph = phase();
    const inc = (S.game.marches || []).filter(m => m.dst === id);
    const kids = [];
    const kv = h('dl', { class: 'kv' },
      h('dt', {}, '주인'), h('dd', {}, c.owner ? h('span', { class: 'chip' }, h('span', { class: 'dot', style: `background:var(--gu-${c.owner})` }), ownerLabel(c)) : ownerLabel(c)));
    if (c.kind !== 'river') {
      kv.append(h('dt', {}, '수비 병력'), h('dd', { class: 'num' }, `${c.defense} / ${BAL.tileCap}`));
      if (c.owner) kv.append(h('dt', {}, '연결 보너스'), h('dd', {}, `방어 +${Math.round(Math.min(BAL.linkMax, BAL.linkPer * ownNeighborCount(S.idx, id, c.owner)) * 100)}% (붙은 칸 ${ownNeighborCount(S.idx, id, c.owner)})`));
      if (c.kind === 'bridge') kv.append(h('dt', {}, '다리'), h('dd', {}, '강을 건너는 통로. 강변형 구가 지키면 방어 +30%'));
      if (c.gray) kv.append(h('dt', {}, '잿빛'), h('dd', {}, '어둠에 먹힌 칸. 수비 0, 진군 시간 절반'));
      if (c.edge && c.owner) kv.append(h('dt', {}, '가장자리'), h('dd', {}, '밤에 어둠과 맞닿는 칸'));
    } else kv.append(h('dt', {}, '건너기'), h('dd', {}, '다리 칸(양화·마포·한강·동작대교)으로 건넌다'));
    kids.push(kv);
    if (inc.length) {
      kids.push(h('h3', {}, '다가오는 진군'));
      kids.push(h('ul', { class: 'list' }, inc.map(m => h('li', {},
        h('span', {}, h('span', { class: 'dot', style: `background:var(--gu-${m.gu})` }), ` ${guOf(m.gu).short} ${m.troops}명 (횃불꾼 ${Math.round(m.torch * 100)}%)`),
        h('span', { class: 'num', 'data-arrive': m.arrive_at }, fmtLeft(Date.parse(m.arrive_at) - now()))))));
    }
    const row = h('div', { class: 'row' });
    if (gu && canAttack(S.idx, id, gu)) row.append(h('button', { class: 'btn primary', type: 'button', disabled: ph !== 'day', onclick: () => openMarch(id) }, ph === 'day' ? '진군' : '진군(낮에만)'));
    if (gu && c.owner === gu) row.append(h('button', { class: 'btn primary', type: 'button', disabled: ph === 'seal', onclick: () => openReinforce(id) }, '증원'));
    if (gu && c.kind !== 'river' && c.owner !== gu) row.append(h('button', { class: 'btn', type: 'button', onclick: () => plantFlag(id) }, me().flag === id ? '깃발 꽂음' : '깃발 꽂기'));
    if (row.childElementCount) kids.push(row);
    if (gu && c.kind !== 'river' && c.owner !== gu && !canAttack(S.idx, id, gu)) kids.push(h('p', { class: 'hint' }, '우리 땅에 맞닿은 칸만 칠 수 있다.'));
    if (!S.session) kids.push(h('button', { class: 'btn primary', type: 'button', onclick: () => showOnboard('story') }, '등불지기로 참여하기'));
    return kids;
  };
  openSheet(c.name, build(), () => { $('sheetBody').replaceChildren(...build().filter(Boolean)); });
}

function openMarch(dstId, srcId) {
  const gu = myGu(); if (!gu) return;
  if (!canAttack(S.idx, dstId, gu)) { toast('우리 땅에 맞닿은 칸만 칠 수 있습니다.'); return; }
  const dst = S.idx.byId.get(dstId);
  let src = srcId && S.idx.byId.get(srcId)?.owner === gu ? srcId : bestSource(S.idx, dstId, gu);
  S.selected = dstId; S.map.set({ selected: dstId });
  const have = troopsLocal(me().troops, me().rate, S.fetchedAt, now());
  if (have < 1) { toast('병력이 없습니다. 시간이 지나면 쌓입니다.'); return; }
  const nIn = h('input', { type: 'range', min: 1, max: have, value: Math.min(have, Math.max(1, Math.ceil(have * 0.8))), id: 'mN' });
  const rIn = h('input', { type: 'range', min: 0, max: 100, step: 10, value: 70, id: 'mR' });
  const nOut = h('span', { class: 'num' }), rOut = h('span', {}), info = h('div', { class: 'box' });
  const go = h('button', { class: 'btn primary', type: 'button' }, '진군 보내기');
  const upd = () => {
    const n = +nIn.value, r = +rIn.value / 100;
    nOut.textContent = `${n}명`;
    rOut.textContent = `횃불꾼 ${Math.round(n * r)} · 등롱지기 ${n - Math.round(n * r)}`;
    const pv = marchPreview(S.idx, src, dstId, gu);
    const arrive = now() + pv.minutes * 60000;
    const atk = attackPower(n, r, guOf(gu).type);
    const def = defensePower(dst.defense, { ownNeighbors: dst.owner ? ownNeighborCount(S.idx, dstId, dst.owner) : 0, type: dst.owner ? guOf(dst.owner).type : '', bridge: dst.kind === 'bridge', neutral: !dst.owner });
    const odds = atk * 0.9 > def ? ['확실', 'good'] : atk * 1.1 > def ? ['반반', ''] : ['어려움', 'bad'];
    const late = arrive > Date.parse(S.game.phase.sunset);
    info.replaceChildren(...[
      h('p', {}, `출발 ${S.idx.byId.get(src).name} → ${dst.name} · 거리 ${pv.dist}칸`),
      h('p', {}, '도착 ', h('b', { class: 'num' }, fmtClock(arrive)), ` (${pv.minutes}분 뒤)`),
      h('p', {}, `공격력 약 ${Math.round(atk)} 대 방어력 약 ${Math.round(def)} · 승산 `, h('b', { class: odds[1] }, odds[0])),
      late ? h('p', { class: 'bad' }, '일몰 전에 도착하지 못해 보낼 수 없습니다.') : null].filter(Boolean));
    go.disabled = late;
  };
  nIn.addEventListener('input', upd); rIn.addEventListener('input', upd);
  const srcPick = h('p', { class: 'hint' }, '출발 칸은 가장 가까운 우리 칸. 지도에서 우리 칸을 끌어 적 칸에 놓아도 된다.');
  go.addEventListener('click', async () => {
    go.disabled = true;
    try {
      const r = await rpc('send_march', { src, dst: dstId, n: +nIn.value, torch: +rIn.value / 100 });
      toast(`진군 출발! ${fmtClock(Date.parse(r.arrive_at))} 도착`); beep(660); closeSheet(); refresh();
    } catch (e) { toast(e.message); go.disabled = false; }
  });
  openSheet(`${dst.name} 진군`, [
    h('div', { class: 'slider' }, h('label', { for: 'mN' }, '보낼 병력', nOut), nIn),
    h('div', { class: 'slider' }, h('label', { for: 'mR' }, '횃불꾼 비율', rOut), rIn,
      h('p', { class: 'hint' }, '횃불꾼 공격 1.2, 등롱지기 공격 0.8. 도착한 병력이 판정 뒤 칸을 지킨다.')),
    info, srcPick, go]);
  upd();
}

function openReinforce(id) {
  const gu = myGu(), c = S.idx.byId.get(id);
  const have = troopsLocal(me().troops, me().rate, S.fetchedAt, now());
  const room = BAL.tileCap - c.defense, max = Math.min(have, room);
  if (max < 1) { toast(room < 1 ? '이 칸은 수비가 가득 찼습니다.' : '병력이 없습니다. 시간이 지나면 쌓입니다.'); return; }
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
  const night = phase() === 'night';
  openSheet(`${c.name} 증원`, [
    h('div', { class: 'slider' }, h('label', { for: 'rN' }, '쌓을 병력', out), nIn),
    h('p', { class: 'hint' }, night ? '밤에는 어둠과 맞닿은 칸을 먼저 채워라. 등롱지기는 어둠 저항 +20%.' : '진군선을 보고 도착 전에 쌓아라. 칸 수비 상한 300.'),
    go]);
  upd();
}

async function plantFlag(id) {
  try { await rpc('plant_flag', { tile: id }); toast('깃발을 꽂았습니다. 가장 많이 꽂힌 칸이 오늘 우리 구 목표.'); refresh(); }
  catch (e) { toast(e.message); }
}

// 아래 버튼: 고른 칸이 맞으면 바로, 아니면 알맞은 칸을 찾는다
$('btnMarch').addEventListener('click', () => {
  const gu = myGu(); if (!gu) return;
  if (S.selected && canAttack(S.idx, S.selected, gu)) return openMarch(S.selected);
  const target = S.game.flags?.find(([id]) => canAttack(S.idx, id, gu))?.[0];
  if (target) { S.map.focus(target); return openMarch(target); }
  toast('칠 칸을 지도에서 누르세요. 우리 칸을 끌어 적 칸에 놓아도 됩니다.');
});
$('btnReinforce').addEventListener('click', () => {
  const gu = myGu(); if (!gu) return;
  if (S.selected && S.idx.byId.get(S.selected).owner === gu) return openReinforce(S.selected);
  // 공격받는 칸 → 밤이면 어둠과 맞닿은 칸 중 수비가 가장 약한 칸
  const inc = incoming(S.idx, S.game.marches, gu)[0];
  const pick = inc ? inc.dst : (phase() === 'night' ? darkFront(S.idx, gu).sort((a, b) => a.defense - b.defense)[0]?.id : null);
  if (pick) { S.map.focus(pick); return openReinforce(pick); }
  toast('증원할 우리 칸을 지도에서 누르세요.');
});
$('alert').addEventListener('click', () => { const id = +$('alert').dataset.tile; if (id) { S.map.focus(id); openTile(id); } });
$('btnMenu').addEventListener('click', openMenu);
$('emblem').addEventListener('click', () => (S.session ? openRanking() : showOnboard('story')));

function openMenu() {
  const m = me(), gu = myGu();
  const items = [
    m?.active ? h('div', { class: 'box' }, h('b', {}, `${m.nickname} · ${guOf(gu).name}`),
      h('span', { class: 'hint' }, `${TYPES[guOf(gu).type].name} — ${TYPES[guOf(gu).type].good} / ${TYPES[guOf(gu).type].bad}`),
      h('span', { class: 'hint' }, `기여도 ${m.contrib} · 병력 생산 시간당 ${m.rate}`)) : null,
    h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', onclick: openRanking }, '순위'),
      h('button', { class: 'btn', type: 'button', onclick: openReport }, '일출 리포트')),
    gu ? (CHAT[gu]
      ? h('a', { class: 'btn', href: CHAT[gu], target: '_blank', rel: 'noopener', style: 'text-align:center;text-decoration:none' }, `${guOf(gu).short} 오픈채팅 열기`)
      : h('p', { class: 'hint' }, `${guOf(gu).short} 오픈채팅 링크는 아직 없습니다.`)) : null,
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
    p('해가 지면 도시는 어둑시니에게 먹힌다. 불을 밝힌 땅만 내일을 맞는다. 시간은 실제 서울 일출·일몰을 따른다.'),
    h('h3', {}, '낮 — 등불 쟁탈전'),
    p('병력은 시간당 30명씩 쌓이고 90명이 상한이다. 진군은 우리 땅에 맞닿은 칸으로, 증원은 우리 칸에 병력을 쌓는다. 진군선은 모두에게 보이니 도착 전에 증원으로 막아라. 일몰 전에 도착하지 못하는 진군은 보낼 수 없다.'),
    p('판정: 공격력 × (0.9~1.1) > 방어력이면 점령. 칸 수비는 등롱지기(수비 1.2)이고, 붙어 있는 우리 칸마다 방어 +5%(최대 30%).'),
    h('h3', {}, '밤 — 어둑시니'),
    p('일몰부터 자정까지 구끼리 싸움은 멈추고 증원만 된다(생산 절반). 어둠은 지도 가장자리와 지난밤 잿빛이 된 칸에서 여덟 번 밀려온다. 압력이 수비를 넘으면 그 칸은 잿빛이 된다. 많은 사람이 들여다본 칸일수록 압력이 세진다.'),
    p('자정부터 일출까지는 봉인. 해가 뜨면 잿빛 칸(수비 0, 진군 시간 절반)을 두고 쟁탈이 시작된다.'),
    h('h3', {}, '한 주'),
    p('매일 자정에 살아남은 등불 수로 순위를 매긴다. 일요일 밤은 긴 밤(압력 1.5배). 긴 밤을 넘긴 뒤 등불이 가장 많은 구가 우승하고 세계는 처음으로 돌아간다. 시즌 중에는 구를 바꿀 수 없다.'),
  ]);
}

async function openRanking() {
  openSheet('순위', [h('p', { class: 'hint' }, '불러오는 중')]);
  try {
    const r = await rpc('ranking');
    const counts = Object.fromEntries(r.gus.map(g => [g.id, g.tiles]));
    const ranked = rankGus([...S.idx.gu.values()], counts);
    const max = Math.max(1, ...ranked.map(g => g.tiles));
    const kids = [h('p', { class: 'hint' }, `시즌 ${r.season} · 살아남은 등불 수`)];
    ranked.forEach((g, i) => kids.push(h('div', { class: 'rankrow' + (g.id === myGu() ? ' me' : '') },
      h('span', { class: 'num' }, i + 1), h('span', {}, g.short),
      h('span', { class: 'rankbar' }, h('i', { style: `width:${g.tiles / max * 100}%;background:var(--gu-${g.id})` })),
      h('span', { class: 'num' }, g.tiles))));
    const days = r.gus.find(g => g.id === myGu())?.days || [];
    if (days.length) kids.push(h('p', { class: 'hint' }, '우리 구 자정 기록: ' + days.map(([d, n]) => `${d.slice(5)} ${n}칸`).join(', ')));
    if (r.me) kids.push(h('div', { class: 'box' }, h('b', {}, `내 기여도 ${r.me.contrib} · 우리 구 ${r.me.rank}위`),
      h('span', { class: 'hint' }, '증원한 병력 1명당 1점, 점령 1번에 20점'),
      h('ol', { class: 'list' }, (r.top || []).map(([n, c]) => h('li', {}, h('span', {}, n), h('span', { class: 'num' }, c))))));
    if (r.last) kids.push(h('p', { class: 'hint' }, `지난 시즌(${r.last.id}) 우승: ${guOf(r.last.winner)?.name || '-'}`));
    openSheet('순위', kids);
  } catch (e) { toast(e.message); }
}

async function openReport(auto) {
  try {
    const r = await rpc('sunrise_report');
    const gu = myGu();
    const kids = [h('p', { class: 'hint' }, `${r.night} 밤${r.long_night ? '(긴 밤)' : ''}의 결과`)];
    if (gu) {
      const line = reportLine(r, gu, S.idx);
      kids.push(h('div', { class: 'box' },
        h('b', {}, `${guOf(gu).name}: 지킨 등불 ${line.kept ?? '-'}칸 · 잃은 칸 ${line.lost.length}`),
        h('span', { class: 'hint' }, line.lost.length ? '어둠에 먹힌 칸: ' + line.lost.join(', ') : '어둠에 내준 칸이 없다.')));
      const card = h('button', { class: 'btn primary', type: 'button' }, '공유 카드 만들기');
      card.addEventListener('click', () => shareCard(r, line));
      kids.push(card);
    }
    kids.push(h('ul', { class: 'list' }, r.gus.map(g => h('li', {}, h('span', {}, guOf(g.id).short),
      h('span', {}, `지킴 ${g.kept ?? '-'} · 잃음 ${g.lost.length}`)))));
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
  toast('카드를 내려받았습니다.');
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
  ['해가 지면 도시는 어둑시니에게 먹힌다.', '어둠 속에서 쳐다볼수록 커진다는 요괴. 해가 지면 깨어나 불 꺼진 땅부터 삼킨다.'],
  ['서울의 불씨는 정해져 있다.', '우리 등불을 늘리는 길은 남의 등불을 꺼뜨리고 그 자리에 불을 켜는 것뿐. 낮에는 동네끼리 등불을 빼앗는다.'],
  ['불을 밝힌 땅만 내일을 맞는다.', '너는 우리 구를 지키는 등불지기. 많이 먹으면 밤에 지키기 힘들고, 적게 먹으면 순위에서 밀린다.'],
];
let pickedGu = null;
function showOnboard(step, i = 0) {
  const card = $('obCard'); $('onboard').hidden = false;
  const steps = (n) => h('div', { class: 'ob-steps', 'aria-hidden': 'true' }, [0, 1, 2, 3, 4].map(k => h('i', { class: k === n ? 'on' : '' })));
  const close = h('button', { class: 'linkbtn', type: 'button', onclick: hideOnboard }, '먼저 지도 둘러보기');
  if (step === 'story') {
    const cv = h('canvas', { width: 320, height: 180, 'aria-hidden': 'true' });
    card.replaceChildren(steps(i), cv, h('h1', {}, STORY[i][0]), h('p', {}, STORY[i][1]),
      h('button', { class: 'btn primary', type: 'button', onclick: () => (i < 2 ? showOnboard('story', i + 1) : showOnboard('gu')) }, i < 2 ? '다음' : '우리 구 고르기'),
      h('div', { class: 'row', style: 'justify-content:space-between' }, close,
        h('button', { class: 'linkbtn', type: 'button', onclick: () => showOnboard('login') }, '이미 등불지기예요')));
    drawStory(cv, i);
    return;
  }
  if (step === 'gu') {
    const counts = Object.fromEntries((S.game?.gus || []).map(g => [g.id, g]));
    const list = h('div', { class: 'gulist' });
    for (const side of ['n', 's']) {
      list.append(h('p', { class: 'side' }, side === 'n' ? '한강 북쪽' : '한강 남쪽'));
      for (const g of S.idx.gu.values()) {
        if (g.side !== side) continue;
        const t = TYPES[g.type];
        list.append(h('button', { class: 'gucard', type: 'button', 'aria-pressed': String(pickedGu === g.id), onclick: () => { pickedGu = g.id; showOnboard('gu'); } },
          h('b', {}, h('span', { class: 'dot', style: `background:var(--gu-${g.id})` }), g.name),
          h('span', {}, `${t.name} · ${g.symbol}`),
          h('span', { class: 'good' }, t.good), h('span', { class: 'bad' }, t.bad),
          h('span', { class: 'hint' }, `등불지기 ${counts[g.id]?.players ?? 0}명 · 등불 ${counts[g.id]?.tiles ?? '-'}칸`)));
      }
    }
    card.replaceChildren(steps(3), h('h1', {}, '어느 구의 등불을 지킬까'),
      h('p', { class: 'hint' }, '시범 전선: 한강을 사이에 둔 6개 구. 시즌(한 주) 동안은 바꿀 수 없다. 사람이 적은 구는 병력 생산이 늘어난다.'),
      list,
      h('button', { class: 'btn primary', type: 'button', disabled: !pickedGu, onclick: () => (S.session ? showOnboard('nick') : showOnboard('signup')) }, pickedGu ? `${guOf(pickedGu).name}로 정하기` : '구를 골라 주세요'),
      close);
    return;
  }
  if (step === 'signup' || step === 'login' || step === 'nick') {
    const signup = step === 'signup', nickOnly = step === 'nick';
    const msg = h('p', { class: 'hint', role: 'status' });
    const f = h('form', { class: 'sheet-body' },
      (signup || nickOnly) ? h('div', { class: 'field' }, h('label', { for: 'obNick' }, '닉네임 (1~12자, 순위에 보임)'), h('input', { id: 'obNick', type: 'text', maxlength: 12, required: true, value: me()?.nickname || '' })) : null,
      nickOnly ? null : h('div', { class: 'field' }, h('label', { for: 'obEmail' }, '이메일'), h('input', { id: 'obEmail', type: 'email', autocomplete: 'email', required: true })),
      nickOnly ? null : h('div', { class: 'field' }, h('label', { for: 'obPw' }, '비밀번호 (6자 이상)'), h('input', { id: 'obPw', type: 'password', minlength: 6, autocomplete: signup ? 'new-password' : 'current-password', required: true })),
      h('button', { class: 'btn primary', type: 'submit' }, signup ? '등불지기 등록' : nickOnly ? '시작하기' : '로그인'), msg);
    f.addEventListener('submit', async e => {
      e.preventDefault(); msg.textContent = '처리 중…';
      try {
        if (!nickOnly) {
          const email = $('obEmail').value.trim(), password = $('obPw').value;
          const { data, error } = signup ? await sb.auth.signUp({ email, password }) : await sb.auth.signInWithPassword({ email, password });
          if (error) throw new Error(friendly(error));
          if (signup && !data.session) throw new Error('가입은 됐지만 이메일 확인이 켜져 있어 바로 들어갈 수 없습니다. 운영자에게 알려 주세요.');
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
      signup ? h('p', { class: 'hint' }, `${guOf(pickedGu).name} · 한 사람이 한 계정으로 참여합니다.`) : null, f,
      h('div', { class: 'row', style: 'justify-content:space-between' },
        h('button', { class: 'linkbtn', type: 'button', onclick: () => showOnboard('gu') }, '구 다시 고르기'),
        nickOnly ? null : h('button', { class: 'linkbtn', type: 'button', onclick: () => showOnboard(signup ? 'login' : 'signup') }, signup ? '이미 있어요, 로그인' : '처음이에요, 등록')));
    return;
  }
  if (step === 'home') {
    const ios = /iPhone|iPad/.test(navigator.userAgent);
    card.replaceChildren(h('h1', {}, i ? '등불을 밝혔다' : '홈 화면에 추가'),
      i ? h('p', {}, `${guOf(myGu())?.name || ''}의 등불지기가 됐다. 병력 60명으로 시작한다. 해 지기 전에 우리 칸을 지키고, 남의 등불을 노려라.`) : null,
      h('p', {}, ios ? 'Safari 아래쪽 공유 버튼 › "홈 화면에 추가"를 누르면 앱처럼 열린다.' : '브라우저 메뉴(⋮) › "홈 화면에 추가" 또는 "앱 설치"를 누르면 앱처럼 열린다.'),
      h('p', { class: 'hint' }, '30초면 충분하다. 점심, 퇴근 전 일몰 러시, 자기 전 증원.'),
      h('button', { class: 'btn primary', type: 'button', onclick: hideOnboard }, '지도로'));
  }
}
function hideOnboard() { $('onboard').hidden = true; store.set('seenStory', '1'); }

// ---------- 시작 ----------
let raf = 0;
function loop() { S.map.render(now()); raf = requestAnimationFrame(loop); }
setInterval(() => { if (S.game) { tick(); document.querySelectorAll('[data-arrive]').forEach(el => { el.textContent = fmtLeft(Date.parse(el.dataset.arrive) - now()); }); } }, 500);

async function start() {
  const map = await (await fetch('data/map.json')).json();
  S.idx = indexMap(map);
  // 시작 전 지도: 칸 중심이 속한 구가 주인
  for (const c of S.idx.byId.values()) if (c.kind === 'land') { c.owner = c.gu; c.defense = BAL.tileStart; }
  S.map = new MapView($('map'), S.idx, {
    onTap: id => (id ? openTile(id) : S.sheet && closeSheet()),
    onDragMarch: (src, dst) => openMarch(dst, src),
  });
  document.documentElement.dataset.theme = phaseAt(Date.now()).phase === 'day' ? 'day' : 'night';
  loop();
  if (location.hostname === 'localhost') window.eodukDebug = { S, openTile, openMarch }; // 로컬 시험용
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
start().catch(e => toast('불러오지 못했습니다: ' + e.message, 8000));
