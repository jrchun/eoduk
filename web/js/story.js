// 온보딩 3컷과 일출 리포트 공유 카드.
// 그림을 따로 그리지 않고 실제 게임 지도(MapView)로 장면을 만든다. 지도 디자인이 바뀌면 온보딩·공유 카드도 저절로 같이 바뀐다.
// 장면은 그때의 실제 칸 상태 위에 연출용 상태(잿빛 칸, 진군, 공격 경고)만 얹는다.
import { MapView } from './map.js';
import { indexMap, darkFront } from './view.js';

const MIN = 60000;
const byName = (idx, n) => [...idx.byId.values()].find(c => c.name === n);
// 장면은 실제 칸 상태 대신 시즌 시작 모습(구청만 켜짐)에서 출발해 연출을 얹는다
function sceneIdx(mapData) {
  const idx = indexMap(mapData);
  for (const c of idx.byId.values()) if (c.hall) { c.owner = c.hall; c.defense = 100; }
  return idx;
}
const setTile = (idx, name, owner, defense, gray = false) => { const c = byName(idx, name); if (c) Object.assign(c, { owner, defense, gray }); return c; };
const light = (idx, owner, names) => names.forEach(n => setTile(idx, n, owner, 80));

// 0: 해가 지면 어둠이 개척지 가장자리부터 먹는다 / 1: 구청에서 어둠을 밝혀 나간다 / 2: 강북 3구 연합 대 강남 3구 연합
export const SCENES = [
  { theme: 'night', setup(idx) {
    light(idx, 'mapo', ['망원', '합정', '성산', '홍대앞', '서강']);
    setTile(idx, '상암', null, 0, true);
    return { state: { myGu: 'mapo', mySide: 'n', erodingIds: new Set(darkFront(idx, 'n').map(c => c.id)) }, look: ['망원', 1] };
  } },
  { theme: 'day', fast: true, setup(idx, base) {
    light(idx, 'mapo', ['망원', '성산']);
    const hall = byName(idx, '마포구청'), d1 = byName(idx, '홍대앞'), d2 = byName(idx, '합정');
    const at = (a) => ({ created_at: new Date(base).toISOString(), arrive_at: new Date(base + a * MIN).toISOString(), torch: 0.5 });
    const marches = [
      { id: 1, gu: 'mapo', src: hall.id, dst: d1.id, troops: 40, kind: 'settle', ...at(11) },
      { id: 2, gu: 'mapo', src: byName(idx, '망원').id, dst: d2.id, troops: 30, kind: 'settle', npc: true, ...at(13) },
    ];
    return { state: { myGu: 'mapo', mySide: 'n', marches }, look: ['망원', 1] };
  } },
  { theme: 'day', noFog: true, zoom: 0.55, setup(idx) {
    light(idx, 'mapo', ['망원', '합정', '서강', '신수', '용강']); light(idx, 'yongsan', ['한강로', '원효로', '용산2가']); light(idx, 'jung', ['회현', '필동']);
    light(idx, 'yeongdeungpo', ['문래', '영등포역', '신길']); light(idx, 'dongjak', ['대방', '상도', '노량진 수산시장']); light(idx, 'gwanak', ['은천', '서원', '청룡']);
    return { state: { myGu: 'mapo', mySide: 'n' }, look: ['마포대교', 1] };
  } },
];

// 온보딩 캔버스에 장면 i를 그리고 움직인다. 캔버스가 화면에서 빠지면 저절로 멈춘다.
export function startScene(cv, i, mapData) {
  const sc = SCENES[i], r = cv.getBoundingClientRect();
  cv.dataset.theme = sc.theme;
  const idx = sceneIdx(mapData), base = Date.now();
  const { state, look } = sc.setup(idx, base);
  const view = new MapView(cv, idx, {}, { interactive: false, size: { w: Math.max(200, r.width), h: Math.max(110, r.height) }, pc: false, zoom: sc.zoom || 0.9, noFog: !!sc.noFog });
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
  // 색은 낮 테마 변수(styles.css)에서 읽는다
  const probe = Object.assign(document.createElement('div'), { hidden: true }); probe.dataset.theme = 'day'; document.body.append(probe);
  const cs = getComputedStyle(probe), pick = ['--line', '--map-bg', '--muted'].map(n => cs.getPropertyValue(n).trim()); probe.remove();
  const [ink, paper, muted] = pick;
  g.fillStyle = paper; g.fillRect(0, 0, W, H);
  g.strokeStyle = ink; g.lineWidth = 8; g.strokeRect(40, 40, W - 80, H - 80);
  g.fillStyle = ink; g.textAlign = 'center';
  g.font = '700 64px "Gowun Batang", serif'; g.fillText('어둑시니', W / 2, 150);
  g.font = '34px "Gowun Dodum", sans-serif'; g.fillText(`${night} 밤이 지나고`, W / 2, 215);
  g.font = '700 88px "Gowun Batang", serif'; g.fillText(guName, W / 2, 330);
  g.font = '48px "Gowun Dodum", sans-serif';
  g.fillText(`등불 ${kept ?? '?'}칸을 지켰고`, W / 2, 410);
  g.fillText(`${lost}칸을 어둠에 내줬어요`, W / 2, 475);
  const map = renderMapImage(idx, gu, 900, 640);
  g.drawImage(map, 90, 510, 900, 640);
  g.strokeStyle = ink; g.lineWidth = 4; g.strokeRect(90, 510, 900, 640);
  g.fillStyle = ink; g.font = '700 40px "Gowun Batang", serif';
  g.fillText('해 지기 전에 등불을 지켜라', W / 2, H - 140);
  g.font = '32px "Gowun Dodum", sans-serif'; g.fillStyle = muted;
  g.fillText(location.host || 'eoduk.woongstudio.com', W / 2, H - 88);
}
