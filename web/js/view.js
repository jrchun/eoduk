// 화면 규칙(순수 함수, DOM 없음). 지도 데이터(web/data/map.json)와 서버 상태(game_state)를 엮는다.
// v3: 칸 상태는 어둠(미개척, 주인 없음·잿빛 아님) → 등불(주인 있음) → 잿빛(밤에 먹힘). 승패는 연합(side n/s) 단위.
import { neighbors, key, hexDistance, marchMinutes, settleNeed, allianceMods, seasonScore, BAL } from './rules.js';

// map.json + 서버 tiles([id, owner, defense, gray, progress]) → 칸 목록
export function indexMap(map) {
  const byId = new Map(), byKey = new Map(), gu = new Map();
  for (const g of map.gu) gu.set(g.id, g);
  for (const t of map.tiles) { const c = { ...t, owner: null, defense: 0, gray: false, progress: {} }; byId.set(t.id, c); byKey.set(key(t.q, t.r), c); }
  for (const c of byId.values()) c.adj = neighbors(c.q, c.r).map(([q, r]) => byKey.get(key(q, r))?.id).filter(Boolean);
  const peaks = map.peaks || [];
  for (const c of byId.values()) c.elev = c.kind === 'river' ? 0 : elevation(peaks, c.x, c.y);
  return { byId, byKey, gu, size: map.size, river: map.river, saetgang: map.saetgang || [], bridges: map.bridges || [], sprites: map.sprites || [], bamseom: map.bamseom || null, peaks };
}
// 지형 높이(km, 화면 전용): 가장 가까운 산의 종 모양 높이. step 단위로 끊어 계단식 디오라마가 되게 한다
export function elevation(peaks, x, y, step = 0.06) {
  let h = 0;
  for (const p of peaks || []) { const d = Math.hypot(x - p.at[0], y - p.at[1]) / p.r; h = Math.max(h, p.h * Math.exp(-d * d)); }
  return h < step / 2 ? 0 : Math.round(h / step) * step;
}
export function applyTiles(idx, rows) {
  for (const [id, owner, defense, gray, progress] of rows || []) {
    const c = idx.byId.get(id); if (!c) continue;
    c.owner = owner; c.defense = defense; c.gray = gray; c.progress = progress || {};
  }
  return idx;
}

export const playable = c => !!c && c.kind !== 'river' && !c.sealed; // 봉인된 구 칸은 게임에 쓰지 않는다
export const isLit = c => !!c && !!c.owner;
export const isDark = c => playable(c) && !c.owner; // 어둠(미개척) 또는 잿빛
export function tileState(c) { return !playable(c) ? (c?.sealed ? 'sealed' : 'river') : c.owner ? 'lit' : c.gray ? 'gray' : 'dark'; }
export const sideOf = (idx, gu) => idx.gu.get(gu)?.side || null;
const litBy = (idx, id, side) => { const c = idx.byId.get(id); return isLit(c) && sideOf(idx, c.owner) === side; };
export function hallOf(idx, gu) { for (const c of idx.byId.values()) if (c.hall === gu) return c; return null; }

// 붙어 있는 같은 연합 등불 칸 수(연결 보너스)
export function ownNeighborCount(idx, id, gu) { const side = sideOf(idx, gu); return idx.byId.get(id).adj.filter(n => litBy(idx, n, side)).length; }
// 개척: 어둠·잿빛 칸이면서 우리 연합 등불 칸과 붙어 있다
export function canSettle(idx, id, side) {
  const c = idx.byId.get(id);
  return !!side && isDark(c) && c.adj.some(n => litBy(idx, n, side));
}
// 공격(진군): 다른 연합의 등불 칸이면서 우리 연합 등불 칸과 붙어 있다. 구청 칸은 칠 수 없다
export function canAttack(idx, id, side) {
  const c = idx.byId.get(id);
  return !!side && isLit(c) && !c.hall && sideOf(idx, c.owner) !== side && c.adj.some(n => litBy(idx, n, side));
}
// 증원: 같은 연합의 어느 구 칸이든
export function canReinforce(idx, id, side) { return !!side && litBy(idx, id, side); }
// 개척 필요 병력(내 구 구청에서의 거리)
export function settleNeedFor(idx, dstId, gu) {
  const d = idx.byId.get(dstId), h = hallOf(idx, gu);
  return settleNeed(h ? hexDistance(d, h) : 0, { bridge: d.kind === 'bridge', saet: !!d.saetBridge, gray: d.gray });
}
// 출발 칸: 목표에 가장 가까운 우리 연합 등불 칸(같으면 수비가 많은 칸)
export function bestSource(idx, dstId, side) {
  const d = idx.byId.get(dstId); let best = null;
  for (const c of idx.byId.values()) {
    if (!isLit(c) || sideOf(idx, c.owner) !== side) continue;
    const dist = hexDistance(c, d);
    if (!best || dist < best.dist || (dist === best.dist && c.defense > best.c.defense)) best = { c, dist };
  }
  return best ? best.c.id : null;
}
export function marchPreview(idx, srcId, dstId, gu, mods = {}) {
  const s = idx.byId.get(srcId), d = idx.byId.get(dstId);
  const dist = hexDistance(s, d);
  const type = idx.gu.get(gu)?.type || '';
  const targetType = d.owner ? idx.gu.get(d.owner)?.type : '';
  return { dist, minutes: marchMinutes(dist, { type, targetType, gray: d.gray, speed: mods.speed || 0 }) };
}
// 우리 연합 칸으로 오는 다른 연합의 공격(도착 순)
export function incoming(idx, marches, side) {
  return (marches || []).filter(m => m.kind !== 'settle' && sideOf(idx, m.gu) !== side && litBy(idx, m.dst, side))
    .sort((a, b) => Date.parse(a.arrive_at) - Date.parse(b.arrive_at));
}
export function marchProgress(m, now) {
  const a = Date.parse(m.created_at), b = Date.parse(m.arrive_at);
  return Math.min(1, Math.max(0, (now - a) / Math.max(1, b - a)));
}
// 밤에 어둠(미개척·잿빛·지도 밖)과 맞닿은 우리 연합 칸 = 개척지 가장자리. 구청은 먹히지 않는다
export function darkFront(idx, side) {
  return [...idx.byId.values()].filter(c => litBy(idx, c.id, side) && !c.hall
    && (c.edge || c.adj.some(n => { const o = idx.byId.get(n); return o.sealed || isDark(o); })));
}
export function countTiles(idx) {
  const n = {}; for (const c of idx.byId.values()) if (c.owner) n[c.owner] = (n[c.owner] || 0) + 1;
  return n;
}
// 연합이 가진 랜드마크 효과
export function sideEffects(idx, side) { return [...idx.byId.values()].filter(c => c.effect && litBy(idx, c.id, side)).map(c => c.effect); }
export function sideMods(idx, side) { return allianceMods(sideEffects(idx, side)); }
// 시야: 우리 연합 등불 칸에서 (2 + sight) 칸 안
export function visibleSet(idx, side, sight = 0) {
  const lit = [...idx.byId.values()].filter(c => litBy(idx, c.id, side)), r = BAL.sightBase + sight, out = new Set();
  for (const c of idx.byId.values()) if (lit.some(l => hexDistance(l, c) <= r)) out.add(c.id);
  return out;
}
// 점수: 등불 칸 + 랜드마크 칸 × 3 (연합·구)
export function scores(idx) {
  const gu = {}, side = { n: { lit: 0, lm: 0 }, s: { lit: 0, lm: 0 } };
  for (const c of idx.byId.values()) {
    if (!isLit(c)) continue;
    const g = (gu[c.owner] ||= { lit: 0, lm: 0 }), sd = side[sideOf(idx, c.owner)];
    g.lit++; sd.lit++; if (c.effect) { g.lm++; sd.lm++; }
  }
  for (const v of [...Object.values(gu), ...Object.values(side)]) v.score = seasonScore(v.lit, v.lm);
  return { gu, side };
}
// 화면 위쪽 병력: 서버 값 + 받은 뒤 흐른 시간만큼(상한 90)
export function troopsLocal(serverTroops, rate, fetchedAt, now) {
  return Math.min(BAL.troopCap, Math.max(serverTroops, Math.floor(serverTroops + (now - fetchedAt) / 3600000 * rate)));
}
// 순위: 점수(등불 + 랜드마크×3) 높은 순, 열린 구만
export function rankGus(gus, counts, sc) {
  return [...gus].filter(g => g.open !== false)
    .map(g => ({ ...g, tiles: counts[g.id] || 0, score: sc?.gu?.[g.id]?.score ?? (counts[g.id] || 0) }))
    .sort((a, b) => b.score - a.score || b.tiles - a.tiles || a.short.localeCompare(b.short, 'ko'));
}
// 일출 리포트 한 구 요약
export function reportLine(rep, gu, idx) {
  const g = rep?.gus?.find(x => x.id === gu);
  if (!g) return null;
  return { kept: g.kept ?? null, lost: (g.lost || []).map(id => idx.byId.get(id)?.name || '?'), settled: g.settled ?? null, ratio: g.kept_ratio ?? null };
}
// 오늘의 성적 1위(밝힌 칸, 지킨 비율)
export function dayBest(rep) {
  const gs = (rep?.gus || []).filter(g => g.settled != null);
  if (!gs.length) return null;
  const by = k => [...gs].sort((a, b) => (b[k] ?? 0) - (a[k] ?? 0))[0]?.id;
  return { settled: by('settled'), kept: by('kept_ratio') };
}
// 받침에 맞는 조사: josa('용산', '은', '는') → '용산은'
export function josa(word, withFinal, without) {
  const code = String(word).charCodeAt(String(word).length - 1) - 0xac00;
  const has = code >= 0 && code <= 11171 && code % 28 !== 0;
  return word + (has ? withFinal : without);
}
// 공유 문구
export function shareText(guName, kept, lostCount) {
  return `어둑시니 — 어젯밤 ${josa(guName, '은', '는')} 등불 ${kept ?? '?'}개를 지켰고 ${lostCount}개를 어둠에 내줬어요. 해 지기 전에 등불을 지켜라.`;
}
