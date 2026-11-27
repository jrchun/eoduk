// 지도 그리기(Canvas 2D) — 서울 전역 쿼터뷰.
// 평면 좌표(km, map.json의 x·y)를 X = (x - y)·0.6, Y = (x + y)·0.3 으로 투영한다.
// 보이는 순서(먼저 읽혀야 할 것부터): 서울 모양 → 구(이름) → 점령 상태(색·경계) → 움직임(진군·경고) → 칸 이름(확대했을 때만)
// 그리는 순서: 바탕 → 칸 색 → 한강(벡터) → 경계선 → 유닛 → 안개 → 경고 테두리·이름·알약
// 색은 styles.css의 CSS 변수(--t-*, --tile-*, --gu-*, --sealed*, --label-*, --pill-*, --fog*)에서 읽는다.
import { pixelToHex, key, hexDistance, fmtLeft, DIRS } from './rules.js';
import { marchProgress } from './view.js';
import { drawSprite, IMG, drawImageFoot } from './sprites.js';

const KX = 0.6, KY = 0.3, LOW = 4;
const CORNER = [...Array(6)].map((_, i) => { const a = Math.PI / 180 * (60 * i - 30); return [Math.cos(a), Math.sin(a)]; });
// 이웃 방향(rules.js DIRS 순서) → 그 쪽 변의 꼭짓점 번호
const EDGE_OF_DIR = { '1,0': [0, 1], '-1,0': [3, 4], '0,1': [1, 2], '0,-1': [4, 5], '1,-1': [5, 0], '-1,1': [2, 3] };
const VARS = ['--t-land', '--t-river', '--t-river-edge', '--t-wave', '--t-park', '--t-ink', '--t-bridge', '--t-bam', '--t-paper',
  '--tile-line', '--tile-a', '--tile-ours', '--tile-dark', '--tile-gray', '--tile-gray-line', '--tile-neutral', '--sealed', '--sealed-line', '--outline',
  '--ours-dark', '--attack', '--erode', '--label-bg', '--label-fg', '--label-muted', '--label-shadow', '--pill-enemy', '--pill-ours', '--pill-fg',
  '--fog', '--fog-a', '--cloud-line', '--cloud-fill', '--eyes', '--glow', '--fg', '--ours', '--enemy'];

// 색 a를 바탕색 b와 비율 t로 섞은 불투명 색(반투명 칸이 겹쳐 생기는 진한 이음매를 없앤다)
function mix(a, b, t) { const x = hex2rgb(a), y = hex2rgb(b); return `rgb(${x.map((v, i) => Math.round(v * t + y[i] * (1 - t))).join(',')})`; }
function hex2rgb(h) { const m = /^#?([0-9a-f]{6})$/i.exec((h || '').trim()); const n = m ? parseInt(m[1], 16) : 0; return [n >> 16, (n >> 8) & 255, n & 255]; }

export class MapView {
  // opts: interactive(입력, 기본 true), size({w,h}: 화면 밖 장면용 고정 크기), pc, noFog, guLabels(칸 이름 대신 구 이름만), zoom, dpr, theme
  // 온보딩 장면·공유 카드도 이 클래스로 그린다(실제 게임과 같은 그림).
  constructor(canvas, idx, handlers = {}, opts = {}) {
    this.opts = opts; this.cv = canvas; this.g = canvas.getContext('2d'); this.idx = idx; this.h = handlers;
    this.tiles = [...idx.byId.values()];
    this.open = this.tiles.filter(c => !c.sealed);
    this.state = { marches: [], myGu: null, selected: null, flags: [], phase: null, incomingIds: new Set(), erodingIds: new Set(), reinforced: new Set(), canMarch: false, mySide: null, visible: null };
    this.cam = { x: 0, y: 0, s: 120 }; this.inset = 0; this.drag = null; this.pointers = new Map(); this.homed = null;
    const m = idx.size, xs = this.tiles.map(c => c.x), ys = this.tiles.map(c => c.y);
    this.plane = { x0: Math.min(...xs) - m, x1: Math.max(...xs) + m, y0: Math.min(...ys) - m, y1: Math.max(...ys) + m };
    // 투영된 지도 범위(칸 꼭짓점 기준): 전체 보기 배율과 정가운데 계산에 쓴다
    const px = [], py = [];
    for (const c of this.tiles) for (const [cx, cy] of CORNER) { const x = c.x + cx * m, y = c.y + cy * m; px.push(KX * (x - y)); py.push(KY * (x + y)); }
    this.proj = { x0: Math.min(...px), x1: Math.max(...px), y0: Math.min(...py), y1: Math.max(...py) };
    this.river = smooth(idx.river || []);
    this.saet = smooth(idx.saetgang || []); // 여의도 남쪽 샛강
    if (opts.interactive !== false) this.bindInput();
    if (!opts.size) new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  css(n) { return this.vars[n] || '#888'; }
  readVars() {
    const cs = getComputedStyle(this.cv); this.vars = {};
    for (const n of VARS) this.vars[n] = cs.getPropertyValue(n).trim();
    for (const g of this.idx.gu.values()) { this.vars['--gu-' + g.id] = cs.getPropertyValue('--gu-' + g.id).trim(); this.vars['--gu-' + g.id + '-dark'] = cs.getPropertyValue('--gu-' + g.id + '-dark').trim(); }
    this.paper = null;
  }

  resize() {
    const r = this.opts.size ? { width: this.opts.size.w, height: this.opts.size.h } : this.cv.getBoundingClientRect();
    const dpr = this.opts.dpr || Math.min(3, window.devicePixelRatio || 1);
    this.w = r.width; this.hgt = r.height; this.dpr = dpr;
    this.cv.width = Math.max(1, Math.round(r.width * dpr)); this.cv.height = Math.max(1, Math.round(r.height * dpr));
    this.pc = this.opts.pc ?? window.innerWidth >= 1024;
    this.sDefault = Math.min(this.pc ? 200 : 130, Math.max(84, r.width / (this.pc ? 5.2 : 4))) * (this.opts.zoom || 1);
    const P = this.proj;
    this.sFit = Math.max(6, Math.min((r.width - 20) / (P.x1 - P.x0), (r.height - 44) / (P.y1 - P.y0)));
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
  hexW() { return this.cam.s * this.idx.size * 1.9; }
  set(partial) {
    Object.assign(this.state, partial);
    const focus = partial.myGu !== undefined ? (partial.myGu || 'browse') : null;
    if (focus && focus !== this.homed) this.home();
  }

  overview() { return !this.state.myGu; }
  // 칸 묶음의 투영 범위 정가운데를 화면 가운데에, 화면을 채우는 배율로
  fitTiles(list) {
    const m = this.idx.size, px = [], py = [];
    for (const c of list) for (const [cx, cy] of CORNER) { const x = c.x + cx * m, y = c.y + cy * m; px.push(KX * (x - y)); py.push(KY * (x + y)); }
    const x0 = Math.min(...px), x1 = Math.max(...px), y0 = Math.min(...py), y1 = Math.max(...py);
    const a = (x0 + x1) / 2 / KX, b = (y0 + y1) / 2 / KY;
    this.cam.x = (a + b) / 2; this.cam.y = (b - a) / 2;
    this.cam.s = Math.min((this.w - 24) / (x1 - x0), (this.hgt - this.inset - 56) / (y1 - y0));
    this.clamp();
  }
  // 서울 전체 보기
  fitAll() { this.fitTiles(this.tiles); this.cam.s = this.sFit; this.view = 'all'; }
  // 시범 전선(열린 구) 보기
  fitOpen() { this.fitTiles(this.open.filter(c => c.kind !== 'river')); this.view = 'open'; }
  focusTiles() {
    const gu = this.state.myGu;
    const mine = gu ? this.tiles.filter(c => c.owner === gu) : [];
    if (mine.length) return mine;
    return this.open.filter(c => c.kind === 'land');
  }
  // 둘러보는 중: 서울 전체 / 우리 구가 있으면: 우리 전선을 크게
  home() {
    this.homed = this.state.myGu || 'browse';
    if (this.overview()) { this.fitOpen(); return; } // 처음엔 시범 6개 구가 화면을 채우게
    const ts = this.focusTiles();
    const front = ts.filter(c => c.adj.some(n => { const o = this.idx.byId.get(n); return o.kind !== 'river' && !o.sealed && o.owner !== c.owner; }));
    const pick = front.length ? front : ts;
    this.cam.x = pick.reduce((a, c) => a + c.x, 0) / pick.length;
    this.cam.y = pick.reduce((a, c) => a + c.y, 0) / pick.length;
    this.cam.s = this.sDefault || 150;
    this.clamp();
  }
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
  setZoom(s) { this.cam.s = Math.min(this.sDefault * 1.8, Math.max(this.sFit, s)); this.view = null; this.clamp(); }
  zoomBy(f) { this.setZoom(this.cam.s * f); }
  clamp() {
    const P = this.plane;
    this.cam.x = Math.max(P.x0, Math.min(P.x1, this.cam.x)); this.cam.y = Math.max(P.y0, Math.min(P.y1, this.cam.y));
    this.cam.s = Math.min(this.sDefault * 1.8, Math.max(this.sFit || 6, this.cam.s));
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
    cv.addEventListener('dblclick', () => { if (this.cam.s > this.sDefault * 1.2) this.home(); else this.zoomBy(1.6); });
  }

  // ---------- 그리기 도우미 ----------
  hexScreen(c, shrink = 1) {
    const g = this.g, r = this.idx.size * shrink;
    g.beginPath();
    CORNER.forEach(([cx, cy], i) => { const p = this.project(c.x + cx * r, c.y + cy * r); i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); });
    g.closePath();
  }
  edge(c, dq, dr) { // 칸 c의 (dq,dr) 쪽 변(화면 좌표)
    const [i, j] = EDGE_OF_DIR[dq + ',' + dr], r = this.idx.size;
    return [this.project(c.x + CORNER[i][0] * r, c.y + CORNER[i][1] * r), this.project(c.x + CORNER[j][0] * r, c.y + CORNER[j][1] * r)];
  }
  planeTransform() { // 평면 좌표로 바로 그리기(한강 등)
    const s = this.cam.s, o = this.project(0, 0);
    this.g.setTransform(this.dpr * KX * s, this.dpr * KY * s, -this.dpr * KX * s, this.dpr * KY * s, this.dpr * o.x, this.dpr * o.y);
  }
  makePaper() { // 아주 옅은 종이 결(작은 무늬를 반복)
    const c = document.createElement('canvas'); c.width = c.height = 96;
    const g = c.getContext('2d'); g.fillStyle = this.css('--t-paper');
    let s = 7; const R = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 140; i++) g.fillRect(Math.floor(R() * 96), Math.floor(R() * 96), 1, 1);
    this.paper = this.g.createPattern(c, 'repeat');
  }

  // ---------- 안개(로그인한 사람만): 시야(우리 연합 등불 칸 + 2칸 + sight 효과) 밖을 부드럽게 ----------
  makeFog() {
    const W = Math.ceil(this.w / LOW), H = Math.ceil(this.hgt / LOW);
    const vis = this.state.visible;
    const centers = vis ? [...vis].map(id => this.idx.byId.get(id)).filter(Boolean).map(c => [c.x, c.y])
      : this.tiles.filter(c => c.owner === this.state.myGu).map(c => [c.x, c.y]);
    const r0 = this.idx.size * 0.9, band = this.idx.size * 1.8;
    const c = this.fogCanvas && this.fogCanvas.width === W && this.fogCanvas.height === H ? this.fogCanvas : Object.assign(document.createElement('canvas'), { width: W, height: H });
    const g = c.getContext('2d'), img = g.createImageData(W, H), d = img.data;
    const [fr, fg, fb] = hex2rgb(this.css('--fog')), fa = (parseFloat(this.css('--fog-a')) || 0.9) * 255;
    const dist = (x, y) => { let m = 1e9; for (const [cx, cy] of centers) { const dd = (cx - x) * (cx - x) + (cy - y) * (cy - y); if (dd < m) m = dd; } return Math.sqrt(m); };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = this.unproject(x * LOW + 2, y * LOW + 2);
      const t = centers.length ? Math.min(1, Math.max(0, (dist(p.x, p.y) - r0) / band)) : 0;
      const i = (y * W + x) * 4; d[i] = fr; d[i + 1] = fg; d[i + 2] = fb; d[i + 3] = Math.round(fa * t * t * (3 - 2 * t));
    }
    g.putImageData(img, 0, 0);
    this.fogCanvas = c;
    this.fogMarks = [];
    if (!centers.length) return;
    const cx = centers.reduce((a, p) => a + p[0], 0) / centers.length, cy = centers.reduce((a, p) => a + p[1], 0) / centers.length;
    for (let a = 0; a < 360; a += 45) {
      const rad = a * Math.PI / 180;
      for (let k = 0.2; k < 20; k += 0.1) { const x = cx + Math.cos(rad) * k, y = cy + Math.sin(rad) * k; if (dist(x, y) > r0 + band * 0.6) { this.fogMarks.push([x, y, a]); break; } }
    }
  }

  // ---------- 그리기 ----------
  render(now) {
    const theme = this.opts.theme || this.cv.closest?.('[data-theme]')?.dataset.theme || document.documentElement.dataset.theme || 'day';
    if (theme !== this.theme) { this.theme = theme; this.readVars(); this.fogKey = null; }
    if (!this.paper) this.makePaper();
    const g = this.g, st = this.state, night = theme === 'night', s = this.cam.s, idx = this.idx, gu = st.myGu;
    const fogOn = !this.opts.noFog && !this.overview();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = this.css('--t-land'); g.fillRect(0, 0, this.cv.width, this.cv.height);
    g.fillStyle = this.paper; g.fillRect(0, 0, this.cv.width, this.cv.height);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const pos = new Map(this.tiles.map(c => [c.id, this.center(c)]));
    const visible = c => { const p = pos.get(c.id); return p.x > -80 && p.x < this.w + 80 && p.y > -60 && p.y < this.hgt + 60; };
    const tileA = parseFloat(this.css('--tile-a')) || 0.2, land = this.css('--t-land');
    if (this.mixKey !== theme + gu) { this.mixKey = theme + gu; this.mixed = {}; }
    const col = (k, base, a) => (this.mixed[k] ||= mix(base, land, a));

    // 1) 칸 색: 봉인된 땅은 옅은 회색, 열린 칸은 주인 색(우리 구는 호박색). 바탕과 섞은 불투명 색
    for (const c of this.tiles) {
      if (c.kind === 'river' || !visible(c)) continue;
      this.hexScreen(c, 1.02);
      if (c.sealed) g.fillStyle = this.css('--sealed');
      else if (c.gray) g.fillStyle = col('gray', this.css('--tile-gray'), 0.8);
      else if (!c.owner) g.fillStyle = this.css('--tile-dark'); // 어둠(미개척)
      else if (c.owner === gu) g.fillStyle = col('ours', this.css('--tile-ours'), tileA + 0.22);
      else g.fillStyle = col(c.owner, this.css('--gu-' + c.owner), tileA + 0.1);
      g.fill();
    }

    // 2) 한강: 매끈한 벡터 띠(물가선 → 강변 공원 → 물 → 잔물결)
    if (this.river.length > 1) {
      this.planeTransform();
      const path = () => { g.beginPath(); g.moveTo(this.river[0][0], this.river[0][1]); for (let i = 1; i < this.river.length; i++) g.lineTo(this.river[i][0], this.river[i][1]); };
      const W = 0.9, px = 1 / (s * 0.42);
      g.lineCap = 'round'; g.lineJoin = 'round';
      const saet = (w, col) => { if (this.saet.length < 2) return; g.beginPath(); g.moveTo(this.saet[0][0], this.saet[0][1]); for (let i = 1; i < this.saet.length; i++) g.lineTo(this.saet[i][0], this.saet[i][1]); g.lineWidth = w; g.strokeStyle = col; g.stroke(); };
      g.lineCap = 'round'; g.lineJoin = 'round';
      saet(0.62, this.css('--t-park')); saet(0.4 + 2.2 * px, this.css('--t-river-edge')); saet(0.4, this.css('--t-river'));
      path(); g.lineWidth = W + 0.3; g.strokeStyle = this.css('--t-park'); g.stroke();
      path(); g.lineWidth = W + 2.2 * px; g.strokeStyle = this.css('--t-river-edge'); g.stroke();
      path(); g.lineWidth = W; g.strokeStyle = this.css('--t-river'); g.stroke();
      path(); g.lineWidth = Math.max(px, 0.02); g.strokeStyle = this.css('--t-wave'); g.setLineDash([0.18, 0.32]); g.lineDashOffset = -now / 4000; g.globalAlpha = 0.55; g.stroke();
      g.globalAlpha = 1; g.setLineDash([]);
      if (idx.bamseom) { const [bx, by] = idx.bamseom; g.beginPath(); g.ellipse(bx, by, 0.3, 0.1, -0.25, 0, Math.PI * 2); g.fillStyle = this.css('--t-bam'); g.fill(); }
      for (const b of idx.bridges || []) { // 다리
        const [ax, ay] = b.at, line = b.saet && this.saet.length > 1 ? this.saet : this.river;
        const n = normalAt(line, ax, ay), half = (b.saet ? 0.2 : W / 2) + 0.18;
        g.beginPath(); g.moveTo(ax - n[0] * half, ay - n[1] * half); g.lineTo(ax + n[0] * half, ay + n[1] * half);
        g.lineCap = 'butt'; g.lineWidth = 0.09; g.strokeStyle = this.css('--t-ink'); g.globalAlpha = 0.5; g.stroke();
        g.lineWidth = 0.06; g.strokeStyle = this.css('--t-bridge'); g.globalAlpha = 1; g.stroke();
      }
      g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    // 3) 경계선: 점령 경계만 또렷하게, 같은 구 안은 아주 옅게, 서울 바깥선, 봉인된 구 사이 점선
    const thin = [], strong = [], outer = [], sealedLine = [];
    for (const c of this.tiles) {
      if (c.kind === 'river' || !visible(c)) continue;
      for (const [dq, dr] of DIRS) {
        const n = idx.byKey.get(key(c.q + dq, c.r + dr));
        if (!n) { outer.push(this.edge(c, dq, dr)); continue; }
        if (n.kind === 'river') continue;
        if (n.id < c.id && visible(n)) continue; // 같은 변을 두 번 그리지 않는다
        if (c.sealed && n.sealed) { if (c.home !== n.home) sealedLine.push(this.edge(c, dq, dr)); continue; }
        if (c.sealed !== n.sealed) { strong.push(this.edge(c, dq, dr)); continue; }
        if (n.owner !== c.owner || n.gray !== c.gray) strong.push(this.edge(c, dq, dr)); else thin.push(this.edge(c, dq, dr));
      }
    }
    const stroke = (list, col, w, a = 1, dash) => {
      if (!list.length) return;
      g.beginPath(); for (const [p, q] of list) { g.moveTo(p.x, p.y); g.lineTo(q.x, q.y); }
      g.strokeStyle = col; g.lineWidth = w; g.globalAlpha = a; g.setLineDash(dash || []); g.stroke(); g.globalAlpha = 1; g.setLineDash([]);
    };
    const zoomed = this.hexW() >= 40;
    if (zoomed) stroke(thin, this.css('--tile-line'), 1, 0.16);
    stroke(sealedLine, this.css('--sealed-line'), 1, 0.9, [3, 3]);
    stroke(strong, this.css('--tile-line'), zoomed ? 1.6 : 1.1, 0.75);
    stroke(outer, this.css('--outline'), 1.6, 0.8);

    // 밤: 우리 칸 위 호박색 빛 번짐
    if (night && gu) {
      const glow = this.css('--glow');
      for (const c of this.tiles) {
        if (c.owner !== gu || !visible(c)) continue;
        const p = pos.get(c.id), rx = s * 0.55, ry = s * 0.32, fl = 0.85 + 0.15 * Math.sin(now / 400 + c.id);
        g.save(); g.translate(p.x, p.y); g.scale(1, ry / rx);
        const rg = g.createRadialGradient(0, 0, 0, 0, 0, rx);
        rg.addColorStop(0, `rgba(${glow}, ${0.55 * fl})`); rg.addColorStop(1, `rgba(${glow}, 0)`);
        g.fillStyle = rg; g.beginPath(); g.arc(0, 0, rx, 0, Math.PI * 2); g.fill(); g.restore();
      }
    }

    // 4) 진군선과 유닛(깊이 순), 증원한 칸의 등롱지기, 구청 등불
    const friend = m => (st.mySide ? idx.gu.get(m.gu)?.side === st.mySide : m.gu === gu);
    const seen = m => !fogOn || !st.visible || st.visible.has(m.src) || st.visible.has(m.dst); // 출발·도착 중 하나라도 보이면
    const marches = (st.marches || []).filter(seen);
    for (const m of marches) {
      const a = pos.get(m.src), b = pos.get(m.dst); if (!a || !b) continue;
      g.setLineDash(m.kind === 'settle' ? [3, 6] : [8, 6]); g.lineDashOffset = -now / 50; g.lineWidth = 2.5;
      g.strokeStyle = friend(m) ? this.css('--pill-ours') : this.css('--pill-enemy');
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); g.setLineDash([]);
    }
    const objs = [], big = s >= this.sDefault * 0.55;
    for (const id of st.reinforced) {
      const c = idx.byId.get(id); if (!c) continue;
      const ux = c.x - idx.size * 0.3, uy = c.y + idx.size * 0.25;
      objs.push({ d: ux + uy, draw: () => { const p = this.project(ux, uy), im = IMG['lantern-ours']; if (im && big) drawImageFoot(g, im, p.x, p.y + 6, 1); } });
    }
    for (const c of this.open) { // 구청: 꺼지지 않는 시작 등불
      if (!c.hall || !visible(c)) continue;
      objs.push({ d: c.x + c.y, draw: () => { const p = pos.get(c.id); drawSprite(g, 'lantern', p.x, p.y - 4, s >= this.sDefault * 0.6 ? 3 : s >= this.sDefault * 0.25 ? 2 : 1); } });
    }
    for (const m of marches) {
      const a = idx.byId.get(m.src), b = idx.byId.get(m.dst); if (!a || !b) continue;
      const ours = friend(m), n = m.npc ? 1 : Math.min(4, Math.max(2, Math.ceil(m.troops / 25)));
      const t = marchProgress(m, now), flip = this.project(b.x, b.y).x < this.project(a.x, a.y).x;
      for (let i = 0; i < n; i++) {
        const tt = Math.max(0, t - i * 0.06), x = a.x + (b.x - a.x) * tt, y = a.y + (b.y - a.y) * tt;
        objs.push({ d: x + y, draw: () => {
          const p = this.project(x, y), bob = (Math.floor(now / 300) + i) % 2, im = IMG[(m.npc ? 'fire-' : 'torch-') + (ours ? 'ours' : 'enemy')]; // 정령은 도깨비불
          if (im && big) drawImageFoot(g, im, p.x + (flip ? 1 : -1) * i * 4, p.y + 4 - bob, 1, flip);
          else drawSprite(g, bob ? 'walkA' : 'walkB', p.x, p.y - 6, 1, ours ? this.css('--ours') : this.css('--enemy'));
        } });
      }
    }
    objs.sort((p, q) => p.d - q.d).forEach(o => o.draw());

    // 5) 안개
    if (fogOn) {
      const fk = [Math.round(this.cam.x * 200), Math.round(this.cam.y * 200), Math.round(s * 10), this.inset, gu, this.w, this.hgt, theme, st.visible ? st.visible.size : this.tiles.filter(c => c.owner === gu).length].join('|');
      if (fk !== this.fogKey) { this.makeFog(); this.fogKey = fk; }
      g.imageSmoothingEnabled = true;
      g.drawImage(this.fogCanvas, 0, 0, this.fogCanvas.width * LOW, this.fogCanvas.height * LOW);
      for (const [x, y, a] of this.fogMarks) { const p = this.project(x, y); if (night) this.eyes(p.x, p.y, now, a); else this.cloud(p.x, p.y, Math.max(8, Math.min(16, s * 0.1))); }
    }

    // 6) 경고 테두리, 고른 칸, 끌어서 진군
    for (const id of st.incomingIds) {
      const c = idx.byId.get(id); this.hexScreen(c, 0.86);
      g.setLineDash([10, 6]); g.lineDashOffset = -now / 80; g.strokeStyle = this.css('--attack'); g.lineWidth = 3.5; g.stroke(); g.setLineDash([]);
    }
    if (night) for (const id of st.erodingIds) {
      const c = idx.byId.get(id); if (!c || !visible(c)) continue; this.hexScreen(c, 0.86);
      g.setLineDash([8, 6]); g.strokeStyle = this.css('--erode'); g.lineWidth = 2; g.globalAlpha = 0.85; g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
    }
    if (st.selected) { const c = idx.byId.get(st.selected); if (c) { this.hexScreen(c, 0.95); g.strokeStyle = this.css('--fg'); g.lineWidth = 2.5; g.stroke(); } }
    if (this.drag?.mode === 'march') {
      const a = pos.get(this.drag.id), b = this.drag.last;
      g.strokeStyle = this.css('--ours'); g.lineWidth = 3; g.setLineDash([6, 4]);
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); g.setLineDash([]);
      if (this.drag.hover) { const c = idx.byId.get(this.drag.hover); this.hexScreen(c, 0.9); g.strokeStyle = this.css('--ours'); g.lineWidth = 3; g.stroke(); }
    }

    // 7) 이름: 구 이름(글자만)이 기본, 칸 이름은 크게 확대했거나 고른 칸·공격받는 칸만
    const placed = [];
    const tileNames = this.hexW() >= 130 && !this.opts.guLabels;
    const hot = new Set([st.selected, ...st.incomingIds].filter(Boolean));
    for (const id of hot) { const c = idx.byId.get(id); if (c) this.text(c.name, pos.get(c.id).x, pos.get(c.id).y + 16, 13, false, placed, true); }
    const guFs = this.pc ? 16 : 14;
    for (const gg of idx.gu.values()) {
      if (tileNames && gg.open) continue; // 크게 볼 때 열린 구는 칸 이름으로
      const own = gg.open ? this.tiles.filter(c => !c.sealed && c.owner === gg.id) : this.tiles.filter(c => c.sealed && c.home === gg.id && c.kind !== 'river');
      if (!own.length) continue;
      const x = own.reduce((a, c) => a + c.x, 0) / own.length, y = own.reduce((a, c) => a + c.y, 0) / own.length, p = this.project(x, y);
      if (p.x < -60 || p.x > this.w + 60 || p.y < -20 || p.y > this.hgt + 20) continue;
      const small = this.hexW() < 30; // 서울 전체를 볼 때는 작게
      this.text(gg.open ? `${gg.name} ${own.length}` : gg.name, p.x, p.y, gg.open ? (small ? 12 : guFs) : (small ? 10 : guFs - 3), !gg.open, placed, gg.open, gg.open);
    }
    if (tileNames) for (const c of this.tiles) {
      if (c.kind === 'river' || c.sealed || hot.has(c.id) || !visible(c)) continue;
      const p = pos.get(c.id);
      this.text(c.name, p.x, p.y, 12, false, placed, false);
    }
    // 진군 카운트다운 알약(우리 진군, 우리 칸으로 오는 진군)
    for (const m of marches) {
      const ours = friend(m), dst = idx.byId.get(m.dst), toUs = st.mySide && dst?.owner && idx.gu.get(dst.owner)?.side === st.mySide;
      if (!ours && !toUs) continue;
      const a = pos.get(m.src), b = pos.get(m.dst), left = fmtLeft(Date.parse(m.arrive_at) - now);
      const name = dst.name.replace(/·.*/, ''), who = m.npc ? '정령 ' : '';
      const label = ours ? (m.kind === 'settle' ? `${who}개척 ${name} ${left}` : `${who}→ ${name} ${left}`) : `${who}${name} ${left}`;
      this.pill(label, (a.x + b.x) / 2, (a.y + b.y) / 2 - 30, ours ? this.css('--pill-ours') : this.css('--pill-enemy'));
    }
  }

  // 상자 없는 글자 이름(가장자리 번짐으로 읽히게). 겹치면 건너뛴다.
  // nudge: 겹치면 위아래로 비켜서라도 그린다(열린 구 이름)
  text(t, x, y, fs, muted, placed, bold, nudge = false) {
    const g = this.g;
    g.font = `${bold ? 700 : 400} ${fs}px ${bold ? '"Gowun Batang", serif' : '"Gowun Dodum", sans-serif'}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const w = g.measureText(t).width + 6, h = fs + 4, l = x - w / 2;
    const hit = tp => placed.some(r => l < r.l + r.w + 2 && l + w + 2 > r.l && tp < r.t + r.h + 2 && tp + h + 2 > r.t);
    let tp = y - h / 2;
    if (hit(tp)) {
      if (!nudge) return;
      const tries = [h, -h, 2 * h, -2 * h].map(d => y - h / 2 + d).filter(v => !hit(v));
      if (!tries.length) return;
      tp = tries[0]; y = tp + h / 2;
    }
    placed.push({ l, t: tp, w, h });
    g.lineJoin = 'round'; g.lineWidth = 3.5; g.strokeStyle = this.css('--label-bg'); g.strokeText(t, x, y);
    g.fillStyle = muted ? this.css('--label-muted') : this.css('--label-fg'); g.fillText(t, x, y);
  }
  pill(text, x, y, bg) {
    const g = this.g, fs = 14;
    g.font = `700 ${fs}px "Gowun Dodum", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    const w = Math.ceil(g.measureText(text).width) + 20, h = 26, l = Math.round(x - w / 2), t = Math.round(y - h / 2);
    g.fillStyle = this.css('--label-shadow'); g.fillRect(l + 2, t + 2, w, h);
    g.fillStyle = bg; g.fillRect(l, t, w, h);
    g.fillStyle = this.css('--pill-fg'); g.fillText(text, x, t + h / 2 + 1);
  }
  cloud(x, y, r) {
    const g = this.g;
    g.fillStyle = this.css('--cloud-fill'); g.strokeStyle = this.css('--cloud-line'); g.lineWidth = 1.5; g.globalAlpha = 0.85;
    for (const [dx, dy, rr] of [[-r * 1.1, 0, r * 0.8], [0, -r * 0.25, r], [r * 1.1, 0, r * 0.8]]) { g.beginPath(); g.arc(x + dx, y + dy, rr, 0, Math.PI * 2); g.fill(); }
    for (const [dx, rr] of [[-r * 1.1, r * 0.5], [0, r * 0.62], [r * 1.1, r * 0.5]]) { g.beginPath(); g.arc(x + dx, y, rr, Math.PI * 0.9, Math.PI * 2.4); g.stroke(); }
    g.globalAlpha = 1;
  }
  eyes(x, y, now, seed) {
    if ((Math.floor(now / 120) + seed) % 47 === 0) return;
    const g = this.g; g.fillStyle = this.css('--eyes');
    g.beginPath(); g.arc(x - 5, y, 2.2, 0, Math.PI * 2); g.arc(x + 5, y, 2.2, 0, Math.PI * 2); g.fill();
  }
}

// 꺾은선 중심선을 부드러운 곡선 점들로(Catmull-Rom)
function smooth(pts, steps = 8) {
  if (pts.length < 3) return pts;
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < steps; k++) {
      const t = k / steps, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map(j => 0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)));
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
// 강 위 한 점에서 강을 가로지르는 방향(단위 벡터)
function normalAt(line, x, y) {
  let best = 1, bd = 1e9;
  for (let i = 1; i < line.length; i++) { const d = Math.hypot((line[i][0] + line[i - 1][0]) / 2 - x, (line[i][1] + line[i - 1][1]) / 2 - y); if (d < bd) { bd = d; best = i; } }
  let dx = line[best][0] - line[best - 1][0], dy = line[best][1] - line[best - 1][1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
  return [-dy, dx];
}
