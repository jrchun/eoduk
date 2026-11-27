// 온보딩 세계관 3컷과 일출 리포트 공유 카드(Canvas). 색은 CSS 변수에서 읽는다.
import { drawSprite, IMG, drawImageFoot } from './sprites.js';
import { hexToPixel } from './rules.js';

const v = (el, n) => getComputedStyle(el).getPropertyValue(n).trim();
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// 낮은 지평선 위 헥스 땅과 등불들. i: 0 해 지는 도시와 눈, 1 등불 쟁탈, 2 홀로 남은 등불지기
export function drawStory(cv, i) {
  const g = cv.getContext('2d'), W = cv.width, H = cv.height, R = rng(i + 3);
  g.imageSmoothingEnabled = false;
  const sky = g.createLinearGradient(0, 0, 0, H);
  if (i === 0) { sky.addColorStop(0, '#2a2438'); sky.addColorStop(0.6, v(cv, '--dusk')); sky.addColorStop(1, '#f0c27a'); }
  else if (i === 1) { sky.addColorStop(0, v(cv, '--map-bg')); sky.addColorStop(1, v(cv, '--sunk')); }
  else { sky.addColorStop(0, '#0d0e15'); sky.addColorStop(1, '#1d2030'); }
  g.fillStyle = sky; g.fillRect(0, 0, W, H);
  if (i === 0) { g.fillStyle = '#f6d27a'; g.beginPath(); g.arc(W * 0.7, H * 0.66, 26, Math.PI, 0); g.fill(); }
  // 땅: 헥스 한 줄
  const gus = ['--gu-mapo', '--gu-yongsan', '--gu-jung', '--gu-yeongdeungpo', '--gu-dongjak', '--gu-gwanak'];
  const ink = v(cv, '--t-ink');
  for (let k = 0; k < 9; k++) {
    const x = 18 + k * 36, y = H - 34 + (k % 2) * 8;
    g.beginPath();
    for (let c = 0; c < 6; c++) { const a = Math.PI / 180 * (60 * c - 30); g[c ? 'lineTo' : 'moveTo'](x + Math.cos(a) * 21, y + Math.sin(a) * 21); }
    g.closePath();
    const dark = i === 2 && k !== 4;
    g.fillStyle = dark ? '#2a2a30' : v(cv, gus[(k + i) % 6]); g.fill();
    g.strokeStyle = ink; g.lineWidth = 2; g.stroke();
    if (!dark) drawSprite(g, 'lantern', x, y - 6, 2);
    else drawSprite(g, 'lanternOff', x, y - 6, 2);
  }
  if (i === 0) { // 가장자리에서 눈을 뜨는 어둑시니
    const fog = g.createLinearGradient(0, 0, W * 0.5, 0); fog.addColorStop(0, 'rgba(10,10,16,.95)'); fog.addColorStop(1, 'rgba(10,10,16,0)');
    g.fillStyle = fog; g.fillRect(0, 0, W * 0.5, H);
    drawSprite(g, 'eye', 40, 46, 3); drawSprite(g, 'eye', 84, 50, 3);
  }
  if (i === 1) { // 진군선과 두 무리
    g.setLineDash([6, 5]); g.strokeStyle = v(cv, '--ours'); g.lineWidth = 3;
    g.beginPath(); g.moveTo(60, 120); g.lineTo(240, 96); g.stroke(); g.setLineDash([]);
    if (IMG['torch-ours'] && IMG['torch-enemy']) {
      drawImageFoot(g, IMG['torch-ours'], 110, 128, 1); drawImageFoot(g, IMG['torch-ours'], 146, 124, 1);
      drawImageFoot(g, IMG['torch-enemy'], 238, 100, 1, true);
    } else {
      drawSprite(g, 'walkA', 120, 100, 3, v(cv, '--ours')); drawSprite(g, 'walkB', 150, 96, 3, v(cv, '--ours'));
      drawSprite(g, 'walkA', 250, 74, 3, v(cv, '--enemy'));
    }
    drawSprite(g, 'flag', 268, 50, 3, v(cv, '--enemy'));
  }
  if (i === 2) { // 등불지기 하나, 둘레의 빛, 사방의 눈
    const rg = g.createRadialGradient(W / 2, H - 50, 4, W / 2, H - 50, 90);
    rg.addColorStop(0, 'rgba(255,214,120,.55)'); rg.addColorStop(1, 'rgba(255,214,120,0)');
    g.fillStyle = rg; g.fillRect(0, 0, W, H);
    if (IMG['lantern-ours']) drawImageFoot(g, IMG['lantern-ours'], W / 2, H - 40, 2);
    else drawSprite(g, 'walkA', W / 2, H - 78, 4, v(cv, '--ours'));
    for (let k = 0; k < 5; k++) drawSprite(g, 'eye', 30 + R() * (W - 60), 20 + R() * 60, 2);
  }
}

// 1080×1350 공유 카드: 한지 바탕, 큰 글씨, 우리 구 등불 지도
export function drawShareCard(cv, { idx, gu, guName, kept, lost, night }) {
  const g = cv.getContext('2d'), W = cv.width, H = cv.height, root = document.documentElement;
  const col = n => v(root, n);
  g.fillStyle = '#efe6d2'; g.fillRect(0, 0, W, H);
  const R = rng(9); g.strokeStyle = 'rgba(120,100,70,.14)';
  for (let k = 0; k < 2600; k++) { const x = R() * W, y = R() * H, a = R() * Math.PI; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 14, y + Math.sin(a) * 14); g.stroke(); }
  g.strokeStyle = '#2b2420'; g.lineWidth = 8; g.strokeRect(40, 40, W - 80, H - 80);
  g.fillStyle = '#2b2420'; g.textAlign = 'center';
  g.font = '700 64px "Gowun Batang", serif'; g.fillText('어둑시니', W / 2, 150);
  g.font = '34px "Gowun Dodum", sans-serif'; g.fillText(`${night} 밤이 지나고`, W / 2, 215);
  g.font = '700 88px "Gowun Batang", serif'; g.fillText(guName, W / 2, 330);
  g.font = '48px "Gowun Dodum", sans-serif';
  g.fillText(`등불 ${kept ?? '?'}칸을 지켰고`, W / 2, 410);
  g.fillText(`${lost}칸을 어둠에 내줬어요`, W / 2, 475);
  // 지도
  const tiles = [...idx.byId.values()], S = 30;
  const pts = tiles.map(c => hexToPixel(c.q, c.r, S));
  const x0 = Math.min(...pts.map(p => p.x)), x1 = Math.max(...pts.map(p => p.x)), y0 = Math.min(...pts.map(p => p.y)), y1 = Math.max(...pts.map(p => p.y));
  const ox = W / 2 - (x0 + x1) / 2, oy = 560 - y0 + 20;
  tiles.forEach((c, k) => {
    const { x, y } = pts[k], cx = x + ox, cy = y + oy;
    g.beginPath();
    for (let n = 0; n < 6; n++) { const a = Math.PI / 180 * (60 * n - 30); g[n ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * S, cy + Math.sin(a) * S); }
    g.closePath();
    g.fillStyle = c.kind === 'river' ? '#a9bfba' : c.gray ? '#8f8a80' : c.owner === gu ? '#d9a441' : c.owner ? '#d8ccb2' : '#cdb08a';
    g.fill(); g.strokeStyle = '#2b2420'; g.lineWidth = 2; g.stroke();
    if (c.owner === gu) drawSprite(g, 'lantern', cx, cy, 3);
  });
  g.fillStyle = '#2b2420'; g.font = '700 40px "Gowun Batang", serif';
  g.fillText('해 지기 전에 등불을 지켜라', W / 2, H - 150);
  g.font = '32px "Gowun Dodum", sans-serif'; g.fillStyle = '#6e6253';
  g.fillText(location.host || 'eoduk.woongstudio.com', W / 2, H - 95);
  void col;
}
