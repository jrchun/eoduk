// 밸런스 시뮬레이터(오프라인, DB 없음). web/js/rules.js·view.js와 web/data/map.json만 쓴다.
//   node scripts/sim.mjs                 → 기본 묶음(5/5, 10/10, 10/5 × 시드 20개), 표 + sim-report.json
//   node scripts/sim.mjs --n 5 --s 5 --seeds 5 --sessions 4-6
// 하루 단위로 7일(월~일)을 돌린다. 일출·일몰은 07:30/17:30 고정, 밤은 17:30~24:00을 8틱으로.
// 가상 플레이어는 등불 정령과 같은 우선순위로 움직인다(공격 오면 증원 → 가끔 약한 적 칸 공격 → 랜드마크·싼 칸 개척, 밤엔 가장자리 증원).
import { readFileSync, writeFileSync } from 'node:fs';
import { BAL, settleNeed, hexDistance, marchMinutes, attackPower, defensePower, nightPressure, nightResist, popFactor, typeMods, allianceMods, seasonScore } from '../web/js/rules.js';
import { indexMap, isLit } from '../web/js/view.js';

const ROOT = new URL('..', import.meta.url).pathname;
const MAP = JSON.parse(readFileSync(ROOT + 'web/data/map.json', 'utf8'));
const DAY = ['월', '화', '수', '목', '금', '토', '일'];
const SUNRISE = 7.5 * 60, SUNSET = 17.5 * 60, MID = 24 * 60;

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;

// knobs(실험용): keep = 개척 후 수비로 남는 필요 병력 비율, exposure = 밤 압력을 어둠과 맞닿은 면 수에 비례, islandDist = 여의도 칸 개척 거리 고정값,
//                saetBridge = 샛강 다리 추가 비용, npc = 등불 정령 포함
export function simulate({ n = 5, s = 5, seed = 1, sessions = [4, 6], knobs = {} } = {}) {
  const K = { keep: BAL.settleKeep ?? 0, exposure: !!BAL.exposure, islandDist: BAL.islandDist ?? null, saetBridge: BAL.saetBridge, npc: true, ...knobs };
  const R = rng(seed), idx = indexMap(MAP);
  const open = [...idx.byId.values()].filter(c => !c.sealed && c.kind !== 'river');
  const gus = [...idx.gu.values()].filter(g => g.open);
  const sideOf = gu => idx.gu.get(gu).side;
  const hall = Object.fromEntries(open.filter(c => c.hall).map(c => [c.hall, c]));
  for (const c of open) { c.owner = c.hall || null; c.defense = c.hall ? BAL.hallStart : 0; c.gray = false; c.progress = {}; c.grayAt = -1; }
  // 사람: 연합마다 구 3개에 고르게
  const players = [];
  for (const [sd, cnt] of [['n', n], ['s', s]]) {
    const gs = gus.filter(g => g.side === sd);
    for (let i = 0; i < cnt; i++) players.push({ side: sd, gu: gs[i % gs.length].id, troops: 60 });
    // 등불 정령: 연합마다 max(0, 8 - 사람), 최대 6. 사람이 적은 구부터
    const want = K.npc ? Math.min(BAL.npcMax, Math.max(0, BAL.npcTarget - cnt)) : 0;
    for (let i = 0; i < want; i++) players.push({ side: sd, gu: gs[(cnt + i) % gs.length].id, troops: 60, npc: true });
  }
  const per = {}; for (const p of players) if (!p.npc) per[p.gu] = (per[p.gu] || 0) + 1;
  const avg = players.filter(p => !p.npc).length / gus.length;
  const need = (c, gu) => settleNeed(c.island && K.islandDist != null ? K.islandDist : hexDistance(c, hall[gu]), { bridge: c.kind === 'bridge', saet: !!c.saetBridge, gray: c.gray })
    + (c.kind === 'bridge' && c.saetBridge ? K.saetBridge - BAL.saetBridge : 0);
  const sideLit = sd => open.filter(c => isLit(c) && sideOf(c.owner) === sd);
  const mods = sd => allianceMods(sideLit(sd).filter(c => c.effect).map(c => c.effect));
  const nbLit = (c, sd) => c.adj.map(id => idx.byId.get(id)).filter(o => isLit(o) && !o.sealed && sideOf(o.owner) === sd);
  const report = { config: { n, s, seed }, contact: null, landmarks: {}, final: {}, daily: [], grayPerNight: [], score: null };
  let marches = [];

  const checkContact = (day, t) => {
    if (report.contact) return;
    for (const c of open) if (isLit(c) && nbLit(c, sideOf(c.owner) === 'n' ? 's' : 'n').length) { report.contact = { day: day + 1, dow: DAY[day], at: hm(t), tile: c.name }; return; }
  };
  const resolve = (m, day) => {
    const t = m.dst, sd = sideOf(m.gu);
    if (isLit(t) && sideOf(t.owner) === sd) { t.defense = Math.min(BAL.tileCap, t.defense + m.troops); return; }
    if (isLit(t)) {
      if (t.hall) return;
      const dp = defensePower(t.defense, { ownNeighbors: nbLit(t, sideOf(t.owner)).length, type: idx.gu.get(t.owner).type, bridge: t.kind === 'bridge' });
      const atk = m.power * (0.9 + 0.2 * R());
      if (atk > dp) { t.owner = m.gu; t.defense = Math.min(BAL.tileCap, Math.max(BAL.minHold, Math.round(m.troops * (atk - dp) / atk))); t.progress = {}; }
      else t.defense = Math.max(0, Math.round(t.defense * (1 - Math.min(1, atk / dp))));
      return;
    }
    t.progress[m.gu] = (t.progress[m.gu] || 0) + m.troops;
    const mine = Object.entries(t.progress).filter(([g]) => sideOf(g) === sd);
    const total = mine.reduce((a, [, v]) => a + v, 0);
    const top = mine.sort((a, b) => b[1] - a[1])[0][0];
    const nd = need(t, top);
    if (total >= nd && !(t.effect && m.npc)) {
      t.owner = top; t.defense = Math.max(BAL.minHold, Math.round(total - nd * (1 - K.keep))); t.gray = false; t.progress = {};
      if (t.effect && !report.landmarks[t.name]) report.landmarks[t.name] = { side: sd, day: day + 1 };
    }
  };
  const send = (p, dst, troops, kind, t, day, torch) => {
    const src = sideLit(p.side).sort((a, b) => hexDistance(a, dst) - hexDistance(b, dst))[0];
    const mins = marchMinutes(hexDistance(src, dst), { type: idx.gu.get(p.gu).type, gray: dst.gray, speed: mods(p.side).speed });
    if (t + mins > SUNSET || troops < 1) return false;
    p.troops -= troops;
    marches.push({ gu: p.gu, dst, troops, kind, at: t + mins, npc: !!p.npc, power: attackPower(troops, torch, idx.gu.get(p.gu).type) });
    return true;
  };
  const act = (p, t, day) => {
    const have = Math.floor(p.troops), other = p.side === 'n' ? 's' : 'n';
    if (have < 5) return;
    if (t < SUNSET) {
      const threat = marches.find(m => sideOf(m.gu) !== p.side && m.kind === 'attack' && isLit(m.dst) && sideOf(m.dst.owner) === p.side && m.at - t <= 30 && m.at > t);
      if (threat && R() < 0.5) { const add = Math.min(have, BAL.tileCap - threat.dst.defense, Math.max(5, Math.ceil(threat.power * 1.1 / 1.2 - threat.dst.defense) + 5)); if (add > 0) { threat.dst.defense += add; p.troops -= add; return; } }
      if (R() < 0.2) {
        const tg = open.filter(c => isLit(c) && !c.hall && sideOf(c.owner) === other && nbLit(c, p.side).length)
          .map(c => ({ c, dp: defensePower(c.defense, { ownNeighbors: nbLit(c, other).length, type: idx.gu.get(c.owner).type, bridge: c.kind === 'bridge' }) }))
          .filter(x => have * 1.2 * 0.9 > x.dp).sort((a, b) => a.dp - b.dp)[0];
        if (tg && send(p, tg.c, have, 'attack', t, day, 1)) return;
      }
      const cand = open.filter(c => !isLit(c) && nbLit(c, p.side).length)
        .map(c => ({ c, need: need(c, p.gu) }))
        .sort((a, b) => (b.c.effect ? 1 : 0) - (a.c.effect ? 1 : 0) || a.need - b.need);
      const tg = cand[0]; if (!tg) return;
      const prog = Object.entries(tg.c.progress).filter(([g]) => sideOf(g) === p.side).reduce((a, [, v]) => a + v, 0);
      const pending = marches.filter(m => m.dst === tg.c && sideOf(m.gu) === p.side).reduce((a, m) => a + m.troops, 0);
      const remain = Math.max(5, tg.need - prog - pending);
      if (have >= Math.min(remain, 20)) send(p, tg.c, Math.min(have, remain), 'settle', t, day, 0.5);
    } else {
      const edge = sideLit(p.side).filter(c => !c.hall && (c.edge || c.adj.some(id => { const o = idx.byId.get(id); return !o.sealed && o.kind !== 'river' && !isLit(o); }))).sort((a, b) => a.defense - b.defense)[0];
      if (edge) { const add = Math.min(Math.floor(have / 2), BAL.tileCap - edge.defense); if (add > 0) { edge.defense += add; p.troops -= add; } }
    }
  };

  for (let day = 0; day < 7; day++) {
    // 오늘 접속 시각(08~20시, 한 사람당 4~6번)
    const events = [];
    for (const p of players) { const k = sessions[0] + Math.floor(R() * (sessions[1] - sessions[0] + 1)); for (let i = 0; i < k; i++) events.push({ t: 8 * 60 + Math.floor(R() * 12 * 60), p }); }
    events.sort((a, b) => a.t - b.t);
    let last = SUNRISE;
    const grow = (from, to) => {
      for (const p of players) {
        const fac = popFactor(per[p.gu], avg), md = mods(p.side).prod, ty = idx.gu.get(p.gu).type;
        const dayPart = Math.max(0, Math.min(to, SUNSET) - Math.max(from, SUNRISE)), nightPart = (to - from) - dayPart;
        p.troops = Math.min(BAL.troopCap, p.troops + (dayPart / 60) * BAL.prodPerHour * typeMods(ty).prod * fac * (1 + md) + (nightPart / 60) * BAL.prodPerHour * BAL.nightProd * typeMods(ty).prod * fac * (1 + md));
      }
    };
    for (const e of events) {
      grow(last, e.t); last = e.t;
      marches.filter(m => m.at <= e.t).sort((a, b) => a.at - b.at).forEach(m => resolve(m, day));
      marches = marches.filter(m => m.at > e.t);
      checkContact(day, e.t);
      act(e.p, e.t, day);
    }
    marches.sort((a, b) => a.at - b.at).forEach(m => resolve(m, day)); marches = [];
    checkContact(day, SUNSET);
    grow(last, MID);
    // 밤 침식 8틱
    let grays = 0;
    for (let k = 1; k <= 8; k++) {
      const tgt = open.filter(c => isLit(c) && !c.hall && (c.edge || c.adj.some(id => { const o = idx.byId.get(id); return !o.sealed && o.kind !== 'river' && !isLit(o) && (!o.gray || o.grayAt < day); })));
      const darkSides = c => c.adj.map(id => idx.byId.get(id)).filter(o => o.sealed || (o.kind !== 'river' && !isLit(o))).length + (6 - c.adj.length);
      const hits = tgt.map(c => ({ c, p: nightPressure(k, 0, day === 6) * (K.exposure ? Math.min(1, Math.max(1, darkSides(c)) / 3) : 1), res: nightResist(idx.gu.get(c.owner).type, mods(sideOf(c.owner)).nightres) }));
      for (const { c, p, res } of hits) {
        if (p > c.defense * res) { c.owner = null; c.gray = true; c.defense = 0; c.grayAt = day; c.progress = {}; grays++; }
        else c.defense = Math.max(0, Math.round(c.defense - p * BAL.erodeKeep / res));
      }
    }
    for (const c of open) c.progress = {};
    report.grayPerNight.push(grays);
    report.daily.push({ day: DAY[day], n: sideLit('n').length, s: sideLit('s').length });
  }
  const lm = sd => sideLit(sd).filter(c => c.effect).length;
  for (const c of open) if (c.effect) report.final[c.name] = isLit(c) ? sideOf(c.owner) : 'none';
  report.score = { n: seasonScore(sideLit('n').length, lm('n')), s: seasonScore(sideLit('s').length, lm('s')) };
  return report;
}

export function batch(n, s, seeds, sessions, knobs) {
  const runs = Array.from({ length: seeds }, (_, i) => simulate({ n, s, seed: i + 1, sessions, knobs }));
  const contactDays = runs.map(r => r.contact?.day ?? 8);
  const yeoui = ['국회의사당', '더현대·파크원', '63빌딩'];
  const lmShare = { n: 0, s: 0, none: 0 };
  const lmFirst = { n: 0, s: 0, none: 0 };
  for (const r of runs) for (const name of yeoui) { lmShare[r.final[name] || 'none']++; lmFirst[r.landmarks[name]?.side || 'none']++; }
  const small = n < s ? 'n' : 's', big = small === 'n' ? 's' : 'n';
  return {
    config: `${n}/${s}`, seeds,
    contactAvgDay: +(contactDays.reduce((a, b) => a + b, 0) / seeds).toFixed(2),
    contactByWed: runs.filter(r => r.contact && r.contact.day <= 3).length / seeds,
    contactTiles: Object.entries(runs.reduce((a, r) => { if (r.contact) a[r.contact.tile] = (a[r.contact.tile] || 0) + 1; return a; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 3),
    yeouidoLandmarks: lmShare, yeouidoFirst: lmFirst,
    scoreAvg: { n: +(runs.reduce((a, r) => a + r.score.n, 0) / seeds).toFixed(1), s: +(runs.reduce((a, r) => a + r.score.s, 0) / seeds).toFixed(1) },
    smallOverBig: n === s ? null : +(runs.reduce((a, r) => a + r.score[small] / Math.max(1, r.score[big]), 0) / seeds).toFixed(2),
    grayPerNightAvg: Array.from({ length: 7 }, (_, d) => +(runs.reduce((a, r) => a + r.grayPerNight[d], 0) / seeds).toFixed(1)),
    litByDayAvg: Array.from({ length: 7 }, (_, d) => ({ day: DAY[d], n: +(runs.reduce((a, r) => a + r.daily[d].n, 0) / seeds).toFixed(1), s: +(runs.reduce((a, r) => a + r.daily[d].s, 0) / seeds).toFixed(1) })),
    sample: runs[0],
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = k => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : null; };
  const seeds = +(arg('seeds') || 20), sess = (arg('sessions') || '4-6').split('-').map(Number);
  const configs = arg('n') ? [[+arg('n'), +(arg('s') || arg('n'))]] : [[5, 5], [10, 10], [10, 5]];
  const out = { settings: { settleBase: BAL.settleBase, settlePerDist: BAL.settlePerDist, bridgeSettle: BAL.bridgeSettle, saetBridge: BAL.saetBridge, seeds, sessions: sess }, results: configs.map(([n, s]) => batch(n, s, seeds, sess)) };
  for (const r of out.results) {
    console.log(`\n== ${r.config} (시드 ${r.seeds}개) ==`);
    console.log(`첫 접촉 평균 ${r.contactAvgDay}일째 · 수요일까지 접촉 ${Math.round(r.contactByWed * 100)}% · 자주 만난 칸 ${r.contactTiles.map(([t, c]) => `${t}(${c})`).join(', ')}`);
    console.log(`여의도 랜드마크(3곳 × 시드, 일요일 밤 주인) 강북 ${r.yeouidoLandmarks.n} · 강남 ${r.yeouidoLandmarks.s} · 아무도 ${r.yeouidoLandmarks.none} / 처음 밝힌 쪽 강북 ${r.yeouidoFirst.n} · 강남 ${r.yeouidoFirst.s}`);
    console.log(`최종 점수 평균 강북 ${r.scoreAvg.n} · 강남 ${r.scoreAvg.s}` + (r.smallOverBig != null ? ` · 작은 쪽/큰 쪽 ${r.smallOverBig}` : ''));
    console.log('요일별 등불 칸(강북/강남): ' + r.litByDayAvg.map(d => `${d.day} ${d.n}/${d.s}`).join(' · '));
    console.log('밤마다 잿빛이 된 칸: ' + r.grayPerNightAvg.join(', '));
  }
  writeFileSync(ROOT + 'sim-report.json', JSON.stringify(out, null, 1) + '\n');
  console.log('\nsim-report.json 저장');
}
