// 시범 전선(6개 구) 헥스 지도를 만든다.
//   node scripts/build_map.mjs
// 입력: data/geo/gu.json, dong.json(통계청 2013 행정구역 경계, southkorea/seoul-maps)
// 출력: web/data/map.json(화면용), supabase/seed.sql(DB 칸 목록)
// 칸 폭 약 1.1km(뾰족한 위 헥스). 칸 중심이 속한 구가 그 칸의 시작 주인이다.
// 한강은 중심선(아래 RIVER)에서 가까운 칸을 강 칸으로, 다리 위치에서 가장 가까운 강 칸을 다리 칸으로 만든다.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { hexToPixel, neighbors, key } from '../web/js/rules.js';

const ROOT = new URL('..', import.meta.url).pathname;
const gu = JSON.parse(readFileSync(ROOT + 'data/geo/gu.json', 'utf8'));
const dong = JSON.parse(readFileSync(ROOT + 'data/geo/dong.json', 'utf8'));

export const GU = {
  '마포구': { id: 'mapo', short: '마포', type: 'river', side: 'n', symbol: '절두산 물결', color: '#3E7C8C' },
  '용산구': { id: 'yongsan', short: '용산', type: 'legend', side: 'n', symbol: '남산 봉수', color: '#8C5A3E' },
  '중구': { id: 'jung', short: '중구', type: 'city', side: 'n', symbol: '숭례문 기와', color: '#6B4E8C' },
  '영등포구': { id: 'yeongdeungpo', short: '영등포', type: 'city', side: 's', symbol: '여의도 63', color: '#B07A2A' },
  '동작구': { id: 'dongjak', short: '동작', type: 'river', side: 's', symbol: '노들 백로', color: '#4E7A4E' },
  '관악구': { id: 'gwanak', short: '관악', type: 'legend', side: 's', symbol: '낙성대 별', color: '#A0463C' },
};

const SIZE = 0.635; // km, 꼭짓점까지 거리(폭 = √3 × 0.635 ≈ 1.1km)
const LAT0 = 37.53, LNG0 = 126.95;
const KX = Math.cos(LAT0 * Math.PI / 180) * 111.32, KY = 110.574;
const toKm = ([lng, lat]) => [(lng - LNG0) * KX, (LAT0 - lat) * KY];

// 한강 중심선(서→동, 대략값)과 다리
const RIVER = [[126.872, 37.574], [126.884, 37.565], [126.894, 37.556], [126.903, 37.545], [126.913, 37.539], [126.928, 37.539],
  [126.938, 37.534], [126.947, 37.527], [126.955, 37.519], [126.966, 37.513], [126.980, 37.508], [126.996, 37.512],
  [127.007, 37.520], [127.016, 37.529]];
const BRIDGES = [['양화대교', [126.903, 37.544]], ['마포대교', [126.936, 37.535]], ['한강대교', [126.959, 37.516]], ['동작대교', [126.981, 37.508]]];
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
  // 다리 칸: 강 북쪽 땅과 남쪽 땅에 모두 닿는 강 칸 중 다리 위치에서 가장 가까운 것
  const SIDE = Object.fromEntries(Object.values(GU).map(g => [g.id, g.side]));
  const sidesOf = c => new Set(neighbors(c.q, c.r).map(([q, r]) => cells.get(key(q, r))).filter(n => n?.kind === 'land').map(n => SIDE[n.gu]));
  for (const [name, ll] of BRIDGES) { const c = nearest(ll, c => c.kind === 'river' && sidesOf(c).size === 2); c.kind = 'bridge'; c.name = name; }
  for (const [name, ll] of LANDMARKS) { const c = nearest(ll, c => c.kind === 'land' && !c.landmark); if (c) { c.name = name; c.landmark = true; } }
  // 강 칸 이름: 밤섬 근처는 밤섬
  const bam = nearest([126.927, 37.540], c => c.kind === 'river'); if (bam) bam.name = '밤섬';
  // 나머지 이름: 동 이름(같은 이름이 여러 칸이면 뒤에 번호)
  const used = Object.fromEntries(LANDMARKS.map(([n]) => [n, 1]));
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
    if (c.dong === '여의동') c.island = true; // 여의도(섬 땅 색)
    delete c.dong;
  }
  const km = ll => toKm(ll).map(v => +v.toFixed(3));
  const tileAt = ll => { const [x, y] = toKm(ll); let best = null, bd = 1e9; for (const c of list) { const d = Math.hypot(c.x - x, c.y - y); if (d < bd) { bd = d; best = c; } } return best.id; };
  return {
    size: SIZE, list, river: riverKm.map(([x, y]) => [+x.toFixed(3), +y.toFixed(3)]),
    bridges: BRIDGES.map(([name, ll]) => ({ name, at: km(ll) })),
    sprites: SPRITES.map(([key, ll]) => ({ key, at: km(ll), tile: tileAt(ll) })),
    bamseom: km(BAMSEOM),
  };
}

function sqlStr(s) { return s == null ? 'null' : `'${String(s).replace(/'/g, "''")}'`; }

if (import.meta.url === `file://${process.argv[1]}`) {
  const m = buildMap();
  const gus = Object.entries(GU).map(([full, g]) => ({ ...g, name: full }));
  mkdirSync(ROOT + 'web/data', { recursive: true });
  writeFileSync(ROOT + 'web/data/map.json', JSON.stringify({ size: m.size, river: m.river, bridges: m.bridges, sprites: m.sprites, bamseom: m.bamseom, gu: gus, tiles: m.list }) + '\n');
  const rows = m.list.map(c => `(${c.id},${c.q},${c.r},${sqlStr(c.kind)},${sqlStr(c.gu)},${sqlStr(c.name)},${c.edge},${!!c.landmark})`);
  const guRows = gus.map(g => `(${sqlStr(g.id)},${sqlStr(g.name)},${sqlStr(g.short)},${sqlStr(g.type)},${sqlStr(g.side)})`);
  writeFileSync(ROOT + 'supabase/seed.sql', `-- scripts/build_map.mjs가 만든 파일(손으로 고치지 않는다). 칸 ${m.list.length}개.
insert into public.gus (id, name, short, type, side) values
${guRows.join(',\n')}
on conflict (id) do update set name = excluded.name, short = excluded.short, type = excluded.type, side = excluded.side;
insert into public.tile_defs (id, q, r, kind, home_gu, name, edge, landmark) values
${rows.join(',\n')}
on conflict (id) do update set q = excluded.q, r = excluded.r, kind = excluded.kind, home_gu = excluded.home_gu, name = excluded.name, edge = excluded.edge, landmark = excluded.landmark;
`);
  const count = {}; for (const c of m.list) count[c.gu || c.kind] = (count[c.gu || c.kind] || 0) + 1;
  console.log('칸', m.list.length, count);
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
