// 추천 닉네임(인디언식 이름): 형용사 + 명사. 예: "적색바람의 침묵", "주먹쥐고 일어서", "늑대와 춤을"
// 순수 함수. 무작위 함수(rand)를 넘기면 테스트에서 같은 결과를 낼 수 있다. 닉네임은 최대 12자(DB 규칙).
import { josa } from './view.js';

export const MAX_NICK = 12;
const COLOR = ['적색', '푸른', '검은', '흰', '붉은', '잿빛', '금빛', '은빛', '새벽', '한밤', '젖은', '작은', '늙은', '외딴', '첫'];
const NATURE = ['바람', '달', '별', '강', '불꽃', '안개', '구름', '늑대', '까마귀', '여우', '호랑이', '등불', '비', '눈', '번개', '사슴', '부엉이', '노을'];
const ABSTRACT = ['침묵', '노래', '눈물', '발자국', '숨결', '그림자', '약속', '기다림', '춤', '꿈', '외침', '날개', '이빨', '불씨', '첫걸음'];
const DO = ['주먹쥐고', '달을보며', '불을켜고', '별을세며', '바람타고', '등불들고', '눈을뜨고', '어둠헤치고', '강을건너', '새벽깨워', '숨죽이고', '맨발로'];
const THEN = ['일어서', '달려', '웃어', '기다려', '노래해', '춤춰', '버텨', '지켜', '걸어', '외쳐', '잠들지마'];
const WITH = ['춤을', '노래를', '함께', '걷는 자', '싸운 자', '잠든 자'];

const pick = (arr, rand) => arr[Math.floor(rand() * arr.length) % arr.length];

export function suggestNickname(rand = Math.random) {
  for (let i = 0; i < 20; i++) {
    const r = rand();
    let n;
    if (r < 0.5) n = `${pick(COLOR, rand)}${pick(NATURE, rand)}의 ${pick(ABSTRACT, rand)}`;
    else if (r < 0.82) n = `${pick(DO, rand)} ${pick(THEN, rand)}`;
    else n = `${josa(pick(NATURE, rand), '과', '와')} ${pick(WITH, rand)}`;
    if (n.length <= MAX_NICK) return n;
  }
  return `${pick(NATURE, rand)}의 ${pick(ABSTRACT, rand)}`;
}

// 서로 다른 후보 n개
export function nicknameCandidates(n = 8, rand = Math.random) {
  const out = new Set();
  for (let i = 0; out.size < n && i < n * 10; i++) out.add(suggestNickname(rand));
  return [...out];
}
