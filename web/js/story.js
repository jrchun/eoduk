// 온보딩 3컷과 일출 리포트 공유 카드.
// 그림을 따로 그리지 않고 실제 게임 지도(MapView)로 장면을 만든다. 지도 디자인이 바뀌면 온보딩·공유 카드도 저절로 같이 바뀐다.
// 장면은 그때의 실제 칸 상태 위에 연출용 상태(잿빛 칸, 진군, 공격 경고)만 얹는다.
import { MapView } from './map.js';
import { indexMap, applyTiles, darkFront } from './view.js';

const MIN = 60000;
const byName = (idx, n) => [...idx.byId.values()].find(c => c.name === n);
function sceneIdx(mapData, rows) {
  const idx = indexMap(mapData);
  if (rows?.length) applyTiles(idx, rows);
  else for (const c of idx.byId.values()) if (c.kind === 'land' && !c.sealed) { c.owner = c.gu; c.defense = 100; }
  return idx;
}
const setTile = (idx, name, owner, defense, gray = false) => { const c = byName(idx, name); if (c) Object.assign(c, { owner, defense, gray }); return c; };

// 0: 해가 지면 어둠이 가장자리부터 먹는다 / 1: 낮에는 등불을 빼앗는다 / 2: 불을 밝힌 땅만 내일을 맞는다
export const SCENES = [
  { theme: 'night', setup(idx) {
    for (const n of ['상암 2', '상암 4', '상암 5', '성산']) setTile(idx, n, null, 0, true);
    return { state: { myGu: 'mapo', erodingIds: new Set(darkFront(idx, 'mapo').map(c => c.id)) }, look: ['망원', 1] };
  } },
  { theme: 'day', fast: true, setup(idx, base) {
    const bridge = setTile(idx, '마포대교', 'yeongdeungpo', 60), yong = setTile(idx, '용강', 'mapo', 100), seo = setTile(idx, '서강', 'mapo', 100);
    const at = (a, b) => ({ created_at: new Date(base).toISOString(), arrive_at: new Date(base + a * MIN).toISOString(), torch: b });
    const marches = [
      { id: 1, gu: 'mapo', src: seo.id, dst: bridge.id, troops: 60, ...at(11, 0.8) },
      { id: 2, gu: 'yeongdeungpo', src: bridge.id, dst: yong.id, troops: 90, ...at(13, 0.9) },
    ];
    return { state: { myGu: 'mapo', marches, incomingIds: new Set([yong.id]), flags: [[bridge.id, 3]] }, look: ['마포대교', 1] };
  } },
  { theme: 'night', setup(idx) {
    const a = setTile(idx, '용강', 'mapo', 210), b = setTile(idx, '서강', 'mapo', 180);
    return { state: { myGu: 'mapo', reinforced: new Set([a.id, b.id]) }, look: ['신수', 1] };
  } },
];

// 온보딩 캔버스에 장면 i를 그리고 움직인다. 캔버스가 화면에서 빠지면 저절로 멈춘다.
export function startScene(cv, i, mapData, rows) {
  const sc = SCENES[i], r = cv.getBoundingClientRect();
  cv.dataset.theme = sc.theme;
  const idx = sceneIdx(mapData, rows), base = Date.now();
  const { state, look } = sc.setup(idx, base);
  const view = new MapView(cv, idx, {}, { interactive: false, size: { w: Math.max(200, r.width), h: Math.max(110, r.height) }, pc: false, zoom: 0.9 });
  view.set({ incomingIds: new Set(), erodingIds: new Set(), reinforced: new Set(), marches: [], flags: [], ...state });
  view.look(...look);
  const t0 = performance.now();
  const loop = () => {
    if (!cv.isConnected) return;
    const el = performance.now() - t0;
    view.render(sc.fast ? base + (el * 40) % (11 * MIN) : Date.now());
    requestAnimationFrame(loop);
  };
  loop();
}

// 지도 한 장(전체, 안개 없음, 우리 구 강조)을 화면 밖에서 그려 돌려준다
function renderMapImage(idx, gu, w, h, theme = 'day') {
  const holder = document.createElement('div');
  holder.dataset.theme = theme; holder.style.cssText = 'position:fixed;left:-99999px;top:0';
  const mc = document.createElement('canvas'); holder.append(mc); document.body.append(holder);
  const view = new MapView(mc, idx, {}, { interactive: false, size: { w, h }, pc: true, noFog: true, guLabels: true, dpr: 1 });
  view.set({ myGu: gu, incomingIds: new Set(), erodingIds: new Set(), reinforced: new Set(), marches: [], flags: [] });
  view.fitAll();
  view.render(Date.now());
  holder.remove();
  return mc;
}

// 1080×1350 공유 카드: 한지 바탕, 큰 글씨, 실제 지도
export function drawShareCard(cv, { idx, gu, guName, kept, lost, night }) {
  const g = cv.getContext('2d'), W = cv.width, H = cv.height;
  const v = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  g.fillStyle = '#efe6d2'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#2b2420'; g.lineWidth = 8; g.strokeRect(40, 40, W - 80, H - 80);
  g.fillStyle = '#2b2420'; g.textAlign = 'center';
  g.font = '700 64px "Gowun Batang", serif'; g.fillText('어둑시니', W / 2, 150);
  g.font = '34px "Gowun Dodum", sans-serif'; g.fillText(`${night} 밤이 지나고`, W / 2, 215);
  g.font = '700 88px "Gowun Batang", serif'; g.fillText(guName, W / 2, 330);
  g.font = '48px "Gowun Dodum", sans-serif';
  g.fillText(`등불 ${kept ?? '?'}칸을 지켰고`, W / 2, 410);
  g.fillText(`${lost}칸을 어둠에 내줬어요`, W / 2, 475);
  const map = renderMapImage(idx, gu, 900, 640);
  g.drawImage(map, 90, 510, 900, 640);
  g.strokeStyle = '#2b2420'; g.lineWidth = 4; g.strokeRect(90, 510, 900, 640);
  g.fillStyle = '#2b2420'; g.font = '700 40px "Gowun Batang", serif';
  g.fillText('해 지기 전에 등불을 지켜라', W / 2, H - 140);
  g.font = '32px "Gowun Dodum", sans-serif'; g.fillStyle = v('--muted') || '#6e6253';
  g.fillText(location.host || 'eoduk.woongstudio.com', W / 2, H - 88);
}
