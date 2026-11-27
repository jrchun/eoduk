// 게임 규칙(web/js/rules.js)과 화면 규칙(web/js/view.js) 테스트. 실행: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as R from '../web/js/rules.js';
import * as V from '../web/js/view.js';

const map = JSON.parse(readFileSync(new URL('../web/data/map.json', import.meta.url)));

test('일출·일몰: 서울 실제 시각과 1~2분 안으로 맞다', () => {
  const t = R.sunTimes('2026-11-27');
  assert.equal(R.fmtClock(t.sunrise), '07:25');
  assert.equal(R.fmtClock(t.sunset), '17:16');
  const s = R.sunTimes('2026-06-21');
  assert.equal(R.fmtClock(s.sunrise), '05:12');
  assert.equal(R.fmtClock(s.sunset), '19:57');
});

test('하루 흐름: 봉인 → 낮(러시) → 밤 침식 8번', () => {
  const at = iso => Date.parse(iso);
  assert.equal(R.phaseAt(at('2026-11-27T06:00:00+09:00')).phase, 'seal');
  const day = R.phaseAt(at('2026-11-27T12:00:00+09:00'));
  assert.equal(day.phase, 'day'); assert.equal(day.rush, false);
  assert.equal(R.phaseAt(at('2026-11-27T17:00:00+09:00')).rush, true);
  const night = R.phaseAt(at('2026-11-27T20:00:00+09:00'));
  assert.equal(night.phase, 'night');
  assert.ok(night.tick >= 3 && night.tick <= 4);
  const ticks = R.tickTimes('2026-11-27');
  assert.equal(ticks.length, 8);
  assert.equal(ticks[7], R.kstMidnight('2026-11-28'));
});

test('시즌: 월요일 시작, 일요일이 7일째(긴 밤)', () => {
  assert.equal(R.seasonOf('2026-11-27'), '2026-11-23');
  assert.equal(R.seasonOf('2026-11-23'), '2026-11-23');
  assert.equal(R.seasonOf('2026-11-29'), '2026-11-23');
  assert.equal(R.seasonDay('2026-11-29'), 7);
  assert.equal(R.phaseAt(Date.parse('2026-11-29T20:00:00+09:00')).longNight, true);
});

test('헥스: 거리·좌표 변환이 서로 맞는다', () => {
  assert.equal(R.hexDistance({ q: 0, r: 0 }, { q: 2, r: -1 }), 2);
  for (const [q, r] of [[0, 0], [3, -2], [-4, 5]]) {
    const p = R.hexToPixel(q, r, 10);
    assert.deepEqual(R.pixelToHex(p.x + 1, p.y - 1, 10), { q, r });
  }
});

test('병력: 생산·상한·인원 보정', () => {
  assert.equal(R.prodRate('day', 'river'), 30);
  assert.equal(R.prodRate('night', 'village'), 18);
  assert.equal(R.troopsNow(10, 0, 3600000, 30), 40);
  assert.equal(R.troopsNow(80, 0, 3600000, 30), 90);
  assert.equal(R.popFactor(4, 1), 0.7);
  assert.equal(R.popFactor(1, 4), 1.3);
  assert.equal(R.popFactor(2, 2), 1);
});

test('진군 시간: 10분 + 칸당 3분(최대 40), 구 유형·잿빛 칸 보정', () => {
  assert.equal(R.marchMinutes(1), 13);
  assert.equal(R.marchMinutes(20), 40);
  assert.equal(R.marchMinutes(1, { type: 'city' }), 10);
  assert.equal(R.marchMinutes(1, { type: 'village' }), 15);
  assert.equal(R.marchMinutes(2, { gray: true }), 8);
  assert.equal(R.marchMinutes(1, { type: 'river', targetType: 'mount' }), 16);
});

test('전투: 공격력 × 운 > 방어력이면 점령, 지면 수비가 깎인다', () => {
  const power = R.attackPower(60, 1); // 횃불꾼만 60명 = 72
  assert.equal(power, 72);
  const defPower = R.defensePower(40, { neutral: true }); // 중립 다리 40 × 1.2 = 48
  assert.equal(defPower, 48);
  const win = R.battle({ troops: 60, power, defense: 40, defPower, luck: 0.5 });
  assert.equal(win.win, true); assert.equal(win.hold, 20);
  const lose = R.battle({ troops: 30, power: R.attackPower(30, 0), defense: 100, defPower: R.defensePower(100, { ownNeighbors: 6 }), luck: 1 });
  assert.equal(lose.win, false); assert.ok(lose.left > 0 && lose.left < 100);
  // 연결 보너스는 최대 30%, 강변형 다리 +30%, 산악형 낮 +15%
  assert.equal(R.linkBonus(10), 0.3);
  assert.ok(Math.abs(R.defensePower(100, { type: 'river', bridge: true }) - 156) < 1e-9);
  assert.ok(Math.abs(R.defensePower(100, { type: 'mount' }) - 138) < 1e-9);
  // 점령 후 수비는 최소 10
  assert.equal(R.battle({ troops: 5, power: 100, defense: 0, defPower: 99, luck: 0.5 }).hold, 10);
});

test('밤 침식: 압력 30 + 10×틱 + 응시(최대 30), 긴 밤 1.5배', () => {
  assert.equal(R.nightPressure(1), 40);
  assert.equal(R.nightPressure(8, 4), 122);
  assert.equal(R.nightPressure(8, 50), 140);
  assert.equal(R.nightPressure(2, 0, true), 75);
  // 지키지 않은 도심형 가장자리 칸(100)은 네 번째 침식에 먹힌다
  let def = 100, lostAt = 0;
  for (let k = 1; k <= 8 && !lostAt; k++) { const e = R.erode(def, R.nightPressure(k), 'city'); if (e.lost) lostAt = k; else def = e.left; }
  assert.equal(lostAt, 4);
  // 수비 230을 쌓은 설화형 칸은 밤을 버틴다
  def = 230;
  for (let k = 1; k <= 8; k++) { const e = R.erode(def, R.nightPressure(k), 'legend'); assert.equal(e.lost, false); def = e.left; }
});

test('지도(v3): 서울 25개 구 중 6개 구 열림, 구청 6칸, 여의도는 사방이 강인 섬, 다리 8개, 랜드마크 효과 7곳', () => {
  const idx = V.indexMap(map);
  assert.equal(map.gu.length, 25);
  assert.equal(map.gu.filter(g => g.open).length, 6);
  const tiles = [...idx.byId.values()], open = tiles.filter(t => !t.sealed), sealed = tiles.filter(t => t.sealed);
  assert.equal(open.length, 120);
  assert.deepEqual(open.map(t => t.id).sort((a, b) => a - b), Array.from({ length: 120 }, (_, i) => i + 1));
  assert.ok(sealed.length > 300 && sealed.every(t => t.id > 1000 && t.home), '봉인된 칸');
  // 구청: 열린 구마다 하나, 그 구의 섬 밖 땅
  const halls = open.filter(t => t.hall);
  assert.deepEqual(halls.map(t => t.hall).sort(), map.gu.filter(g => g.open).map(g => g.id).sort());
  for (const h of halls) { assert.equal(h.gu, h.hall); assert.ok(!h.island); assert.equal(h.name, map.gu.find(g => g.id === h.hall).name + '청'); }
  // 여의도: 섬 칸의 이웃은 섬·강·다리뿐, 섬 칸은 주인 없는 중립
  const island = open.filter(t => t.island);
  assert.ok(island.length >= 3);
  for (const t of island) {
    assert.equal(t.gu, null);
    for (const n of t.adj.map(id => idx.byId.get(id))) assert.ok(n.island || n.kind !== 'land', `${t.name}-${n.name}`);
  }
  // 다리 8개: 각각 서로 다른 땅덩이(강북·강남·여의도) 둘 이상에 닿는다
  const side = Object.fromEntries(map.gu.map(g => [g.id, g.side]));
  const bridges = open.filter(t => t.kind === 'bridge');
  assert.equal(bridges.length, 8);
  for (const b of bridges) {
    const masses = new Set(b.adj.map(id => idx.byId.get(id)).filter(n => n.kind === 'land' && !n.sealed).map(n => (n.island ? 'i' : side[n.gu])));
    assert.ok(masses.size >= 2, b.name);
  }
  // 강북·강남 땅은 다리 없이 맞닿지 않는다
  for (const c of open.filter(t => t.kind === 'land' && !t.island))
    for (const n of c.adj.map(id => idx.byId.get(id)).filter(n => n.kind === 'land' && !n.sealed && !n.island)) assert.equal(side[n.gu], side[c.gu], `${c.name}-${n.name}`);
  // 랜드마크 효과 7곳, 여의도 3곳은 섬 위
  const fx = Object.fromEntries(open.filter(t => t.effect).map(t => [t.name, t.effect]));
  assert.deepEqual(fx, { '남산서울타워': 'sight+2', '서울역': 'prod+5', '보라매공원': 'sight+2', '영등포역': 'prod+5', '국회의사당': 'speed+10', '더현대·파크원': 'prod+5', '63빌딩': 'nightres+10' });
  for (const n of ['국회의사당', '더현대·파크원', '63빌딩']) assert.ok(open.find(t => t.name === n).island, n);
  assert.equal(V.playable(sealed.find(t => t.kind === 'land')), false);
});

// 시즌 시작(구청만 켜짐) 상태의 지도
function startIdx() {
  const idx = V.indexMap(map);
  V.applyTiles(idx, map.tiles.filter(t => t.kind !== 'river' && !t.sealed).map(t => [t.id, t.hall || null, t.hall ? 100 : 0, false, null]));
  return idx;
}
const byName = (idx, n) => [...idx.byId.values()].find(c => c.name === n).id;
const lightUp = (idx, name, gu, def = 50) => Object.assign(idx.byId.get(byName(idx, name)), { owner: gu, defense: def, gray: false });

test('개척(v3): 필요 병력 = 20 + 5 × 구청 거리, 다리 +10, 잿빛 절반 / 연합 땅에 붙은 어둠 칸만', () => {
  assert.equal(R.settleNeed(0), 20);
  assert.equal(R.settleNeed(3), 35);
  assert.equal(R.settleNeed(3, { bridge: true }), 45);
  assert.equal(R.settleNeed(3, { gray: true }), 18);
  assert.equal(R.settleNeed(3, { bridge: true, saet: true }), 80); // 샛강 다리 +45
  { const idx = startIdx(); assert.equal(V.settleNeedFor(idx, byName(idx, '여의교'), 'yeongdeungpo'), 20 + 5 * 1 + 45); }
  const idx = startIdx();
  const hall = idx.byId.get(byName(idx, '마포구청'));
  const next = hall.adj.map(id => idx.byId.get(id)).find(c => c.kind === 'land');
  assert.equal(V.canSettle(idx, next.id, 'n'), true);
  assert.equal(V.canSettle(idx, next.id, 's'), false); // 강남 연합 땅에 붙지 않음
  assert.equal(V.canSettle(idx, byName(idx, '서울대'), 'n'), false);
  assert.equal(V.canSettle(idx, hall.id, 'n'), false); // 이미 켜진 칸
  assert.equal(V.settleNeedFor(idx, next.id, 'mapo'), 25);
  // 같은 연합의 다른 구가 켠 칸 옆도 개척할 수 있다
  lightUp(idx, '공덕', 'yongsan');
  assert.equal(V.canSettle(idx, byName(idx, '염리'), 'n'), true);
});

test('쟁탈·증원(v3): 다른 연합 등불 칸 중 우리 연합 땅에 맞닿은 칸만 공격, 구청은 공격 불가, 증원은 연합 어느 칸이든', () => {
  const idx = startIdx();
  lightUp(idx, '양화대교', 'mapo'); lightUp(idx, '양평', 'yeongdeungpo');
  assert.equal(V.canAttack(idx, byName(idx, '양평'), 'n'), true);
  assert.equal(V.canAttack(idx, byName(idx, '양화대교'), 's'), true);
  assert.equal(V.canAttack(idx, byName(idx, '영등포구청'), 'n'), false); // 구청
  assert.equal(V.canAttack(idx, byName(idx, '관악구청'), 'n'), false);
  assert.equal(V.canReinforce(idx, byName(idx, '용산구청'), 'n'), true); // 같은 연합 다른 구
  assert.equal(V.canReinforce(idx, byName(idx, '양평'), 'n'), false);
  // 연결 보너스는 같은 연합 칸 기준
  lightUp(idx, '합정', 'mapo');
  assert.ok(V.ownNeighborCount(idx, byName(idx, '양화대교'), 'mapo') >= 1);
  const src = V.bestSource(idx, byName(idx, '양평'), 'n');
  assert.equal(idx.byId.get(src).name, '양화대교');
});

test('밤 침식 대상(v3): 어둠과 맞닿은 연합 등불 칸(개척지 가장자리), 구청은 빠진다', () => {
  const idx = startIdx();
  assert.equal(V.darkFront(idx, 'n').length, 0); // 구청만 있으면 먹힐 칸이 없다
  lightUp(idx, '망원', 'mapo');
  assert.deepEqual(V.darkFront(idx, 'n').map(c => c.name), ['망원']);
  assert.equal(V.darkFront(idx, 's').length, 0);
});

test('응시·효과·점수·정령(v3)', () => {
  const rows = [{ tile: 1, player: 'a' }, { tile: 1, player: 'a' }, { tile: 1, player: 'b' }, { tile: 1, player: 'c', npc: true }, { tile: 2, player: 'd' }];
  assert.equal(R.gazeCount(rows, 1), 2); // 같은 사람 두 번은 한 명, 정령 제외
  const m = R.allianceMods(['prod+5', 'prod+5', 'prod+5', 'prod+5', 'speed+10', 'sight+2', 'sight+2']);
  assert.equal(m.prod, 0.15); assert.equal(m.speed, 0.1); assert.equal(m.sight, 4); assert.equal(m.nightres, 0);
  assert.equal(R.effectText('nightres+10'), '밤 어둠 저항 +10%');
  assert.equal(R.seasonScore(10, 2), 16);
  assert.equal(R.keptRatio(8, 2), 0.8);
  assert.equal(R.npcWanted(0), 6); assert.equal(R.npcWanted(5), 3); assert.equal(R.npcWanted(12), 0);
  assert.equal(R.marchMinutes(1, { speed: 0.1 }), 12);
  const idx = startIdx();
  lightUp(idx, '국회의사당', 'yeongdeungpo'); lightUp(idx, '망원', 'mapo');
  const sc = V.scores(idx);
  assert.equal(sc.side.s.score, 3 + 1 + 3); // 구청 3 + 국회의사당 1칸 + 랜드마크 3
  assert.equal(sc.side.n.score, 4);
  assert.deepEqual(V.sideEffects(idx, 's'), ['speed+10']);
  const vis = V.visibleSet(idx, 'n', 0);
  assert.ok(vis.has(byName(idx, '마포구청')) && !vis.has(byName(idx, '관악구청')));
});

test('화면 규칙: 다가오는 공격(연합), 진군 진행, 순위(점수)', () => {
  const idx = startIdx();
  lightUp(idx, '양화대교', 'mapo'); lightUp(idx, '양평', 'yeongdeungpo');
  const ms = [
    { id: 1, gu: 'yeongdeungpo', kind: 'attack', dst: byName(idx, '양화대교'), created_at: '2026-11-27T05:00:00Z', arrive_at: '2026-11-27T05:20:00Z' },
    { id: 2, gu: 'jung', kind: 'attack', dst: byName(idx, '양화대교'), created_at: '2026-11-27T05:00:00Z', arrive_at: '2026-11-27T05:12:00Z' },
    { id: 3, gu: 'dongjak', kind: 'settle', dst: byName(idx, '양화대교'), created_at: '2026-11-27T05:00:00Z', arrive_at: '2026-11-27T05:10:00Z' },
  ];
  assert.deepEqual(V.incoming(idx, ms, 'n').map(m => m.id), [1]); // 같은 연합 진군·개척은 빼고
  assert.equal(V.marchProgress(ms[0], Date.parse('2026-11-27T05:10:00Z')), 0.5);
  const ranked = V.rankGus(map.gu, V.countTiles(idx), V.scores(idx));
  assert.equal(ranked.length, 6);
  assert.ok(['mapo', 'yeongdeungpo'].includes(ranked[0].id));
  assert.equal(V.troopsLocal(10, 30, 0, 3600000), 40);
});

test('문구: 받침에 맞는 조사와 공유 문구', () => {
  assert.equal(V.josa('용산', '은', '는'), '용산은');
  assert.equal(V.josa('마포', '은', '는'), '마포는');
  assert.match(V.shareText('관악', 20, 3), /관악은 등불 20개를 지켰고 3개를/);
});

import { suggestNickname, nicknameCandidates, MAX_NICK } from '../web/js/names.js';
test('추천 닉네임: 인디언식, 12자 이하, 후보는 서로 다르다', () => {
  let seed = 1; const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < 500; i++) {
    const n = suggestNickname(rand);
    assert.ok(n.length >= 2 && n.length <= MAX_NICK, n);
    assert.ok(/^[가-힣 ]+$/.test(n), n);
  }
  const c = nicknameCandidates(10, rand);
  assert.equal(new Set(c).size, c.length);
  assert.ok(c.length >= 8);
  // 패턴 셋이 모두 나온다: "~의 ~", "~고 ~"류, "~와/과 ~"
  const many = Array.from({ length: 300 }, () => suggestNickname(rand)).join('|');
  assert.match(many, /의 /); assert.match(many, /(와|과) /);
});

import { sunArc } from '../web/js/sunbar.js';
test('시간 막대: 낮은 일출→일몰, 밤은 일몰→다음 일출(자정·침식 8번 표시)', () => {
  const day = R.phaseAt(Date.parse('2026-11-27T12:20:00+09:00'));
  const iso = p => ({ ...p, sunrise: new Date(p.sunrise).toISOString(), sunset: new Date(p.sunset).toISOString(), midnight: new Date(p.midnight).toISOString() });
  const a = sunArc(iso(day), Date.parse('2026-11-27T12:20:00+09:00'));
  assert.equal(a.kind, 'day'); assert.ok(a.t > 0.45 && a.t < 0.55);
  const t2 = Date.parse('2026-11-27T20:00:00+09:00'), n = sunArc(iso(R.phaseAt(t2)), t2);
  assert.equal(n.kind, 'night'); assert.equal(n.marks.length, 8);
  assert.ok(n.t > 0 && n.t < n.midnight && n.midnight < 1);
  assert.ok(Math.abs(n.marks[7] - n.midnight) < 1e-9);
  const t3 = Date.parse('2026-11-28T03:00:00+09:00'), sl = sunArc(iso(R.phaseAt(t3)), t3);
  assert.equal(sl.kind, 'night'); assert.ok(sl.t > sl.midnight && sl.t < 1);
});
