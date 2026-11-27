// 어둑시니 게임 규칙(순수 함수, DOM 없음). 화면 미리보기와 tests/rules.test.js가 쓴다.
// 실제 판정은 DB 함수(supabase/schema.sql)가 한다. 숫자를 바꾸면 두 곳을 같이 고친다.

// ---------- 밸런스 초기값 (기획서 9절) ----------
export const BAL = {
  prodPerHour: 30,      // 병력 생산(1인, 시간당)
  troopCap: 90,         // 병력 상한
  startTroops: 60,      // 처음 들어온 사람의 병력
  tileStart: 100,       // 시즌 시작 칸 수비
  bridgeStart: 40,      // 다리 칸(중립) 시작 수비
  tileCap: 300,         // 칸 수비 상한
  marchBase: 10,        // 진군 시간(분) = 10 + 3 × 거리, 최대 40
  marchPerStep: 3,
  marchMax: 40,
  minHold: 10,          // 점령 후 최소 수비
  linkPer: 0.05,        // 붙어 있는 우리 칸당 방어 +5%
  linkMax: 0.30,
  rushMin: 30,          // 일몰 직전 러시(분)
  nightProd: 0.5,       // 밤·봉인 생산 배율
  ticks: 8,             // 밤 침식 횟수
  gazePer: 3, gazeMax: 30,
  longNight: 1.5,       // 7일째(일요일) 긴 밤 압력 배율
  erodeKeep: 0.25,      // 버틴 칸이 잃는 수비 = 압력 × 0.25 ÷ 저항
  // v3 개척형
  hallStart: 100,       // 구청 칸 시작 수비(시즌 시작 때 켜진 유일한 칸)
  settleBase: 20,       // 개척 필요 병력 = 20 + 5 × 구청까지 칸 거리 (+한강 다리 10, 샛강 다리 45, 잿빛 칸은 절반)
  settlePerDist: 5,
  bridgeSettle: 10,
  saetBridge: 45,       // 샛강 다리(여의교·서울교). 영등포구청 바로 옆이라 비싸게 둬야 여의도를 양쪽이 비슷하게 가져간다(sim.mjs)
  landmarkScore: 3,     // 시즌 점수 = 등불 칸 + 랜드마크 칸 × 3
  effectCap: 0.15,      // 같은 종류 랜드마크 효과 합계 상한
  sightBase: 2,         // 시야 = 연합 등불 칸 + 2칸(+ sight 효과)
  npcTarget: 8,         // 등불 정령 수 = max(0, 8 - 최근 24시간 활동한 사람), 연합당 최대 6
  npcMax: 6,
  npcShare: 0.4,        // 연합 하루 행동 중 정령 비율 상한
};

// ---------- v3: 연합·개척·랜드마크·점수 ----------
export const ALLIANCE = { n: '강북 3구 연합', s: '강남 3구 연합' };
export const allianceName = side => ALLIANCE[side] || '';
export function settleNeed(dist, { bridge = false, saet = false, gray = false } = {}) {
  const n = BAL.settleBase + BAL.settlePerDist * dist + (bridge ? (saet ? BAL.saetBridge : BAL.bridgeSettle) : 0);
  return Math.ceil(gray ? n / 2 : n);
}
// 'prod+5' → { kind: 'prod', val: 5 }
export function parseEffect(e) { const m = /^(\w+)\+(\d+)$/.exec(e || ''); return m ? { kind: m[1], val: +m[2] } : null; }
export const EFFECT_TEXT = { prod: n => `병력 생산 +${n}%`, speed: n => `진군·개척 시간 -${n}%`, nightres: n => `밤 어둠 저항 +${n}%`, sight: n => `시야 +${n}칸` };
export function effectText(e) { const p = parseEffect(e); return p ? EFFECT_TEXT[p.kind](p.val) : ''; }
// 연합이 가진 랜드마크 효과를 합친다(% 효과는 종류별 최대 15%)
export function allianceMods(effects) {
  const sum = { prod: 0, speed: 0, nightres: 0, sight: 0 };
  for (const e of effects) { const p = parseEffect(e); if (p) sum[p.kind] += p.val; }
  return { prod: Math.min(BAL.effectCap, sum.prod / 100), speed: Math.min(BAL.effectCap, sum.speed / 100), nightres: Math.min(BAL.effectCap, sum.nightres / 100), sight: sum.sight };
}
export const seasonScore = (lit, landmarks) => lit + BAL.landmarkScore * landmarks;
export const keptRatio = (litAtMidnight, consumed) => (litAtMidnight + consumed ? litAtMidnight / (litAtMidnight + consumed) : 1);
// 응시: 그 칸을 본 로그인한 사람(정령 제외) 고유 수
export function gazeCount(rows, tile) { return new Set(rows.filter(r => r.tile === tile && !r.npc).map(r => r.player)).size; }
export function npcWanted(activeHumans) { return Math.min(BAL.npcMax, Math.max(0, BAL.npcTarget - activeHumans)); }

// 유닛: 칸에 쌓인 병력은 모두 등롱지기, 진군 때 횃불꾼 비율을 고른다.
export const UNIT = { torch: { atk: 1.2, def: 0.8 }, lantern: { atk: 0.8, def: 1.2, night: 0.2 } };

// 구 유형 (기획서 8절). 시범 전선 6개 구만 쓴다.
export const TYPES = {
  river:   { name: '강변형', good: '한강 다리 칸 방어 +30%', bad: '산악 방향 진군 +20%' },
  mount:   { name: '산악형', good: '낮 방어 +15%', bad: '병력 생산 -10%' },
  city:    { name: '도심형', good: '진군 시간 -25%', bad: '밤 어둠 저항 -15%' },
  village: { name: '마을형', good: '병력 생산 +20%', bad: '진군 시간 +15%' },
  legend:  { name: '설화형', good: '밤 어둠 저항 +25%', bad: '낮 공격력 -10%' },
};

export function typeMods(type) {
  return {
    prod: type === 'village' ? 1.2 : type === 'mount' ? 0.9 : 1,
    march: type === 'city' ? 0.75 : type === 'village' ? 1.15 : 1,
    dayDef: type === 'mount' ? 1.15 : 1,
    bridgeDef: type === 'river' ? 1.3 : 1,
    dayAtk: type === 'legend' ? 0.9 : 1,
    nightRes: type === 'legend' ? 1.25 : type === 'city' ? 0.85 : 1,
  };
}

// ---------- 헥스(뾰족한 위가 있는 축 좌표 q,r) ----------
export const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];
export const key = (q, r) => q + ',' + r;
export function neighbors(q, r) { return DIRS.map(([dq, dr]) => [q + dq, r + dr]); }
export function hexDistance(a, b) {
  const dq = a.q - b.q, dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}
export function hexToPixel(q, r, size) { return { x: size * Math.sqrt(3) * (q + r / 2), y: size * 1.5 * r }; }
export function pixelToHex(x, y, size) {
  const q = (Math.sqrt(3) / 3 * x - y / 3) / size, r = (2 / 3 * y) / size;
  return hexRound(q, r);
}
export function hexRound(q, r) {
  const s = -q - r;
  let rq = Math.round(q), rr = Math.round(r); const rs = Math.round(s);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs; else if (dr > ds) rr = -rq - rs;
  return { q: rq + 0, r: rr + 0 }; // -0을 0으로
}

// ---------- 해 뜨고 지는 시각 (suncalc와 같은 계산식, 서울 좌표) ----------
export const SEOUL = { lat: 37.5665, lng: 126.978 };
const RAD = Math.PI / 180, DAY_MS = 86400000, J1970 = 2440588, J2000 = 2451545, J0 = 0.0009;
const KST = 9 * 3600000;

export function sunTimes(dateStr, lat = SEOUL.lat, lng = SEOUL.lng) {
  // dateStr: 'YYYY-MM-DD'(KST 날짜). 그날 정오(KST)를 기준으로 계산한다.
  const noon = Date.parse(dateStr + 'T12:00:00+09:00');
  const d = noon / DAY_MS - 0.5 + J1970 - J2000;
  const lw = RAD * -lng, phi = RAD * lat, e = RAD * 23.4397;
  const n = Math.round(d - J0 - lw / (2 * Math.PI));
  const ds = J0 + lw / (2 * Math.PI) + n;
  const M = RAD * (357.5291 + 0.98560028 * ds);
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + RAD * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const transit = (a) => J2000 + a + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const jNoon = transit(ds);
  const h0 = -0.833 * RAD;
  const w = Math.acos((Math.sin(h0) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)));
  const jSet = transit(J0 + (w + lw) / (2 * Math.PI) + n);
  const jRise = jNoon - (jSet - jNoon);
  const toMs = j => Math.round((j + 0.5 - J1970) * DAY_MS);
  return { sunrise: toMs(jRise), sunset: toMs(jSet) };
}

export function kstDate(ms) { return new Date(ms + KST).toISOString().slice(0, 10); }
export function addDays(dateStr, n) { return new Date(Date.parse(dateStr + 'T00:00:00Z') + n * DAY_MS).toISOString().slice(0, 10); }
export function kstMidnight(dateStr) { return Date.parse(dateStr + 'T00:00:00+09:00'); }
// 시즌은 월요일 0시(KST)에 시작하는 한 주. 시즌 ID = 그 월요일 날짜.
export function seasonOf(dateStr) {
  const dow = new Date(dateStr + 'T00:00:00Z').getUTCDay(); // 0=일
  return addDays(dateStr, -((dow + 6) % 7));
}
export function seasonDay(dateStr) { return (Date.parse(dateStr) - Date.parse(seasonOf(dateStr))) / DAY_MS + 1; } // 1~7

// 지금이 하루 흐름의 어디인지. phase: seal(자정~일출) | day | night(일몰~자정)
export function phaseAt(ms) {
  const date = kstDate(ms);
  const { sunrise, sunset } = sunTimes(date);
  const midnight = kstMidnight(addDays(date, 1));
  const tickLen = (midnight - sunset) / BAL.ticks;
  const longNight = seasonDay(date) === 7;
  const base = { date, sunrise, sunset, midnight, tickLen, longNight, season: seasonOf(date), day: seasonDay(date) };
  if (ms < sunrise) return { ...base, phase: 'seal', next: sunrise, tick: 0 };
  if (ms < sunset) return { ...base, phase: 'day', next: sunset, rush: sunset - ms <= BAL.rushMin * 60000, tick: 0 };
  const done = Math.min(BAL.ticks, Math.floor((ms - sunset) / tickLen));
  return { ...base, phase: 'night', next: midnight, tick: done, nextTick: sunset + (done + 1) * tickLen };
}

export function tickTimes(dateStr) {
  const { sunset } = sunTimes(dateStr);
  const midnight = kstMidnight(addDays(dateStr, 1));
  const len = (midnight - sunset) / BAL.ticks;
  return Array.from({ length: BAL.ticks }, (_, i) => sunset + (i + 1) * len);
}

// ---------- 병력 ----------
// 인원 보정: 1/√(구 활성 인원 ÷ 전체 평균), 0.7~1.3
export function popFactor(guPlayers, avgPlayers) {
  if (!guPlayers || !avgPlayers) return 1;
  return Math.min(1.3, Math.max(0.7, 1 / Math.sqrt(guPlayers / avgPlayers)));
}
export function prodRate(phase, type, factor = 1, prodMod = 0) {
  return BAL.prodPerHour * (phase === 'day' ? 1 : BAL.nightProd) * typeMods(type).prod * factor * (1 + prodMod);
}
// 저장된 병력(at 시각 기준)에서 now까지 쌓인 양. rate는 시간당.
export function troopsNow(stored, atMs, nowMs, rate) {
  const gain = Math.max(0, nowMs - atMs) / 3600000 * rate;
  return Math.min(BAL.troopCap, Math.max(stored, Math.floor(stored + gain)));
}

// ---------- 진군 ----------
export function marchMinutes(dist, { type = '', targetType = '', gray = false, speed = 0 } = {}) {
  let m = Math.min(BAL.marchMax, BAL.marchBase + BAL.marchPerStep * dist);
  const t = typeMods(type);
  m *= t.march * (1 - speed);
  if (type === 'river' && targetType === 'mount') m *= 1.2;
  if (gray) m *= 0.5;
  return Math.max(1, Math.round(m));
}
export function attackPower(n, torchRatio, type = '') {
  const r = Math.min(1, Math.max(0, torchRatio));
  return n * (UNIT.lantern.atk + (UNIT.torch.atk - UNIT.lantern.atk) * r) * typeMods(type).dayAtk;
}
export function linkBonus(ownNeighbors) { return Math.min(BAL.linkMax, BAL.linkPer * ownNeighbors); }
export function defensePower(def, { ownNeighbors = 0, type = '', bridge = false, neutral = false } = {}) {
  const t = typeMods(type);
  let p = def * UNIT.lantern.def;
  if (neutral) return p;
  p *= (1 + linkBonus(ownNeighbors)) * t.dayDef;
  if (bridge) p *= t.bridgeDef;
  return p;
}
// 판정: 공격력 × (0.9~1.1) > 방어력 이면 점령. luck은 0~1 난수.
export function battle({ troops, power, defense, defPower, luck }) {
  const atk = power * (0.9 + 0.2 * luck);
  if (atk > defPower) {
    return { win: true, hold: Math.max(BAL.minHold, Math.round(troops * (atk - defPower) / atk)), left: 0 };
  }
  return { win: false, hold: 0, left: Math.max(0, Math.round(defense * (1 - atk / defPower))) };
}

// ---------- 밤 침식 ----------
export function nightPressure(tick, watchers = 0, longNight = false) {
  const base = (30 + 10 * tick) * (longNight ? BAL.longNight : 1);
  return base + Math.min(BAL.gazeMax, BAL.gazePer * watchers);
}
export function nightResist(type, nightresMod = 0) { return (1 + UNIT.lantern.night) * typeMods(type).nightRes * (1 + nightresMod); }
// 어둠과 맞닿은 칸 하나에 압력을 준다. 버티면 수비가 깎이고, 못 버티면 잿빛 칸이 된다.
export function erode(def, pressure, type, nightresMod = 0) {
  const res = nightResist(type, nightresMod);
  if (pressure > def * res) return { lost: true, left: 0 };
  return { lost: false, left: Math.max(0, Math.round(def - pressure * BAL.erodeKeep / res)) };
}

// ---------- 보기용 ----------
export function fmtLeft(ms) {
  if (ms <= 0) return '0:00';
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`;
}
export function fmtClock(ms) { const d = new Date(ms + KST); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; }
