// 서울 전역 헥스 지도를 만든다. 시범 전선 6개 구만 열려 있고(게임 칸, DB에 있음), 나머지 19개 구는 봉인된 땅(화면에만).
//   node scripts/build_map.mjs
// 입력: data/geo/gu.json, dong.json(통계청 2013 행정구역 경계, southkorea/seoul-maps)
// 출력: web/data/map.json(화면용), supabase/seed.sql(DB 칸 목록)
// 칸 폭 약 1.1km(뾰족한 위 헥스). 칸 중심이 속한 구가 그 칸의 시작 주인이다.
// 한강은 중심선(아래 RIVER)에서 가까운 칸을 강 칸으로, 다리 위치에서 가장 가까운 강 칸을 다리 칸으로 만든다.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { hexToPixel, neighbors, key } from '../web/js/rules.js';

const ROOT = new URL('..', import.meta.url).pathname;
const guAll = JSON.parse(readFileSync(ROOT + 'data/geo/gu.json', 'utf8'));
const dongAll = JSON.parse(readFileSync(ROOT + 'data/geo/dong.json', 'utf8'));
const PILOT = ['마포구', '용산구', '중구', '영등포구', '동작구', '관악구'];
// 열린 칸(1~120)은 시범 전선 6개 구 경계만으로 예전과 똑같이 계산한다(칸 번호가 DB와 같아야 한다)
const gu = { features: guAll.features.filter(f => PILOT.includes(f.properties.name)) };
const pilotCodes = new Set(gu.features.map(f => f.properties.code));
const dong = { features: dongAll.features.filter(f => pilotCodes.has(f.properties.code.slice(0, 5))) };

export const GU = {
  '마포구': { id: 'mapo', short: '마포', type: 'river', side: 'n', symbol: '절두산 물결', color: '#3E7C8C', hall: [126.9019, 37.5663] },
  '용산구': { id: 'yongsan', short: '용산', type: 'legend', side: 'n', symbol: '남산 봉수', color: '#8C5A3E', hall: [126.9905, 37.5324] },
  '중구': { id: 'jung', short: '중구', type: 'city', side: 'n', symbol: '숭례문 기와', color: '#6B4E8C', hall: [126.9975, 37.5637] },
  '영등포구': { id: 'yeongdeungpo', short: '영등포', type: 'city', side: 's', symbol: '여의도 63', color: '#B07A2A', hall: [126.8962, 37.5264] },
  '동작구': { id: 'dongjak', short: '동작', type: 'river', side: 's', symbol: '노들 백로', color: '#4E7A4E', hall: [126.9393, 37.5049] },
  '관악구': { id: 'gwanak', short: '관악', type: 'legend', side: 's', symbol: '낙성대 별', color: '#A0463C', hall: [126.9516, 37.4784] },
};
// 봉인된 19개 구(기획서 8절 유형). 열면 GU로 옮기고 web/styles.css에 --gu-<id> 색을 더한다.
export const SEALED = {
  '종로구': { id: 'jongno', short: '종로', type: 'legend', side: 'n', symbol: '인왕산 호랑이' },
  '성동구': { id: 'seongdong', short: '성동', type: 'river', side: 'n', symbol: '응봉 개나리' },
  '광진구': { id: 'gwangjin', short: '광진', type: 'legend', side: 'n', symbol: '아차산 온달' },
  '동대문구': { id: 'dongdaemun', short: '동대문', type: 'village', side: 'n', symbol: '흥인지문' },
  '중랑구': { id: 'jungnang', short: '중랑', type: 'village', side: 'n', symbol: '봉화산 봉수' },
  '성북구': { id: 'seongbuk', short: '성북', type: 'mount', side: 'n', symbol: '북악 성곽' },
  '강북구': { id: 'gangbuk', short: '강북', type: 'mount', side: 'n', symbol: '북한산 인수봉' },
  '도봉구': { id: 'dobong', short: '도봉', type: 'mount', side: 'n', symbol: '도봉산 선인봉' },
  '노원구': { id: 'nowon', short: '노원', type: 'village', side: 'n', symbol: '수락산 바위' },
  '은평구': { id: 'eunpyeong', short: '은평', type: 'mount', side: 'n', symbol: '진관사 연등' },
  '서대문구': { id: 'seodaemun', short: '서대문', type: 'mount', side: 'n', symbol: '안산 봉수대' },
  '강서구': { id: 'gangseo', short: '강서', type: 'river', side: 's', symbol: '허준 약초' },
  '양천구': { id: 'yangcheon', short: '양천', type: 'village', side: 's', symbol: '양천향교' },
  '구로구': { id: 'guro', short: '구로', type: 'village', side: 's', symbol: '구로 아홉 노인' },
  '금천구': { id: 'geumcheon', short: '금천', type: 'legend', side: 's', symbol: '호암산 해태' },
  '서초구': { id: 'seocho', short: '서초', type: 'city', side: 's', symbol: '우면산 소' },
  '강남구': { id: 'gangnam', short: '강남', type: 'city', side: 's', symbol: '봉은사 연등' },
  '송파구': { id: 'songpa', short: '송파', type: 'city', side: 's', symbol: '석촌 백제' },
  '강동구': { id: 'gangdong', short: '강동', type: 'river', side: 's', symbol: '암사 빗살무늬' },
};

const SIZE = 0.635; // km, 꼭짓점까지 거리(폭 = √3 × 0.635 ≈ 1.1km)
const LAT0 = 37.53, LNG0 = 126.95;
const KX = Math.cos(LAT0 * Math.PI / 180) * 111.32, KY = 110.574;
const toKm = ([lng, lat]) => [(lng - LNG0) * KX, (LAT0 - lat) * KY];

// 한강 중심선(서→동, 대략값)과 다리
const RIVER = [[126.872, 37.574], [126.884, 37.565], [126.894, 37.556], [126.903, 37.545], [126.913, 37.539], [126.928, 37.539],
  [126.938, 37.534], [126.947, 37.527], [126.955, 37.519], [126.966, 37.513], [126.980, 37.508], [126.996, 37.512],
  [127.007, 37.520], [127.016, 37.529]];
// 서울 전체 한강(서쪽 끝 개화~동쪽 끝 암사, 대략값). 열린 칸 계산에는 위 RIVER만 쓴다.
const RIVER_WEST = [[126.795, 37.598], [126.815, 37.592], [126.838, 37.585], [126.858, 37.579]];
const RIVER_EAST = [[127.024, 37.535], [127.040, 37.537], [127.058, 37.531], [127.072, 37.523], [127.090, 37.521],
  [127.104, 37.530], [127.114, 37.543], [127.130, 37.553], [127.152, 37.563], [127.178, 37.574]];
const RIVER_FULL = [...RIVER_WEST, ...RIVER, ...RIVER_EAST];
// 다리(v3): 한강 6개 + 샛강 2개. 가장 가까운, 서로 다른 땅덩이(강북·강남·여의도) 둘에 닿는 강 칸
const BRIDGES = [['양화대교', [126.903, 37.544]], ['서강대교', [126.926, 37.538]], ['마포대교', [126.936, 37.535]], ['원효대교', [126.949, 37.527]],
  ['한강대교', [126.959, 37.516]], ['동작대교', [126.981, 37.508]], ['여의교', [126.905, 37.523]], ['서울교', [126.917, 37.518]]];
// 랜드마크 효과(v3 1-3). 그 칸을 가진 연합 전체에 적용, 같은 종류 합계 최대 15%
const EFFECTS = { '남산서울타워': 'sight+2', '서울역': 'prod+5', '보라매공원': 'sight+2', '영등포역': 'prod+5', '국회의사당': 'speed+10', '더현대·파크원': 'prod+5', '63빌딩': 'nightres+10' };
// 쿼터뷰 랜드마크 그림(web/assets/landmarks/landmark-<key>.png). 실제 위치에 세운다.
const SPRITES = [
  ['assembly', [126.9140, 37.5318]], ['parc1', [126.9271, 37.5276]], ['thehyundai', [126.9283, 37.5259]],
  ['ifc', [126.9256, 37.5254]], ['63building', [126.9403, 37.5198]],
];
const BAMSEOM = [126.9275, 37.5395];
// 랜드마크 칸(가장 가까운 칸 하나에 이름을 준다)
const LANDMARKS = [
  ['국회의사당', [126.914, 37.532]], ['더현대·파크원', [126.928, 37.526]], ['63빌딩', [126.940, 37.519]],
  ['월드컵경기장', [126.897, 37.568]], ['홍대앞', [126.924, 37.556]], ['남산서울타워', [126.988, 37.551]],
  ['국립중앙박물관', [126.980, 37.524]], ['서울역', [126.972, 37.555]], ['명동', [126.985, 37.563]],
  ['동대문디자인플라자', [127.009, 37.566]], ['노량진 수산시장', [126.940, 37.513]], ['보라매공원', [126.920, 37.492]],
  ['국립서울현충원', [126.973, 37.500]], ['서울대', [126.952, 37.459]], ['낙성대', [126.958, 37.471]],
  ['영등포역', [126.906, 37.516]], ['이태원', [126.994, 37.534]], ['관악산', [126.964, 37.445]],
];

function inRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inGeom(pt, g) {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  return polys.some(p => inRing(pt, p[0]) && !p.slice(1).some(h => inRing(pt, h)));
}
const fromKm = (x, y) => [x / KX + LNG0, LAT0 - y / KY];
function distSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
const riverKm = RIVER.map(toKm);
const riverDist = p => Math.min(...riverKm.slice(1).map((b, i) => distSeg(p, riverKm[i], b)));
const riverFullKm = RIVER_FULL.map(toKm);
const riverFullDist = p => Math.min(...riverFullKm.slice(1).map((b, i) => distSeg(p, riverFullKm[i], b)));

// 봉인된 칸: 열린 칸 밖, 서울 25개 구 안. 번호는 1001부터(DB에는 넣지 않는다)
export function buildSealed(open) {
  const taken = new Set(open.map(c => key(c.q, c.r)));
  const META = { ...GU, ...SEALED };
  const out = [];
  for (let r = -30; r <= 30; r++) for (let q = -40; q <= 40; q++) {
    if (taken.has(key(q, r))) continue;
    const { x, y } = hexToPixel(q, r, SIZE), ll = fromKm(x, y);
    const g = guAll.features.find(f => inGeom(ll, f.geometry));
    if (!g) continue;
    const river = riverFullDist([x, y]) < 0.56;
    const d = dongAll.features.find(f => inGeom(ll, f.geometry));
    out.push({ q, r, x: +x.toFixed(3), y: +y.toFixed(3), kind: river ? 'river' : 'land', gu: river ? null : META[g.properties.name].id, home: META[g.properties.name].id, dong: d?.properties.name || null });
  }
  out.sort((a, b) => a.r - b.r || a.q - b.q);
  const used = {};
  return out.map((c, i) => {
    let name = '한강';
    if (c.kind !== 'river') {
      let base = (c.dong || '빈터').replace(/제?\d+동$/, '동').replace(/본동$/, '동').replace(/동$/, '');
      if (base.length < 2) base += '동';
      used[base] = (used[base] || 0) + 1; name = used[base] > 1 ? `${base} ${used[base]}` : base;
    }
    const { dong: _d, ...rest } = c;
    return { id: 1001 + i, ...rest, name, sealed: true };
  });
}

export function buildMap() {
  const cells = new Map();
  for (let r = -18; r <= 18; r++) for (let q = -20; q <= 20; q++) {
    const { x, y } = hexToPixel(q, r, SIZE);
    const ll = fromKm(x, y);
    const g = gu.features.find(f => inGeom(ll, f.geometry));
    const nearRiver = riverDist([x, y]) < 0.56 && ll[0] > 126.876 && ll[0] < 127.02;
    if (!g && !nearRiver) continue;
    const d = dong.features.find(f => inGeom(ll, f.geometry));
    cells.set(key(q, r), { q, r, x: +x.toFixed(3), y: +y.toFixed(3), kind: nearRiver ? 'river' : 'land',
      gu: nearRiver ? null : GU[g.properties.name].id, dong: d?.properties.name || null });
  }
  // 강 칸 중 땅에 닿지 않은 것은 뺀다
  for (const [k, c] of cells) if (c.kind === 'river' && !neighbors(c.q, c.r).some(([q, r]) => cells.get(key(q, r))?.kind === 'land')) cells.delete(k);
  const nearest = (ll, pred) => {
    const [px, py] = toKm(ll); let best = null, bd = 1e9;
    for (const c of cells.values()) if (pred(c)) { const dd = Math.hypot(c.x - px, c.y - py); if (dd < bd) { bd = dd; best = c; } }
    return best;
  };
  // 여의도(v3 1-2): 여의동 땅은 주인 없는 섬. 섬에 붙은 섬 밖 땅 칸은 샛강(강 칸)으로 바꿔 사방을 강으로 두른다
  for (const c of cells.values()) if (c.kind === 'land' && c.dong === '여의동') { c.island = true; c.gu = null; }
  for (const c of [...cells.values()]) if (c.island) for (const [q, r] of neighbors(c.q, c.r)) {
    const o = cells.get(key(q, r));
    if (o && o.kind === 'land' && !o.island) { o.kind = 'river'; o.gu = null; o.saet = true; }
  }
  // 다리: 서로 다른 땅덩이(강북 n, 강남 s, 여의도 i) 둘 이상에 닿는 강 칸 중 다리 위치에서 가장 가까운 칸
  const SIDE = Object.fromEntries(Object.values(GU).map(g => [g.id, g.side]));
  const mass = c => (c.island ? 'i' : SIDE[c.gu]);
  const massesOf = c => new Set(neighbors(c.q, c.r).map(([q, r]) => cells.get(key(q, r))).filter(n => n?.kind === 'land').map(mass));
  for (const [name, ll] of BRIDGES) {
    const c = nearest(ll, c => c.kind === 'river' && massesOf(c).size >= 2);
    if (!c) throw new Error('다리 자리를 찾지 못함: ' + name);
    c.kind = 'bridge'; c.name = name; c.saetBridge = !!c.saet;
  }
  // 구청 = 시작 칸(그 구의 섬 밖 땅 중 구청에서 가장 가까운 칸)
  for (const [full, g] of Object.entries(GU)) {
    const c = nearest(g.hall, c => c.kind === 'land' && c.gu === g.id && !c.island);
    c.hall = g.id; c.name = full + '청';
  }
  const ISLAND_LM = new Set(['국회의사당', '더현대·파크원', '63빌딩']);
  for (const [name, ll] of LANDMARKS) {
    const c = nearest(ll, c => c.kind === 'land' && !c.landmark && !c.hall && !!c.island === ISLAND_LM.has(name));
    if (c) { c.name = name; c.landmark = true; if (EFFECTS[name]) c.effect = EFFECTS[name]; }
  }
  // 강 칸 이름: 밤섬 근처는 밤섬
  const bam = nearest([126.927, 37.540], c => c.kind === 'river'); if (bam) bam.name = '밤섬';
  // 나머지 이름: 동 이름(같은 이름이 여러 칸이면 뒤에 번호)
  const used = Object.fromEntries([...LANDMARKS.map(([n]) => [n, 1]), ...Object.keys(GU).map(n => [n + '청', 1])]);
  for (const c of [...cells.values()].sort((a, b) => a.r - b.r || a.q - b.q)) {
    if (c.name) continue;
    if (c.kind === 'river') { c.name = '한강'; continue; }
    let base = (c.dong || '빈터').replace(/제?\d+동$/, '동').replace(/본동$/, '동').replace(/동$/, '');
    if (base.length < 2) base += '동'; // 필동, 중동처럼 한 글자는 '동'을 남긴다
    used[base] = (used[base] || 0) + 1;
    c.name = used[base] > 1 ? `${base} ${used[base]}` : base;
  }
  const list = [...cells.values()].sort((a, b) => a.r - b.r || a.q - b.q).map((c, i) => ({ id: i + 1, ...c }));
  const idOf = new Map(list.map(c => [key(c.q, c.r), c.id]));
  for (const c of list) {
    const ns = neighbors(c.q, c.r).map(([q, r]) => idOf.get(key(q, r))).filter(Boolean);
    c.edge = ns.length < 6; // 지도 가장자리(어둠이 들어오는 곳)
    delete c.dong;
  }
  const km = ll => toKm(ll).map(v => +v.toFixed(3));
  const tileAt = ll => { const [x, y] = toKm(ll); let best = null, bd = 1e9; for (const c of list) { const d = Math.hypot(c.x - x, c.y - y); if (d < bd) { bd = d; best = c; } } return best.id; };
  return {
    size: SIZE, list, river: riverKm.map(([x, y]) => [+x.toFixed(3), +y.toFixed(3)]),
    bridges: BRIDGES.map(([name, ll]) => { const t = list.find(c => c.name === name); return { name, at: t.saetBridge ? [t.x, t.y] : km(ll), saet: !!t.saetBridge }; }),
    sprites: SPRITES.map(([key, ll]) => ({ key, at: km(ll), tile: tileAt(ll) })),
    bamseom: km(BAMSEOM),
    // 샛강 물길(화면에 가는 강으로 그린다): 샛강 칸 중심을 서→동으로
    saetgang: list.filter(c => c.saet).sort((a, b) => (a.x - a.y) - (b.x - b.y)).map(c => [c.x, c.y]),
    riverFull: riverFullKm.map(([x, y]) => [+x.toFixed(3), +y.toFixed(3)]),
  };
}

function sqlStr(s) { return s == null ? 'null' : `'${String(s).replace(/'/g, "''")}'`; }

if (import.meta.url === `file://${process.argv[1]}`) {
  const m = buildMap();
  const gus = [...Object.entries(GU).map(([full, g]) => ({ ...g, name: full, open: true })),
    ...Object.entries(SEALED).map(([full, g]) => ({ ...g, name: full, open: false }))];
  const sealed = buildSealed(m.list);
  mkdirSync(ROOT + 'web/data', { recursive: true });
  writeFileSync(ROOT + 'web/data/map.json', JSON.stringify({ size: m.size, river: m.riverFull, saetgang: m.saetgang, bridges: m.bridges, sprites: m.sprites, bamseom: m.bamseom, gu: gus, tiles: [...m.list, ...sealed] }) + '\n');
  const rows = m.list.map(c => `(${c.id},${c.q},${c.r},${sqlStr(c.kind)},${sqlStr(c.gu)},${sqlStr(c.name)},${c.edge},${!!c.landmark},${sqlStr(c.hall || null)},${sqlStr(c.effect || null)})`);
  const guRows = gus.map(g => `(${sqlStr(g.id)},${sqlStr(g.name)},${sqlStr(g.short)},${sqlStr(g.type)},${sqlStr(g.side)},${g.open})`);
  writeFileSync(ROOT + 'supabase/seed.sql', `-- scripts/build_map.mjs가 만든 파일(손으로 고치지 않는다). 칸 ${m.list.length}개.
insert into public.gus (id, name, short, type, side, open) values
${guRows.join(',\n')}
on conflict (id) do update set name = excluded.name, short = excluded.short, type = excluded.type, side = excluded.side, open = excluded.open;
insert into public.tile_defs (id, q, r, kind, home_gu, name, edge, landmark, hall_gu, effect) values
${rows.join(',\n')}
on conflict (id) do update set q = excluded.q, r = excluded.r, kind = excluded.kind, home_gu = excluded.home_gu, name = excluded.name, edge = excluded.edge, landmark = excluded.landmark, hall_gu = excluded.hall_gu, effect = excluded.effect;
`);
  const count = {}; for (const c of m.list) count[c.gu || c.kind] = (count[c.gu || c.kind] || 0) + 1;
  console.log('열린 칸', m.list.length, count, '· 봉인된 칸', sealed.length);
  // 눈으로 확인용 그림(글자)
  const byKey = new Map(m.list.map(c => [key(c.q, c.r), c]));
  const ch = { mapo: 'M', yongsan: 'Y', jung: 'J', yeongdeungpo: 'D', dongjak: 'K', gwanak: 'G' };
  for (let r = -18; r <= 18; r++) {
    let line = ' '.repeat(Math.abs(r % 2)), any = false;
    for (let q = -12 - Math.floor(r / 2); q <= 12 - Math.floor(r / 2); q++) {
      const c = byKey.get(key(q, r)); if (c) any = true;
      line += (c ? (c.kind === 'river' ? '~' : c.kind === 'bridge' ? '=' : ch[c.gu]) : '.') + ' ';
    }
    if (any) console.log(line);
  }
}
