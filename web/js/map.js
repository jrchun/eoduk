// 지도 그리기(Canvas 2D) — 쿼터뷰 디오라마(작업지시서 v2 2절).
// 평면 좌표(km, map.json의 x·y)를 X = (x - y)·0.6, Y = (x + y)·0.3 으로 투영한다.
// 순서: 1 바닥(지형, 저해상도 4배 확대) 2 칸 3 세운 물체(깊이 순) 4 안개 5 화면 요소(경고 테두리·이름표·알약)
// 색은 styles.css의 CSS 변수(--t-*, --tile-*, --gu-*, --label-*, --pill-*, --fog*)에서 읽는다.
import { pixelToHex, key, hexDistance, fmtLeft } from './rules.js';
import { marchProgress } from './view.js';
import { drawSprite, IMG, drawImageFoot } from './sprites.js';

const KX = 0.6, KY = 0.3, LOW = 4;
// 뾰족한 위 헥스 꼭짓점(평면, y 아래로)
const CORNER = [...Array(6)].map((_, i) => { const a = Math.PI / 180 * (60 * i - 30); return [Math.cos(a), Math.sin(a)]; });
const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]].map(r => r.map(v => (v + 0.5) / 16));
const VARS = ['--t-land', '--t-island', '--t-river', '--t-wave', '--t-park', '--t-ink', '--t-bridge', '--t-bam', '--t-night', '--t-night-a',
  '--tile-line', '--tile-a', '--tile-ours', '--tile-gray', '--tile-gray-line', '--tile-neutral', '--ours-dark', '--attack', '--erode',
  '--label-bg', '--label-fg', '--label-shadow', '--pill-enemy', '--pill-ours', '--pill-fg', '--fog', '--fog-a', '--cloud-line', '--cloud-fill',
  '--eyes', '--glow', '--fg', '--ours', '--enemy', '--map-bg'];

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function hex2rgb(h) { const m = /^#?([0-9a-f]{6})$/i.exec(h.trim()); const n = m ? parseInt(m[1], 16) : 0; return [n >> 16, (n >> 8) & 255, n & 255]; }

export class MapView {
  // opts: interactive(입력 받기, 기본 true), size({w,h}: 화면 밖 장면용 고정 크기), pc(PC 배치로 볼지),
  //       noFog(안개 끄기), zoom(기본 확대 배율). 온보딩 장면·공유 카드도 이 클래스로 그린다(실제 게임과 같은 그림).
  constructor(canvas, idx, handlers = {}, opts = {}) {
    this.opts = opts;
    this.cv = canvas; this.g = canvas.getContext('2d'); this.idx = idx; this.h = handlers;
    this.tiles = [...idx.byId.values()];
    this.state = { marches: [], myGu: null, selected: null, flags: [], phase: null, incomingIds: new Set(), erodingIds: new Set(), reinforced: new Set(), canMarch: false, watchers: 0 };
    this.cam = { x: 0, y: 0, s: 120 }; this.inset = 0; this.drag = null; this.pointers = new Map(); this.homed = null;
    const xs = this.tiles.map(c => c.x), ys = this.tiles.map(c => c.y), m = idx.size;
    this.plane = { x0: Math.min(...xs) - m, x1: Math.max(...xs) + m, y0: Math.min(...ys) - m, y1: Math.max(...ys) + m };
    const px = this.tiles.flatMap(c => [KX * (c.x - c.y)]), py = this.tiles.flatMap(c => [KY * (c.x + c.y)]);
    this.proj = { x0: Math.min(...px) - 2, x1: Math.max(...px) + 2, y0: Math.min(...py) - 1.5, y1: Math.max(...py) + 1.5 };
    if (opts.interactive !== false) this.bindInput();
    if (!opts.size) new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  css(n) { return this.vars[n] || '#888'; }
  readVars() {
    const cs = getComputedStyle(this.cv); this.vars = {};
    for (const n of VARS) this.vars[n] = cs.getPropertyValue(n).trim();
    for (const g of this.idx.gu.values()) { this.vars['--gu-' + g.id] = cs.getPropertyValue('--gu-' + g.id).trim(); this.vars['--gu-' + g.id + '-dark'] = cs.getPropertyValue('--gu-' + g.id + '-dark').trim(); }
  }

  resize() {
    const r = this.opts.size ? { width: this.opts.size.w, height: this.opts.size.h } : this.cv.getBoundingClientRect();
    const dpr = this.opts.dpr || Math.min(3, window.devicePixelRatio || 1);
    this.w = r.width; this.hgt = r.height; this.dpr = dpr;
    this.cv.width = Math.max(1, Math.round(r.width * dpr)); this.cv.height = Math.max(1, Math.round(r.height * dpr));
    this.pc = this.opts.pc ?? window.innerWidth >= 1024;
    // 기본 확대: 칸 서너 개가 화면을 채울 만큼(목업 기준). 가장 작게: 지도 전체.
    this.sDefault = Math.min(this.pc ? 200 : 130, Math.max(84, r.width / (this.pc ? 5.2 : 4))) * (this.opts.zoom || 1);
    const P = this.proj;
    // 전체 보기 배율: 지형 여백(2km)은 빼고 칸들만 화면에 꽉 차게
    const fw = (P.x1 - P.x0) - 2.6, fh = (P.y1 - P.y0) - 2.2;
    this.sFit = Math.max(8, Math.min((r.width - 16) / fw, (r.height - 40) / fh));
    this.readVars(); this.fogKey = null;
    if (!this.homed) this.home(); else this.clamp();
  }

  // ---------- 좌표 ----------
  project(x, y) {
    const dx = x - this.cam.x, dy = y - this.cam.y, s = this.cam.s;
    return { x: this.w / 2 + s * KX * (dx - dy), y: (this.hgt - this.inset) / 2 + s * KY * (dx + dy) };
  }
  unproject(X, Y) {
    const s = this.cam.s, a = (X - this.w / 2) / (KX * s), b = (Y - (this.hgt - this.inset) / 2) / (KY * s);
    return { x: this.cam.x + (a + b) / 2, y: this.cam.y + (b - a) / 2 };
  }
  center(c) { return this.project(c.x, c.y); }
  tileAt(X, Y) {
    const p = this.unproject(X, Y), h = pixelToHex(p.x, p.y, this.idx.size);
    return this.idx.byKey.get(key(h.q, h.r))?.id ?? null;
  }
  hexW() { return this.cam.s * this.idx.size * 1.9; } // 화면에서 칸의 대략적인 폭(px)
  set(partial) {
    Object.assign(this.state, partial);
    const focus = partial.myGu !== undefined ? (partial.myGu || 'browse') : null;
    if (focus && focus !== this.homed) this.home();
  }

  // 우리 전선으로: 우리 구 칸 가운데(구가 없으면 국회의사당 일대)
  focusTiles() {
    const gu = this.state.myGu;
    const mine = gu ? this.tiles.filter(c => c.owner === gu) : [];
    if (mine.length) return mine;
    const center = this.tiles.find(c => c.name === '국회의사당') || this.tiles[0];
    return this.tiles.filter(c => hexDistance(c, center) <= 1);
  }
  // 둘러보는 중(구 없음): 지도 전체 / 우리 구가 있으면: 우리 전선을 크게
  overview() { return !this.state.myGu; }
  home() {
    this.homed = this.state.myGu || 'browse';
    if (this.overview()) {
      const P = this.plane;
      this.cam.x = (P.x0 + P.x1) / 2; this.cam.y = (P.y0 + P.y1) / 2; this.cam.s = this.sFit || 20;
      this.clamp(); return;
    }
    const ts = this.focusTiles();
    // 우리 칸 중 다른 구와 맞닿은 칸(전선)이 있으면 그 가운데로
    const front = ts.filter(c => c.adj.some(n => { const o = this.idx.byId.get(n); return o.kind !== 'river' && o.owner !== c.owner; }));
    const pick = front.length ? front : ts;
    this.cam.x = pick.reduce((a, c) => a + c.x, 0) / pick.length;
    this.cam.y = pick.reduce((a, c) => a + c.y, 0) / pick.length;
    this.cam.s = this.sDefault || 150;
    this.clamp();
  }
  // 장면용: 이름으로 칸을 찾아 그 칸을 가운데에
  look(name, zoom = 1) {
    const c = this.tiles.find(t => t.name === name); if (!c) return;
    this.cam.x = c.x; this.cam.y = c.y; this.cam.s = this.sDefault * zoom; this.clamp();
  }
  focus(id) {
    const c = this.idx.byId.get(id); if (!c) return;
    this.cam.x = c.x; this.cam.y = c.y; this.cam.s = Math.max(this.cam.s, this.sDefault);
    this.clamp();
  }
  setInset(px) { this.inset = Math.max(0, Math.min(this.hgt * 0.8, px || 0)); }
  setZoom(s) { this.cam.s = Math.min(this.sDefault * 1.8, Math.max(this.sFit, s)); this.clamp(); }
  zoomBy(f) { this.setZoom(this.cam.s * f); }
  clamp() {
    const P = this.plane;
    this.cam.x = Math.max(P.x0, Math.min(P.x1, this.cam.x)); this.cam.y = Math.max(P.y0, Math.min(P.y1, this.cam.y));
    this.cam.s = Math.min(this.sDefault * 1.8, Math.max(this.sFit || 8, this.cam.s));
  }
  clampPan() { this.clamp(); }

  // ---------- 입력: 탭(칸 고르기), 우리 칸에서 끌기(진군), 그 밖에 끌기(이동), 두 손가락·휠(확대) ----------
  bindInput() {
    const cv = this.cv;
    const pos = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    cv.addEventListener('pointerdown', e => {
      cv.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, pos(e));
      if (this.pointers.size === 2) { const [a, b] = [...this.pointers.values()]; this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: this.cam.s }; this.drag = null; return; }
      const p = pos(e), id = this.tileAt(p.x, p.y);
      const own = id && this.state.canMarch && this.idx.byId.get(id).owner === this.state.myGu;
      this.drag = { start: p, last: p, id, mode: own ? 'march?' : 'pan?', moved: false };
    });
    cv.addEventListener('pointermove', e => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, pos(e));
      if (this.pinch && this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.setZoom(this.pinch.s * Math.hypot(a.x - b.x, a.y - b.y) / this.pinch.d); return;
      }
      const d = this.drag; if (!d) return;
      const p = pos(e);
      if (!d.moved && Math.hypot(p.x - d.start.x, p.y - d.start.y) > 8) { d.moved = true; d.mode = d.mode === 'march?' ? 'march' : 'pan'; }
      if (d.mode === 'pan') {
        const s = this.cam.s, ax = (p.x - d.last.x) / (KX * s), by = (p.y - d.last.y) / (KY * s);
        this.cam.x -= (ax + by) / 2; this.cam.y -= (by - ax) / 2; this.clamp();
      }
      if (d.mode === 'march') d.hover = this.tileAt(p.x, p.y);
      d.last = p;
    });
    const end = e => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      const d = this.drag; this.drag = null; if (!d) return;
      if (!d.moved) { this.h.onTap?.(d.id); return; }
      if (d.mode === 'march' && d.hover && d.hover !== d.id) this.h.onDragMarch?.(d.id, d.hover);
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', e => { this.pointers.delete(e.pointerId); this.drag = null; this.pinch = null; });
    cv.addEventListener('wheel', e => { e.preventDefault(); this.zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15); }, { passive: false });
    cv.addEventListener('dblclick', () => { if (this.cam.s > this.sDefault * 1.2) this.home(); else this.zoomBy(1.5); });
  }

  // ---------- 1. 바닥(지형): 지도 데이터·확대·테마가 바뀔 때만 저해상도로 다시 그린다 ----------
  makeTerrain() {
    const s4 = this.cam.s / LOW, P = this.proj, idx = this.idx;
    const W = Math.ceil((P.x1 - P.x0) * s4), H = Math.ceil((P.y1 - P.y0) * s4);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = this.css('--t-land'); g.fillRect(0, 0, W, H);
    g.setTransform(KX * s4, KY * s4, -KX * s4, KY * s4, -P.x0 * s4, -P.y0 * s4);
    const px = 1 / (s4 * 0.45); // 저해상도 1픽셀 ≈ 평면 km
    // 여의도 섬 땅
    g.fillStyle = this.css('--t-island');
    for (const t of this.tiles) if (t.island && t.kind === 'land') { this.hexPlane(g, t.x, t.y, idx.size * 1.02); g.fill(); }
    // 한강: 먹선 → 강변 공원 → 물
    const river = idx.river, strokeRiver = (w, col) => {
      g.beginPath(); river.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.lineWidth = w; g.strokeStyle = col; g.lineCap = 'round'; g.lineJoin = 'round'; g.stroke();
    };
    const RW = 0.9;
    strokeRiver(RW + 8 * px, this.css('--t-ink'));
    strokeRiver(RW + 6 * px, this.css('--t-park'));
    strokeRiver(RW, this.css('--t-river'));
    // 밤섬
    if (idx.bamseom) {
      const [bx, by] = idx.bamseom;
      g.beginPath(); g.ellipse(bx, by, 0.32, 0.11, -0.25, 0, Math.PI * 2);
      g.fillStyle = this.css('--t-bam'); g.fill(); g.lineWidth = px; g.strokeStyle = this.css('--t-ink'); g.stroke();
    }
    // 다리: 강을 가로지르는 띠
    for (const b of idx.bridges || []) {
      const [ax, ay] = b.at; let best = null, bd = 1e9;
      for (let i = 1; i < river.length; i++) { const mx = (river[i][0] + river[i - 1][0]) / 2, my = (river[i][1] + river[i - 1][1]) / 2, d = Math.hypot(mx - ax, my - ay); if (d < bd) { bd = d; best = i; } }
      let dx = river[best][0] - river[best - 1][0], dy = river[best][1] - river[best - 1][1]; const l = Math.hypot(dx, dy); dx /= l; dy /= l;
      const nx = -dy, ny = dx, half = RW / 2 + 0.25;
      g.beginPath(); g.moveTo(ax - nx * half, ay - ny * half); g.lineTo(ax + nx * half, ay + ny * half);
      g.lineCap = 'butt'; g.lineWidth = 6 * px; g.strokeStyle = this.css('--t-ink'); g.stroke();
      g.lineWidth = 4 * px; g.strokeStyle = this.css('--t-bridge'); g.stroke();
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    // 픽셀 다듬기: 물결 무늬, 한지 섬유 점
    const img = g.getImageData(0, 0, W, H), d = img.data, water = hex2rgb(this.css('--t-river')), wave = hex2rgb(this.css('--t-wave'));
    const isWater = i => Math.abs(d[i] - water[0]) < 10 && Math.abs(d[i + 1] - water[1]) < 10 && Math.abs(d[i + 2] - water[2]) < 10;
    const R = rng(11);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (!isWater(i) && R() < 0.06) { d[i] -= 10; d[i + 1] -= 10; d[i + 2] -= 10; }
    }
    for (let y = 0; y < H; y += 6) for (let x = ((y / 6) % 2) * 3; x + 4 < W; x += 9) {
      let ok = true; for (let k = 0; k < 4 && ok; k++) ok = isWater((y * W + x + k) * 4);
      if (ok) for (let k = 0; k < 4; k++) { const i = (y * W + x + k) * 4; d[i] = wave[0]; d[i + 1] = wave[1]; d[i + 2] = wave[2]; }
    }
    g.putImageData(img, 0, 0);
    const na = parseFloat(this.css('--t-night-a')) || 0;
    if (na > 0) { g.globalAlpha = na; g.fillStyle = this.css('--t-night'); g.fillRect(0, 0, W, H); g.globalAlpha = 1; }
    this.terrain = { c, s: this.cam.s, theme: this.theme };
  }
  hexPlane(g, x, y, r) { g.beginPath(); CORNER.forEach(([cx, cy], i) => (i ? g.lineTo(x + cx * r, y + cy * r) : g.moveTo(x + cx * r, y + cy * r))); g.closePath(); }
  hexScreen(c, shrink = 1) {
    const g = this.g, r = this.idx.size * shrink;
    g.beginPath();
    CORNER.forEach(([cx, cy], i) => { const p = this.project(c.x + cx * r, c.y + cy * r); i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); });
    g.closePath();
  }

  // ---------- 4. 안개: 밝은 영역(우리 구 + 바깥 2줄) 밖을 베이어 디더링으로 ----------
  brightCenters() {
    const gu = this.state.myGu, mine = gu ? this.tiles.filter(c => c.owner === gu) : [];
    const seed = mine.length ? mine : this.focusTiles();
    const ring = mine.length ? 2 : 2;
    const set = this.tiles.filter(c => seed.some(m => hexDistance(m, c) <= ring));
    return set.map(c => [c.x, c.y]);
  }
  makeFog() {
    const W = Math.ceil(this.w / LOW), H = Math.ceil(this.hgt / LOW);
    const centers = this.brightCenters(), r0 = this.idx.size * 0.95, band = this.idx.size * 1.7;
    const c = this.fogCanvas && this.fogCanvas.width === W && this.fogCanvas.height === H ? this.fogCanvas : Object.assign(document.createElement('canvas'), { width: W, height: H });
    const g = c.getContext('2d'), img = g.createImageData(W, H), d = img.data;
    const [fr, fg, fb] = hex2rgb(this.css('--fog')), fa = Math.round((parseFloat(this.css('--fog-a')) || 0.93) * 255);
    const dist = (x, y) => { let m = 1e9; for (const [cx, cy] of centers) { const dd = (cx - x) * (cx - x) + (cy - y) * (cy - y); if (dd < m) m = dd; } return Math.sqrt(m); };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = this.unproject(x * LOW + 2, y * LOW + 2);
      const t = Math.min(1, Math.max(0, (dist(p.x, p.y) - r0) / band));
      if (t > BAYER[y & 3][x & 3]) { const i = (y * W + x) * 4; d[i] = fr; d[i + 1] = fg; d[i + 2] = fb; d[i + 3] = fa; }
    }
    g.putImageData(img, 0, 0);
    this.fogCanvas = c;
    // 경계를 따라 40°마다 구름문(낮)·어둑시니 눈(밤) 자리
    const cx = centers.reduce((a, p) => a + p[0], 0) / centers.length, cy = centers.reduce((a, p) => a + p[1], 0) / centers.length;
    this.fogMarks = [];
    for (let a = 0; a < 360; a += 40) {
      const rad = a * Math.PI / 180;
      for (let k = 0.2; k < 12; k += 0.1) {
        const x = cx + Math.cos(rad) * k, y = cy + Math.sin(rad) * k;
        if (dist(x, y) > r0 + band * 0.55) { this.fogMarks.push([x, y, a]); break; }
      }
    }
  }

  // ---------- 그리기 ----------
  render(now) {
    const theme = this.opts.theme || this.cv.closest?.('[data-theme]')?.dataset.theme || document.documentElement.dataset.theme || 'day';
    if (theme !== this.theme) { this.theme = theme; this.readVars(); this.terrain = null; this.fogKey = null; }
    const g = this.g, st = this.state, night = theme === 'night', s = this.cam.s, idx = this.idx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    const fogOn = !this.opts.noFog && !this.overview();
    g.fillStyle = fogOn ? this.css('--fog') : this.css('--t-land'); g.fillRect(0, 0, this.cv.width, this.cv.height);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // 1) 바닥: 확대가 바뀌면 잠시 늘려 그리고, 멈추면 다시 만든다
    if (!this.terrain) this.makeTerrain();
    else if (Math.abs(this.terrain.s - s) > 0.5) { clearTimeout(this.terrainT); this.terrainT = setTimeout(() => { this.terrain = null; }, 140); }
    const T = this.terrain, k = s / T.s, P = this.proj;
    const o = this.project(0, 0); // 평면 (0,0)의 화면 위치
    g.imageSmoothingEnabled = false;
    g.drawImage(T.c, Math.round(o.x + P.x0 * s), Math.round(o.y + P.y0 * s), Math.round(T.c.width * LOW * k), Math.round(T.c.height * LOW * k));

    const gu = st.myGu;
    const pos = new Map(this.tiles.map(c => [c.id, this.center(c)]));
    const tileA = parseFloat(this.css('--tile-a')) || 0.2;
    // 2) 칸 색칠과 테두리
    for (const c of this.tiles) {
      this.hexScreen(c);
      if (c.kind === 'river') { g.globalAlpha = 0.25; g.strokeStyle = this.css('--tile-line'); g.lineWidth = 1; g.stroke(); g.globalAlpha = 1; continue; }
      let fill, line = this.css('--tile-line'), a = tileA;
      if (c.gray) { fill = this.css('--tile-gray'); line = this.css('--tile-gray-line'); a = 0.75; }
      else if (!c.owner) fill = this.css('--tile-neutral');
      else if (c.owner === gu) { fill = this.css('--tile-ours'); a = tileA + 0.04; }
      else fill = this.css('--gu-' + c.owner);
      g.globalAlpha = a; g.fillStyle = fill; g.fill();
      g.globalAlpha = 0.95; g.strokeStyle = line; g.lineWidth = 2; g.stroke(); g.globalAlpha = 1;
    }
    // 밤: 우리 칸 위 호박색 빛 번짐
    if (night && gu) {
      const glow = this.css('--glow');
      for (const c of this.tiles) {
        if (c.owner !== gu) continue;
        const p = pos.get(c.id), rx = s * 0.55, ry = s * 0.32, fl = 0.85 + 0.15 * Math.sin(now / 400 + c.id);
        g.save(); g.translate(p.x, p.y); g.scale(1, ry / rx);
        const rg = g.createRadialGradient(0, 0, 0, 0, 0, rx);
        rg.addColorStop(0, `rgba(${glow}, ${0.7 * fl})`); rg.addColorStop(1, `rgba(${glow}, 0)`);
        g.fillStyle = rg; g.beginPath(); g.arc(0, 0, rx, 0, Math.PI * 2); g.fill(); g.restore();
      }
    }

    // 3) 세운 물체: 평면 x+y가 작은 것(화면 위쪽)부터
    const objs = [];
    const lmScale = Math.max(1, Math.round((this.pc ? 4 : 3) * s / this.sDefault));
    const spriteTiles = new Set((idx.sprites || []).map(sp => sp.tile));
    for (const sp of idx.sprites || []) {
      const im = IMG[sp.key]; if (!im) continue;
      const [x, y] = sp.at;
      objs.push({ d: x + y, draw: () => { const p = this.project(x, y); drawImageFoot(g, im, p.x, p.y, lmScale); } });
    }
    for (const c of this.tiles) {
      if (c.landmark && !spriteTiles.has(c.id)) objs.push({ d: c.x + c.y, draw: () => { // 그림 없는 랜드마크: 마름모 표시
        const p = pos.get(c.id), r = Math.max(4, s * 0.05);
        g.fillStyle = this.css('--t-ink'); g.beginPath(); g.moveTo(p.x, p.y - r * 2.4); g.lineTo(p.x + r, p.y - r * 1.4); g.lineTo(p.x, p.y - r * 0.4); g.lineTo(p.x - r, p.y - r * 1.4); g.fill();
      } });
      // 등불: 우리 칸에만 2~3칸에 하나꼴
      if (c.owner === gu && gu && ((c.q * 2 + c.r * 5) % 3 + 3) % 3 === 0 && !spriteTiles.has(c.id)) {
        const lx = c.x + idx.size * 0.35, ly = c.y - idx.size * 0.2;
        objs.push({ d: lx + ly, draw: () => { const p = this.project(lx, ly); drawSprite(g, 'lantern', p.x, p.y - 9, 2); } });
      }
      // 증원한 칸: 등롱지기 한 명
      if (st.reinforced.has(c.id)) {
        const ux = c.x - idx.size * 0.3, uy = c.y + idx.size * 0.25;
        objs.push({ d: ux + uy, draw: () => { const p = this.project(ux, uy); const im = IMG['lantern-ours']; if (im && s >= this.sDefault * 0.55) drawImageFoot(g, im, p.x, p.y + 6, 1); } });
      }
    }
    // 진군: 횃불꾼 2~4명이 줄지어 걷는다
    for (const m of st.marches || []) {
      const a = idx.byId.get(m.src), b = idx.byId.get(m.dst); if (!a || !b) continue;
      const ours = m.gu === gu, n = Math.min(4, Math.max(2, Math.ceil(m.troops / 25)));
      const t = marchProgress(m, now), pa = this.project(a.x, a.y), pb = this.project(b.x, b.y), flip = pb.x < pa.x;
      for (let i = 0; i < n; i++) {
        const tt = Math.max(0, t - i * 0.06), x = a.x + (b.x - a.x) * tt, y = a.y + (b.y - a.y) * tt;
        objs.push({ d: x + y, draw: () => {
          const p = this.project(x, y), bob = (Math.floor(now / 300) + i) % 2;
          const im = IMG[ours ? 'torch-ours' : 'torch-enemy'];
          if (im && s >= this.sDefault * 0.55) drawImageFoot(g, im, p.x + (flip ? 1 : -1) * i * 4, p.y + 4 - bob, s >= this.sDefault * 2 ? 2 : 1, flip);
          else drawSprite(g, bob ? 'walkA' : 'walkB', p.x, p.y - 8, 1, ours ? this.css('--ours') : this.css('--enemy'));
        } });
      }
    }
    // 진군선(바닥에 붙은 점선)은 물체보다 먼저
    for (const m of st.marches || []) {
      const a = pos.get(m.src), b = pos.get(m.dst); if (!a || !b) continue;
      g.setLineDash([8, 6]); g.lineDashOffset = -now / 50; g.lineWidth = 3;
      g.strokeStyle = m.gu === gu ? this.css('--pill-ours') : this.css('--pill-enemy');
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); g.setLineDash([]);
    }
    objs.sort((p, q) => p.d - q.d).forEach(o2 => o2.draw());

    // 4) 안개(둘러보기·안개 끄기면 없음)
    const fk = [Math.round(this.cam.x * 200), Math.round(this.cam.y * 200), Math.round(s * 10), this.inset, gu, this.w, this.hgt, theme,
      this.tiles.filter(c => c.owner === gu).length].join('|');
    if (fogOn && fk !== this.fogKey) { this.makeFog(); this.fogKey = fk; }
    if (fogOn) { g.imageSmoothingEnabled = false; g.drawImage(this.fogCanvas, 0, 0, this.fogCanvas.width * LOW, this.fogCanvas.height * LOW); }
    for (const [x, y, a] of fogOn ? this.fogMarks : []) {
      const p = this.project(x, y);
      if (night) this.eyes(p.x, p.y, now, a); else this.cloud(p.x, p.y, Math.max(10, Math.min(22, s * 0.12)));
    }

    // 5) 화면 요소: 공격받는 칸 붉은 점선, 침식 중인 칸 보라 점선, 고른 칸, 이름표, 알약
    for (const id of st.incomingIds) {
      const c = idx.byId.get(id); this.hexScreen(c, 0.86);
      g.setLineDash([10, 6]); g.lineDashOffset = -now / 80; g.strokeStyle = this.css('--attack'); g.lineWidth = 4; g.stroke(); g.setLineDash([]);
    }
    if (night) for (const id of st.erodingIds) {
      const c = idx.byId.get(id); this.hexScreen(c, 0.86);
      g.setLineDash([10, 6]); g.strokeStyle = this.css('--erode'); g.lineWidth = 3; g.stroke(); g.setLineDash([]);
    }
    if (st.selected) { const c = idx.byId.get(st.selected); if (c) { this.hexScreen(c, 0.95); g.strokeStyle = this.css('--fg'); g.lineWidth = 3; g.stroke(); } }
    if (this.drag?.mode === 'march') {
      const a = pos.get(this.drag.id), b = this.drag.last;
      g.strokeStyle = this.css('--ours'); g.lineWidth = 3; g.setLineDash([6, 4]);
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); g.setLineDash([]);
      if (this.drag.hover) { const c = idx.byId.get(this.drag.hover); this.hexScreen(c, 0.9); g.strokeStyle = this.css('--ours'); g.lineWidth = 4; g.stroke(); }
    }
    // 이름표: 중요한 것부터 그리고, 이미 그린 이름표와 겹치면 건너뛴다
    const bigEnough = this.hexW() >= 70 && !this.opts.guLabels;
    const fs = this.pc ? 16 : (this.hexW() >= 110 ? 15 : 13);
    const cands = [];
    for (const c of this.tiles) {
      if (c.kind === 'river') continue;
      const hot = st.selected === c.id || st.incomingIds.has(c.id);
      const pri = hot ? 0 : c.landmark ? 1 : (gu && c.owner === gu) ? 2 : 3;
      if (pri === 3 && !bigEnough) continue;
      const p = pos.get(c.id);
      if (p.x < -60 || p.x > this.w + 60 || p.y < -30 || p.y > this.hgt + 30) continue;
      cands.push({ c, p, pri });
    }
    cands.sort((a, b) => a.pri - b.pri || a.c.id - b.c.id);
    g.font = `700 ${fs}px "Gowun Dodum", sans-serif`;
    const placed = [];
    // 줄여 볼 때는 칸 이름 대신 구 이름표(구 이름 + 등불 칸 수)를 먼저
    if (!bigEnough) {
      const gfs = this.pc ? 18 : 15;
      g.font = `700 ${gfs}px "Gowun Batang", serif`;
      for (const gg of idx.gu.values()) {
        const own = this.tiles.filter(c => c.owner === gg.id); if (!own.length) continue;
        const x = own.reduce((a, c) => a + c.x, 0) / own.length, y = own.reduce((a, c) => a + c.y, 0) / own.length, p = this.project(x, y);
        const text = `${gg.name} ${own.length}`, w = Math.ceil(g.measureText(text).width) + 20, h = gfs + 14;
        let y0 = p.y; // 다른 구 이름표와 겹치면 아래로 비켜 놓는다
        for (let k = 0; k < 6 && placed.some(r => p.x - w / 2 < r.l + r.w + 3 && p.x + w / 2 + 3 > r.l && y0 - h / 2 < r.t + r.h + 3 && y0 + h / 2 + 3 > r.t); k++) y0 += h * 0.6;
        placed.push({ l: p.x - w / 2, t: y0 - h / 2, w, h });
        this.label(text, p.x, y0, gg.id === gu ? this.css('--ours-dark') : this.css('--gu-' + gg.id + '-dark'), gfs, 'serif');
      }
      g.font = `700 ${fs}px "Gowun Dodum", sans-serif`;
    }
    for (const { c, p } of cands) {
      const w = Math.ceil(g.measureText(c.name).width) + 16, h = fs + 12, l = p.x - w / 2, t = p.y + 18 - h / 2;
      if (placed.some(r => l < r.l + r.w + 3 && l + w + 3 > r.l && t < r.t + r.h + 3 && t + h + 3 > r.t)) continue;
      placed.push({ l, t, w, h });
      const border = c.gray ? this.css('--tile-gray-line') : (!c.owner || c.owner === gu) ? this.css('--ours-dark') : this.css('--gu-' + c.owner + '-dark');
      this.label(c.name, p.x, p.y + 18, border, fs);
    }
    for (const m of st.marches || []) {
      const ours = m.gu === gu, toUs = gu && idx.byId.get(m.dst)?.owner === gu;
      if (!ours && !toUs) continue;
      const a = pos.get(m.src), b = pos.get(m.dst), left = fmtLeft(Date.parse(m.arrive_at) - now);
      const name = idx.byId.get(m.dst).name.replace(/·.*/, '');
      this.pill(ours ? `→ ${name} ${left}` : `${name} ${left}`, (a.x + b.x) / 2, (a.y + b.y) / 2 - 34, ours ? this.css('--pill-ours') : this.css('--pill-enemy'));
    }
  }

  label(text, x, y, border, fs, face) {
    const g = this.g;
    g.font = face === 'serif' ? `700 ${fs}px "Gowun Batang", serif` : `700 ${fs}px "Gowun Dodum", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    const w = Math.ceil(g.measureText(text).width) + 16, h = fs + 12, l = Math.round(x - w / 2), t = Math.round(y - h / 2);
    g.fillStyle = this.css('--label-shadow'); g.fillRect(l + 3, t + 3, w, h);
    g.fillStyle = border; g.fillRect(l, t, w, h);
    g.fillStyle = this.css('--label-bg'); g.fillRect(l + 3, t + 3, w - 6, h - 6);
    g.fillStyle = this.css('--label-fg'); g.fillText(text, x, t + h / 2 + 1);
  }
  pill(text, x, y, bg) {
    const g = this.g, fs = 15;
    g.font = `700 ${fs}px "Gowun Dodum", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    const w = Math.ceil(g.measureText(text).width) + 24, h = 28, l = Math.round(x - w / 2), t = Math.round(y - h / 2);
    g.fillStyle = this.css('--label-shadow'); g.fillRect(l + 3, t + 3, w, h);
    g.fillStyle = bg; g.fillRect(l, t, w, h);
    g.fillStyle = this.css('--pill-fg'); g.fillText(text, x, t + h / 2 + 1);
  }
  cloud(x, y, r) { // 민화 구름문: 세 덩이 원 + 갈색 소용돌이
    const g = this.g;
    g.fillStyle = this.css('--cloud-fill'); g.strokeStyle = this.css('--cloud-line'); g.lineWidth = 2.5;
    for (const [dx, dy, rr] of [[-r * 1.1, 0, r * 0.8], [0, -r * 0.25, r], [r * 1.1, 0, r * 0.8]]) {
      g.beginPath(); g.arc(x + dx, y + dy, rr, 0, Math.PI * 2); g.fill();
    }
    for (const [dx, rr] of [[-r * 1.1, r * 0.5], [0, r * 0.62], [r * 1.1, r * 0.5]]) {
      g.beginPath(); g.arc(x + dx, y, rr, Math.PI * 0.9, Math.PI * 2.4); g.stroke();
      g.beginPath(); g.arc(x + dx + rr * 0.25, y, rr * 0.45, Math.PI * 1.2, Math.PI * 2.3); g.stroke();
    }
  }
  eyes(x, y, now, seed) { // 어둑시니 눈: 청록 점 두 개, 가끔 깜빡
    if ((Math.floor(now / 120) + seed) % 47 === 0) return;
    const g = this.g; g.fillStyle = this.css('--eyes');
    const sz = 4;
    g.fillRect(Math.round(x - 7), Math.round(y), sz, sz); g.fillRect(Math.round(x + 3), Math.round(y), sz, sz);
  }
}
