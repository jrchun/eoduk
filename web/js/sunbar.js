// 맨 위 시간 흐름 막대: 낮에는 일출→일몰 호 위를 해가, 밤에는 일몰→일출 호 위를 달이 움직인다.
// 밤 호에는 침식 8번(점)과 자정(봉인 시작) 표시. SVG를 DOM으로 만든다(innerHTML 없음).
import { sunTimes, addDays, kstMidnight, fmtLeft, fmtClock, BAL } from './rules.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };

// 지금 시각이 어느 호의 어디쯤인지(순수 함수, 테스트 가능)
export function sunArc(ph, now) {
  if (ph.phase === 'day') {
    const a = Date.parse(ph.sunrise), b = Date.parse(ph.sunset);
    return { kind: 'day', from: a, to: b, t: (now - a) / (b - a), marks: [], left: '일출', right: '일몰' };
  }
  const date = ph.date, mid = ph.phase === 'night' ? Date.parse(ph.midnight) : kstMidnight(date);
  const set = ph.phase === 'night' ? Date.parse(ph.sunset) : sunTimes(addDays(date, -1)).sunset;
  const rise = ph.phase === 'night' ? sunTimes(addDays(date, 1)).sunrise : Date.parse(ph.sunrise);
  const span = rise - set, f = x => (x - set) / span;
  const marks = Array.from({ length: BAL.ticks }, (_, i) => f(set + (mid - set) * (i + 1) / BAL.ticks));
  return { kind: 'night', from: set, to: rise, t: f(now), midnight: f(mid), marks, left: '일몰', right: '일출' };
}

export function mountSunbar(host) {
  const svg = el('svg', { width: '100%', height: '48', 'aria-hidden': 'true' });
  const arc = el('path', { class: 'sb-arc', fill: 'none' }), done = el('path', { class: 'sb-done', fill: 'none' });
  const marks = el('g', { class: 'sb-marks' }), midTick = el('line', { class: 'sb-mid' });
  const body = el('g', { class: 'sb-body' });
  const lt = el('text', { class: 'sb-lbl', x: 4, y: 45 }), rt = el('text', { class: 'sb-lbl', 'text-anchor': 'end', y: 45 });
  const ct = el('text', { class: 'sb-count', 'text-anchor': 'end', y: 15 }), cl = el('text', { class: 'sb-clabel', 'text-anchor': 'end', y: 15 });
  svg.append(arc, done, marks, midTick, body, lt, rt, cl, ct);
  host.replaceChildren(svg);
  return function update(ph, now) {
    const W = host.clientWidth || 360, pad = 16, base = 29, amp = 19;
    const A = sunArc(ph, now), t = Math.min(1, Math.max(0, A.t));
    const xy = u => [pad + u * (W - pad * 2), base - amp * Math.sin(Math.PI * u)];
    const d = (u0, u1) => { let s = ''; for (let i = 0; i <= 40; i++) { const u = u0 + (u1 - u0) * i / 40, [x, y] = xy(u); s += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1); } return s; };
    arc.setAttribute('d', d(0, 1)); done.setAttribute('d', d(0, t));
    marks.replaceChildren(...A.marks.map(u => { const [x, y] = xy(u); return el('circle', { cx: x, cy: y, r: 2, class: u <= t ? 'sb-mark past' : 'sb-mark' }); }));
    if (A.kind === 'night') { const [x, y] = xy(A.midnight); midTick.setAttribute('x1', x); midTick.setAttribute('x2', x); midTick.setAttribute('y1', y - 6); midTick.setAttribute('y2', y + 6); midTick.style.display = ''; }
    else midTick.style.display = 'none';
    const [bx, by] = xy(t);
    body.setAttribute('transform', `translate(${bx.toFixed(1)} ${by.toFixed(1)})`);
    if (body.dataset.kind !== A.kind) {
      body.dataset.kind = A.kind;
      body.replaceChildren(...(A.kind === 'day'
        ? [el('circle', { r: 9, class: 'sb-glow' }), el('circle', { r: 6, class: 'sb-sun' })]
        : [el('circle', { r: 6.5, class: 'sb-moon' }), el('circle', { r: 5.5, cx: 3, cy: -2, class: 'sb-moon-cut' })]));
    }
    lt.textContent = `${A.left} ${fmtClock(A.from)}`;
    rt.setAttribute('x', W - 4); rt.textContent = `${A.right} ${fmtClock(A.to)}`;
    const target = ph.phase === 'day' ? Date.parse(ph.sunset) : ph.phase === 'night' ? Date.parse(ph.midnight) : Date.parse(ph.sunrise);
    ct.setAttribute('x', W - 4); ct.textContent = fmtLeft(target - now);
    cl.textContent = ph.phase === 'day' ? (ph.rush ? '마지막 러시' : '해 지기까지') : ph.phase === 'night' ? (ph.long_night ? '긴 밤 · 봉인까지' : '봉인까지') : '해 뜨기까지';
    cl.setAttribute('x', W - 14 - ct.getComputedTextLength());
  };
}
