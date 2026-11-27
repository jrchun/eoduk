// 화면 규칙(순수 함수, DOM 없음). 지도 데이터(web/data/map.json)와 서버 상태(game_state)를 엮는다.
import { neighbors, key, hexDistance, marchMinutes, BAL } from './rules.js';

// map.json + 서버 tiles([id, owner, defense, gray]) → 칸 목록
export function indexMap(map) {
  const byId = new Map(), byKey = new Map(), gu = new Map();
  for (const g of map.gu) gu.set(g.id, g);
  for (const t of map.tiles) { const c = { ...t, owner: null, defense: 0, gray: false }; byId.set(t.id, c); byKey.set(key(t.q, t.r), c); }
  for (const c of byId.values()) c.adj = neighbors(c.q, c.r).map(([q, r]) => byKey.get(key(q, r))?.id).filter(Boolean);
  return { byId, byKey, gu, size: map.size, river: map.river, bridges: map.bridges || [], sprites: map.sprites || [], bamseom: map.bamseom || null };
}
export function applyTiles(idx, rows) {
  for (const [id, owner, defense, gray] of rows || []) {
    const c = idx.byId.get(id); if (!c) continue;
    c.owner = owner; c.defense = defense; c.gray = gray;
  }
  return idx;
}

export const playable = c => c && c.kind !== 'river';
export function ownNeighborCount(idx, id, gu) { return idx.byId.get(id).adj.filter(n => idx.byId.get(n).owner === gu).length; }
// 칠 수 있는 칸: 강이 아니고, 우리 칸이 아니고, 우리 칸과 맞닿아 있다
export function canAttack(idx, id, gu) {
  const c = idx.byId.get(id);
  return !!gu && playable(c) && c.owner !== gu && c.adj.some(n => idx.byId.get(n).owner === gu);
}
// 출발 칸: 목표에 가장 가까운 우리 칸(같으면 수비가 많은 칸)
export function bestSource(idx, dstId, gu) {
  const d = idx.byId.get(dstId); let best = null;
  for (const c of idx.byId.values()) {
    if (c.owner !== gu) continue;
    const dist = hexDistance(c, d);
    if (!best || dist < best.dist || (dist === best.dist && c.defense > best.c.defense)) best = { c, dist };
  }
  return best ? best.c.id : null;
}
export function marchPreview(idx, srcId, dstId, gu) {
  const s = idx.byId.get(srcId), d = idx.byId.get(dstId);
  const dist = hexDistance(s, d);
  const type = idx.gu.get(gu)?.type || '';
  const targetType = d.owner ? idx.gu.get(d.owner)?.type : '';
  return { dist, minutes: marchMinutes(dist, { type, targetType, gray: d.gray }) };
}
// 우리 칸으로 오는 적 진군(도착 순)
export function incoming(idx, marches, gu) {
  return (marches || []).filter(m => m.gu !== gu && idx.byId.get(m.dst)?.owner === gu)
    .sort((a, b) => Date.parse(a.arrive_at) - Date.parse(b.arrive_at));
}
export function marchProgress(m, now) {
  const a = Date.parse(m.created_at), b = Date.parse(m.arrive_at);
  return Math.min(1, Math.max(0, (now - a) / Math.max(1, b - a)));
}
// 밤에 어둠과 맞닿은 우리 칸(지도 가장자리, 지난밤부터 잿빛인 칸 옆)
export function darkFront(idx, gu) {
  return [...idx.byId.values()].filter(c => c.owner === gu && (c.edge || c.adj.some(n => idx.byId.get(n).gray)));
}
export function countTiles(idx) {
  const n = {}; for (const c of idx.byId.values()) if (c.owner) n[c.owner] = (n[c.owner] || 0) + 1;
  return n;
}
// 화면 위쪽 병력: 서버 값 + 받은 뒤 흐른 시간만큼(상한 90)
export function troopsLocal(serverTroops, rate, fetchedAt, now) {
  return Math.min(BAL.troopCap, Math.max(serverTroops, Math.floor(serverTroops + (now - fetchedAt) / 3600000 * rate)));
}
// 순위: 칸 수 많은 순(같으면 이름 순)
export function rankGus(gus, counts) {
  return [...gus].map(g => ({ ...g, tiles: counts[g.id] || 0 })).sort((a, b) => b.tiles - a.tiles || a.short.localeCompare(b.short, 'ko'));
}
// 일출 리포트 한 구 요약
export function reportLine(rep, gu, idx) {
  const g = rep?.gus?.find(x => x.id === gu);
  if (!g) return null;
  return { kept: g.kept ?? null, lost: (g.lost || []).map(id => idx.byId.get(id)?.name || '?') };
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
