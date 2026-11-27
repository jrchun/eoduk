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

test('지도: 서울 25개 구 중 6개 구가 열림, 열린 칸 1~120(DB와 같음), 다리 4개가 강 양쪽에 닿음', () => {
  const idx = V.indexMap(map);
  assert.equal(map.gu.length, 25);
  assert.equal(map.gu.filter(g => g.open).length, 6);
  const tiles = [...idx.byId.values()], open = tiles.filter(t => !t.sealed), sealed = tiles.filter(t => t.sealed);
  assert.equal(open.length, 120);
  assert.deepEqual(open.map(t => t.id).sort((a, b) => a - b), Array.from({ length: 120 }, (_, i) => i + 1));
  assert.ok(sealed.length > 300 && sealed.every(t => t.id > 1000 && t.home), '봉인된 칸');
  const side = Object.fromEntries(map.gu.map(g => [g.id, g.side]));
  for (const c of open.filter(t => t.kind === 'land')) {
    for (const n of c.adj.map(id => idx.byId.get(id)).filter(n => !n.sealed)) {
      if (n.kind === 'land') assert.equal(side[n.gu], side[c.gu], `${c.name}-${n.name}`);
    }
  }
  const bridges = open.filter(t => t.kind === 'bridge');
  assert.deepEqual(bridges.map(b => b.name).sort(), ['동작대교', '마포대교', '양화대교', '한강대교']);
  for (const b of bridges) {
    const sides = new Set(b.adj.map(id => idx.byId.get(id)).filter(n => n.kind === 'land' && !n.sealed).map(n => side[n.gu]));
    assert.equal(sides.size, 2, b.name);
  }
  for (const g of map.gu.filter(g => g.open)) assert.ok(open.filter(t => t.gu === g.id).length >= 10, g.id);
  // 봉인된 칸은 칠 수 없다
  const s0 = sealed.find(t => t.kind === 'land');
  assert.equal(V.playable(s0), false);
});

function sampleIdx() {
  const idx = V.indexMap(map);
  V.applyTiles(idx, map.tiles.filter(t => t.kind !== 'river' && !t.sealed).map(t => [t.id, t.kind === 'bridge' ? null : t.gu, t.kind === 'bridge' ? 40 : 100, false]));
  return idx;
}
const byName = (idx, n) => [...idx.byId.values()].find(c => c.name === n).id;

test('화면 규칙: 칠 수 있는 칸, 출발 칸, 진군 미리보기', () => {
  const idx = sampleIdx();
  const bridge = byName(idx, '마포대교');
  assert.equal(V.canAttack(idx, bridge, 'mapo'), true);
  assert.equal(V.canAttack(idx, byName(idx, '용강'), 'mapo'), false); // 우리 칸
  assert.equal(V.canAttack(idx, byName(idx, '서울대'), 'mapo'), false); // 안 맞닿음
  assert.equal(V.canAttack(idx, byName(idx, '밤섬'), 'mapo'), false); // 강
  const src = V.bestSource(idx, bridge, 'mapo');
  assert.equal(idx.byId.get(src).owner, 'mapo');
  assert.equal(V.marchPreview(idx, src, bridge, 'mapo').minutes, 13);
  assert.equal(V.marchPreview(idx, V.bestSource(idx, bridge, 'yeongdeungpo'), bridge, 'yeongdeungpo').minutes, 10);
});

test('화면 규칙: 다가오는 공격, 진군 진행, 어둠과 맞닿은 칸, 순위', () => {
  const idx = sampleIdx();
  const t = byName(idx, '용강');
  const ms = [
    { id: 1, gu: 'yeongdeungpo', dst: t, created_at: '2026-11-27T05:00:00Z', arrive_at: '2026-11-27T05:20:00Z' },
    { id: 2, gu: 'mapo', dst: byName(idx, '마포대교'), created_at: '2026-11-27T05:00:00Z', arrive_at: '2026-11-27T05:10:00Z' },
    { id: 3, gu: 'jung', dst: t, created_at: '2026-11-27T05:00:00Z', arrive_at: '2026-11-27T05:12:00Z' },
  ];
  assert.deepEqual(V.incoming(idx, ms, 'mapo').map(m => m.id), [3, 1]);
  assert.equal(V.marchProgress(ms[0], Date.parse('2026-11-27T05:10:00Z')), 0.5);
  assert.ok(V.darkFront(idx, 'jung').length >= 5);
  const ranked = V.rankGus(map.gu, V.countTiles(idx));
  assert.equal(ranked[0].id, 'gwanak');
  assert.equal(ranked.length, 6); // 열린 구만 순위에
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
