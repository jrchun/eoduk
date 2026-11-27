// 지도 그리기(Canvas 2D). 바닥 헥스는 벡터, 등불·유닛·눈은 도트(정수 배율).
// 색은 styles.css의 CSS 변수(--map-*, --gu-*, --ours, --enemy)에서 읽는다.
import { hexToPixel, pixelToHex, key, DIRS } from './rules.js';
import { marchProgress } from './view.js';
import { drawSprite } from './sprites.js';

const SQ3 = Math.sqrt(3);
// 뾰족한 위 헥스의 꼭짓점(각도 -30°부터 시계 방향, y는 아래로)
const CORNER = [...Array(6)].map((_, i) => { const a = Math.PI / 180 * (60 * i - 30); return [Math.cos(a), Math.sin(a)]; });
// 이웃 방향(rules.js DIRS 순서) → 그 쪽 변의 꼭짓점 번호
const EDGE_OF_DIR = { '1,0': [0, 1], '-1,0': [3, 4], '0,1': [1, 2], '0,-1': [4, 5], '1,-1': [5, 0], '-1,1': [2, 3] };

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

export class MapView {
  constructor(canvas, idx, handlers = {}) {
    this.cv = canvas; this.g = canvas.getContext('2d'); this.idx = idx; this.h = handlers;
    this.state = { marches: [], myGu: null, selected: null, flags: [], phase: null, incomingIds: new Set(), canMarch: false, watchers: 0 };
    this.zoom = 1; this.pan = { x: 0, y: 0 }; this.inset = 0; this.drag = null; this.pointers = new Map();
    const pts = [...idx.byId.values()].map(c => hexToPixel(c.q, c.r, 1));
    this.bounds = { x0: Math.min(...pts.map(p => p.x)) - SQ3 / 2, x1: Math.max(...pts.map(p => p.x)) + SQ3 / 2, y0: Math.min(...pts.map(p => p.y)) - 1, y1: Math.max(...pts.map(p => p.y)) + 1 };
    this.bindInput();
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  css(name) { return this.vars[name] || '#888'; }
  readVars() {
    const cs = getComputedStyle(this.cv);
    this.vars = {};
    for (const n of ['--map-bg', '--map-fiber', '--map-river', '--map-wave', '--map-bridge', '--map-ash', '--map-grid', '--map-fog', '--map-cloud',
      '--map-ink', '--ours', '--enemy', '--fg', '--surface', '--night-veil', '--dusk']) this.vars[n] = cs.getPropertyValue(n).trim();
    for (const g of this.idx.gu.values()) this.vars['--gu-' + g.id] = cs.getPropertyValue('--gu-' + g.id).trim();
  }

  resize() {
    const r = this.cv.getBoundingClientRect();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    this.w = r.width; this.hgt = r.height; this.dpr = dpr;
    this.cv.width = Math.round(r.width * dpr); this.cv.height = Math.round(r.height * dpr);
    const b = this.bounds, pad = 14;
    this.base = Math.max(4, Math.min((r.width - pad * 2) / (b.x1 - b.x0), (r.height - pad * 2) / (b.y1 - b.y0)));
    this.texture = null;
    this.readVars();
  }

  get S() { return this.base * this.zoom; }
  origin() {
    const b = this.bounds, S = this.S;
    return { x: this.w / 2 - (b.x0 + b.x1) / 2 * S + this.pan.x, y: (this.hgt - this.inset) / 2 - (b.y0 + b.y1) / 2 * S + this.pan.y };
  }
  center(c) { const o = this.origin(), p = hexToPixel(c.q, c.r, this.S); return { x: o.x + p.x, y: o.y + p.y }; }
  tileAt(x, y) {
    const o = this.origin(), h = pixelToHex(x - o.x, y - o.y, this.S);
    return this.idx.byKey.get(key(h.q, h.r))?.id ?? null;
  }

  set(partial) { Object.assign(this.state, partial); }

  // ---------- 입력: 탭(칸 고르기), 우리 칸에서 끌기(진군), 그 밖에 끌기(이동), 두 손가락·휠(확대) ----------
  bindInput() {
    const cv = this.cv;
    const pos = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    cv.addEventListener('pointerdown', e => {
      cv.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, pos(e));
      if (this.pointers.size === 2) { const [a, b] = [...this.pointers.values()]; this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: this.zoom }; this.drag = null; return; }
      const p = pos(e), id = this.tileAt(p.x, p.y);
      const own = id && this.state.canMarch && this.idx.byId.get(id).owner === this.state.myGu;
      this.drag = { start: p, last: p, id, mode: own ? 'march?' : 'pan?', moved: false };
    });
    cv.addEventListener('pointermove', e => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, pos(e));
      if (this.pinch && this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.setZoom(this.pinch.z * Math.hypot(a.x - b.x, a.y - b.y) / this.pinch.d); return;
      }
      const d = this.drag; if (!d) return;
      const p = pos(e);
      if (!d.moved && Math.hypot(p.x - d.start.x, p.y - d.start.y) > 8) { d.moved = true; d.mode = d.mode === 'march?' ? 'march' : 'pan'; }
      if (d.mode === 'pan') { this.pan.x += p.x - d.last.x; this.pan.y += p.y - d.last.y; this.clampPan(); }
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
    cv.addEventListener('wheel', e => { e.preventDefault(); this.setZoom(this.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)); }, { passive: false });
    cv.addEventListener('dblclick', () => this.setZoom(this.zoom > 1.4 ? 1 : 2));
  }
  // 폰에서 아래 시트가 지도를 가리는 높이(px). 지도 가운데를 남은 위쪽 공간으로 옮긴다.
  setInset(px) { this.inset = Math.max(0, Math.min(this.hgt * 0.8, px || 0)); }
  setZoom(z) { this.zoom = Math.min(3.2, Math.max(1, z)); this.clampPan(); }
  clampPan() {
    const lim = (this.zoom - 1) * Math.max(this.w, this.hgt) * 0.6 + this.inset;
    this.pan.x = Math.max(-lim, Math.min(lim, this.pan.x)); this.pan.y = Math.max(-lim, Math.min(lim, this.pan.y));
    if (this.zoom === 1 && !this.inset) this.pan = { x: 0, y: 0 };
  }
  focus(id) {
    if (this.zoom < 1.6) this.zoom = 1.8;
    const c = this.idx.byId.get(id), p = hexToPixel(c.q, c.r, this.S), b = this.bounds;
    this.pan = { x: -(p.x - (b.x0 + b.x1) / 2 * this.S), y: -(p.y - (b.y0 + b.y1) / 2 * this.S) };
    this.clampPan();
  }

  // ---------- 그리기 ----------
  hexPath(cx, cy, S) {
    const g = this.g; g.beginPath();
    CORNER.forEach(([dx, dy], i) => i ? g.lineTo(cx + dx * S, cy + dy * S) : g.moveTo(cx + dx * S, cy + dy * S));
    g.closePath();
  }

  makeTexture() {
    // 한지 섬유 + 바깥 안개의 구름문(낮) / 먹 안개(밤). 크기가 바뀔 때만 다시 만든다.
    const c = document.createElement('canvas'); c.width = this.cv.width; c.height = this.cv.height;
    const g = c.getContext('2d'); g.scale(this.dpr, this.dpr);
    g.fillStyle = this.css('--map-bg'); g.fillRect(0, 0, this.w, this.hgt);
    const R = rng(7); g.strokeStyle = this.css('--map-fiber'); g.lineWidth = 1;
    for (let i = 0; i < this.w * this.hgt / 260; i++) {
      const x = R() * this.w, y = R() * this.hgt, a = R() * Math.PI, l = 3 + R() * 9;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    g.strokeStyle = this.css('--map-cloud'); g.lineWidth = 1.5;
    for (let i = 0; i < 26; i++) { // 구름문: 소용돌이 + 꼬리
      const x = R() * this.w, y = R() * this.hgt, r = 7 + R() * 9;
      g.beginPath(); g.arc(x, y, r, Math.PI * 0.2, Math.PI * 1.9); g.stroke();
      g.beginPath(); g.arc(x + r * 0.35, y, r * 0.55, Math.PI, Math.PI * 2.6); g.stroke();
      g.beginPath(); g.moveTo(x + r, y); g.quadraticCurveTo(x + r * 2.2, y + r * 0.6, x + r * 3.4, y); g.stroke();
    }
    this.texture = c; this.textureTheme = this.theme;
  }

  render(now) {
    const theme = document.documentElement.dataset.theme || 'day';
    if (theme !== this.theme) { this.theme = theme; this.readVars(); this.texture = null; }
    if (!this.texture) this.makeTexture();
    const g = this.g, S = this.S, st = this.state, night = theme === 'night';
    g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(this.texture, 0, 0);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const tiles = [...this.idx.byId.values()];
    const pos = new Map(tiles.map(c => [c.id, this.center(c)]));

    // 1) 칸 바닥
    for (const c of tiles) {
      const { x, y } = pos.get(c.id);
      this.hexPath(x, y, S);
      if (c.kind === 'river') g.fillStyle = this.css('--map-river');
      else if (c.gray) g.fillStyle = this.css('--map-ash');
      else if (!c.owner) g.fillStyle = this.css('--map-bridge');
      else g.fillStyle = this.css('--gu-' + c.owner);
      g.globalAlpha = c.kind === 'river' ? 1 : c.owner === st.myGu ? 0.95 : 0.72;
      g.fill(); g.globalAlpha = 1;
      g.strokeStyle = this.css('--map-grid'); g.lineWidth = 1; g.stroke();
      if (c.kind === 'river') this.waves(x, y, S, now);
      if (c.kind === 'bridge') this.planks(x, y, S);
      if (c.gray) this.cracks(x, y, S, c.id);
    }
    // 2) 구 경계(먹선 2px)와 우리 구 테두리
    for (const c of tiles) {
      if (c.kind === 'river') continue;
      const { x, y } = pos.get(c.id);
      DIRS.forEach(([dq, dr]) => {
        const n = this.idx.byKey.get(key(c.q + dq, c.r + dr));
        if (n && n.kind !== 'river' && n.owner === c.owner && n.gray === c.gray) return;
        const [i, j] = EDGE_OF_DIR[dq + ',' + dr];
        g.beginPath(); g.moveTo(x + CORNER[i][0] * S, y + CORNER[i][1] * S); g.lineTo(x + CORNER[j][0] * S, y + CORNER[j][1] * S);
        g.strokeStyle = c.owner && c.owner === st.myGu ? this.css('--ours') : this.css('--map-ink');
        g.lineWidth = c.owner && c.owner === st.myGu ? 2.5 : 2; g.stroke();
      });
    }
    // 3) 등불, 수비 숫자, 랜드마크 표시
    const sc = Math.max(1, Math.round(S / 13));
    const font = Math.max(8, Math.round(S * 0.46));
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const c of tiles) {
      if (c.kind === 'river') continue;
      const { x, y } = pos.get(c.id);
      if (c.owner) {
        const flick = 0.75 + 0.25 * Math.sin(now / 260 + c.id * 1.7);
        if (night) { // 밤: 등불 둘레가 빛난다
          const rg = g.createRadialGradient(x, y - S * 0.2, 1, x, y - S * 0.2, S * 1.1);
          rg.addColorStop(0, `rgba(255, 214, 120, ${0.42 * flick})`); rg.addColorStop(1, 'rgba(255, 214, 120, 0)');
          g.fillStyle = rg; g.fillRect(x - S * 1.2, y - S * 1.4, S * 2.4, S * 2.4);
        }
        drawSprite(g, 'lantern', x, y - S * 0.22, sc);
      } else if (c.gray) drawSprite(g, 'lanternOff', x, y - S * 0.22, sc);
      if (S >= 11 && (c.owner || c.kind === 'bridge')) {
        g.font = `${font}px "DotGothic16", monospace`;
        g.fillStyle = this.css('--fg'); g.strokeStyle = this.css('--surface'); g.lineWidth = 3;
        g.strokeText(String(c.defense), x, y + S * 0.5); g.fillText(String(c.defense), x, y + S * 0.5);
      }
      if (c.landmark) { g.fillStyle = this.css('--map-ink'); g.beginPath(); g.moveTo(x, y - S * 0.92); g.lineTo(x + 3, y - S * 0.8); g.lineTo(x, y - S * 0.68); g.lineTo(x - 3, y - S * 0.8); g.fill(); }
      if (S >= 30) { // 크게 보면 칸 이름
        g.font = `${Math.round(S * 0.28)}px "Gowun Dodum", sans-serif`; g.fillStyle = this.css('--fg');
        g.fillText(c.name, x, y + S * 0.82);
      }
    }
    // 4) 깃발(우리 구 목표)
    for (const [id] of (st.flags || []).slice(0, 1)) { const p = pos.get(id); if (p) drawSprite(g, 'flag', p.x + S * 0.45, p.y - S * 0.55, sc, this.css('--ours')); }
    // 5) 공격 경고(우리 칸으로 오는 진군)
    for (const id of st.incomingIds) {
      const p = pos.get(id); if (!p) continue;
      const a = 0.5 + 0.5 * Math.sin(now / 180);
      this.hexPath(p.x, p.y, S * (0.92 + 0.08 * a)); g.strokeStyle = this.css('--enemy'); g.lineWidth = 3; g.globalAlpha = 0.5 + 0.5 * a; g.stroke(); g.globalAlpha = 1;
    }
    // 6) 진군선과 걸어가는 유닛
    for (const m of st.marches || []) {
      const a = pos.get(m.src), b = pos.get(m.dst); if (!a || !b) continue;
      const col = m.gu === st.myGu ? this.css('--ours') : this.css('--enemy');
      g.setLineDash([5, 4]); g.lineDashOffset = -now / 60; g.strokeStyle = col; g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); g.setLineDash([]);
      const t = marchProgress(m, now);
      const ux = a.x + (b.x - a.x) * t, uy = a.y + (b.y - a.y) * t;
      drawSprite(g, Math.floor(now / 300) % 2 ? 'walkA' : 'walkB', ux, uy - S * 0.3, sc, col);
    }
    // 7) 고른 칸
    if (st.selected) { const p = pos.get(st.selected); if (p) { this.hexPath(p.x, p.y, S); g.strokeStyle = this.css('--fg'); g.lineWidth = 3; g.setLineDash([4, 3]); g.stroke(); g.setLineDash([]); } }
    // 8) 끌어서 진군 중
    if (this.drag?.mode === 'march') {
      const a = pos.get(this.drag.id), b = this.drag.last;
      g.strokeStyle = this.css('--ours'); g.lineWidth = 3; g.setLineDash([6, 4]);
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); g.setLineDash([]);
      if (this.drag.hover) { const p = pos.get(this.drag.hover); if (p) { this.hexPath(p.x, p.y, S); g.strokeStyle = this.css('--ours'); g.stroke(); } }
    }
    // 9) 해 질 녘 물들기, 밤의 어둠과 어둑시니 눈
    const ph = st.phase;
    if (ph?.phase === 'day') {
      const left = Date.parse(ph.sunset) - now;
      if (left < 3600000) { g.fillStyle = this.css('--dusk'); g.globalAlpha = 0.35 * (1 - left / 3600000); g.fillRect(0, 0, this.w, this.hgt); g.globalAlpha = 1; }
    }
    if (night) this.darkness(now, ph?.tick || 0, ph?.phase === 'seal');
  }

  waves(x, y, S, now) { // 민화 물결: 반원 세 개
    const g = this.g; g.strokeStyle = this.css('--map-wave'); g.lineWidth = 1.2;
    const off = Math.sin(now / 900 + x) * S * 0.08;
    for (const [dx, dy] of [[-0.45, -0.3], [0.1, 0.15], [-0.25, 0.55]]) {
      g.beginPath(); g.arc(x + dx * S + off, y + dy * S, S * 0.22, Math.PI, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(x + dx * S + off + S * 0.44, y + dy * S, S * 0.22, Math.PI, Math.PI * 2); g.stroke();
    }
  }
  planks(x, y, S) {
    const g = this.g; g.strokeStyle = this.css('--map-ink'); g.lineWidth = 1;
    for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(x - S * 0.55, y + i * S * 0.18); g.lineTo(x + S * 0.55, y + i * S * 0.18); g.stroke(); }
  }
  cracks(x, y, S, seed) {
    const g = this.g, R = rng(seed * 31); g.strokeStyle = this.css('--map-ink'); g.lineWidth = 1; g.globalAlpha = 0.5;
    for (let k = 0; k < 3; k++) { g.beginPath(); let px = x + (R() - 0.5) * S * 0.6, py = y + (R() - 0.5) * S * 0.6; g.moveTo(px, py); for (let s = 0; s < 3; s++) { px += (R() - 0.5) * S * 0.5; py += (R() - 0.5) * S * 0.5; g.lineTo(px, py); } g.stroke(); }
    g.globalAlpha = 1;
  }
  darkness(now, tick, seal) {
    const g = this.g, w = this.w, h = this.hgt;
    // 가장자리부터 기어 오는 먹 안개: 침식이 진행될수록 안쪽까지
    const reach = Math.min(w, h) * (0.18 + 0.04 * tick);
    const rg = g.createRadialGradient(w / 2, h / 2, Math.max(10, Math.min(w, h) / 2 - reach), w / 2, h / 2, Math.max(w, h) * 0.75);
    rg.addColorStop(0, 'rgba(0,0,0,0)'); rg.addColorStop(1, this.css('--night-veil'));
    g.fillStyle = rg; g.fillRect(0, 0, w, h);
    // 어둑시니의 눈: 침식이 한 번 지날 때마다 하나씩 뜬다(봉인 시간에는 감는다)
    const spots = [[0.06, 0.55], [0.94, 0.5], [0.12, 0.9], [0.86, 0.88], [0.08, 0.3], [0.92, 0.3], [0.5, 0.97], [0.3, 0.95]];
    const open = seal ? 0 : Math.max(1, tick + 1);
    spots.slice(0, open).forEach(([fx, fy], i) => {
      const blink = (Math.floor(now / 100) + i * 37) % 60 === 0;
      if (!blink) drawSprite(g, 'eye', fx * w, fy * h, Math.max(2, Math.round(this.base / 9)));
    });
  }
}
