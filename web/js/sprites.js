// 도트 그림. 글자 한 칸 = 픽셀 하나. 정수 배율로만 키운다(흐려지지 않게).
// 팀 색(T)만 바꿔 우리(#D9A441)·적(#B5523B)을 구분한다. 다른 게임 그림은 쓰지 않는다(직접 그림).

const PAL = {
  d: '#3a2618', // 진한 갈색 셀아웃
  h: '#2b2420', // 갓
  s: '#e9c29a', // 얼굴
  S: '#c99a72', // 얼굴 그늘
  c: '#efe4cc', // 흰 한복
  C: '#cdbf9f', // 한복 그늘
  b: '#5a3e2b', // 신
  f: '#f2b544', // 불꽃
  F: '#fff0a8', // 불꽃 밝은 곳
  r: '#b5523b', // 등롱 술
  y: '#ffe08a', // 등롱 빛
  Y: '#e8a93a', // 등롱 몸
  g: '#8a8478', // 잿빛
  w: '#f6f1e4', // 눈 흰자
  e: '#c0392b', // 눈동자
  k: '#0b0b10', // 먹
};

export const SPRITES = {
  lantern: [
    '...d...',
    '..ddd..',
    '.rrrrr.',
    'dYyyyYd',
    'dYyFyYd',
    'dYyyyYd',
    '.rrrrr.',
    '..ddd..',
    '...r...',
  ],
  lanternOff: [
    '...d...',
    '..ddd..',
    '.ggggg.',
    'dgCCCgd',
    'dgCCCgd',
    'dgCCCgd',
    '.ggggg.',
    '..ddd..',
    '...g...',
  ],
  walkA: [
    '......F.',
    '..hhh.f.',
    '.hhhhhd.',
    '..sSs.d.',
    '..sss.d.',
    '.TTTTTd.',
    '.cTcTc..',
    '.ccccC..',
    '.cccCC..',
    '..c..c..',
    '.b...b..',
  ],
  walkB: [
    '......F.',
    '..hhh.f.',
    '.hhhhhd.',
    '..sSs.d.',
    '..sss.d.',
    '.TTTTTd.',
    '.cTcTc..',
    '.ccccC..',
    '.cccCC..',
    '...cc...',
    '...bb...',
  ],
  eye: [
    '..kkkkk..',
    '.kwwwwwk.',
    'kwwweewwk',
    'kwwweewwk',
    '.kwwwwwk.',
    '..kkkkk..',
  ],
  flag: [
    'dTTTT',
    'dTTTT',
    'dTTT.',
    'd....',
    'd....',
    'd....',
  ],
};

const cache = new Map();
// 스프라이트를 작은 캔버스로 한 번 만들어 두고 drawImage로 정수 배율 확대
export function spriteCanvas(name, team = '#D9A441') {
  const k = name + team;
  if (cache.has(k)) return cache.get(k);
  const rows = SPRITES[name];
  const c = (typeof OffscreenCanvas !== 'undefined') ? new OffscreenCanvas(rows[0].length, rows.length) : Object.assign(document.createElement('canvas'), { width: rows[0].length, height: rows.length });
  const g = c.getContext('2d');
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.') return;
    g.fillStyle = ch === 'T' ? team : PAL[ch];
    g.fillRect(x, y, 1, 1);
  }));
  cache.set(k, c);
  return c;
}

export function drawSprite(g, name, cx, cy, scale, team) {
  const c = spriteCanvas(name, team);
  const w = c.width * scale, h = c.height * scale;
  g.imageSmoothingEnabled = false;
  g.drawImage(c, Math.round(cx - w / 2), Math.round(cy - h / 2), w, h);
}
