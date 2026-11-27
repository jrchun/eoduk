# 어둑시니 게임 에셋 제작 요청서

> 사람용 메모(생성할 그림 아님): 이 파일 전체를 Flow에 붙여 넣고, `docs/assets/style-reference.png`(화풍 레퍼런스)를 함께 첨부한다. 받은 zip은 그대로 Claude에게 넘긴다. 한 번에 다 안 만들어지면 묶음(A~F)별로 나눠서 "A 묶음만 만들어 줘"처럼 요청한다. 묶음 하나도 안 되면 각 항목의 `Prompt` 한 줄을 하나씩 넣는다.

---

## 1. 무엇을 만드나

한국 설화 분위기의 지도 땅따먹기 웹게임 **어둑시니**에 쓸 도트 그림(픽셀 아트) 에셋 한 벌을 만들어 주세요.
서울 지도 위에 구청·랜드마크·인물·소품을 세웁니다. 밤이 되면 어둠의 요괴 "어둑시니"가 도시를 먹어 들어오고, 사람들은 등불과 횃불로 땅을 밝혀 지킵니다.

**첨부한 레퍼런스 그림(석등·장승·서낭당·부적 두루마리)과 똑같은 화풍으로** 아래 목록의 그림을 모두 만들어 주세요. 목록의 모든 그림이 한 게임에서 나란히 놓여도 한 사람이 그린 것처럼 보여야 합니다.

## 2. 화풍 규칙 (모든 그림 공통)

레퍼런스에서 가져올 것:
- **시점**: 레퍼런스와 같은 아이소메트릭(대각선으로 45도 돌려, 위에서 약 30도 내려다본 시점). 왼쪽 앞면과 오른쪽 앞면, 윗면이 함께 보인다. 위에서 똑바로 본 그림, 옆에서 본 그림은 안 된다.
- **도트 질감**: 또렷한 픽셀 가장자리, 어두운 외곽선, 이끼 낀 돌·갈라진 나뭇결·기와 결·천 주름 같은 손때 묻은 세부.
- **빛**: 주된 빛은 왼쪽 위. 왼쪽 면이 밝고 오른쪽 면이 어둡다. 등불·횃불·도깨비불처럼 스스로 빛나는 것은 레퍼런스처럼 주변으로 빛이 번진다(따뜻한 주황 또는 차가운 청록).
- **색감**: 채도는 차분하게, 빛나는 부분만 밝게. 단청(빨강·청록·초록)과 돌 회색, 나무 갈색이 기본이다.
- **분위기**: 조선 설화와 지금의 서울이 섞인 밤. 무섭기보다 으스스하고 신비롭게. 피나 끔찍한 표현은 넣지 않는다.

레퍼런스와 다르게 할 것:
- **배경은 투명 PNG**. 투명이 안 되면 그림 바깥을 순수 마젠타 단색(#FF00FF)으로 칠한다(그림 안에는 마젠타를 쓰지 않는다). 레퍼런스의 어두운 회색 배경은 쓰지 않는다.
- **바닥 그림자 없음**. 레퍼런스의 오른쪽 아래 보라 그림자는 빼고, 물체만 그린다. 그림자는 게임 지도가 따로 그린다.
- **읽히는 글자 없음**. 장승·부적·간판에도 한글·한자·영어 글자를 쓰지 않는다. 글자가 들어갈 자리는 붓으로 그은 듯한 무늬로 대신한다. 실제 회사 로고도 넣지 않는다.
- **한 파일에 물체 하나**. 여러 개를 한 장에 모아 그리지 않는다.

## 3. 파일 규칙

- 모든 파일: **정사각형 1024×1024 PNG**, 물체는 가운데. **물체 바닥(발이 닿는 곳)이 캔버스 아래에서 8% 위**에 오게 둔다. 그래야 게임에서 같은 기준으로 세울 수 있다.
- 크기 등급(캔버스 대비 물체 크기). 같은 등급끼리는 크기를 맞춘다.

| 등급 | 물체 크기 | 쓰는 곳 |
|---|---|---|
| S | 높이 35% | 인물, 작은 소품 |
| M | 높이 55% | 구청, 작은 랜드마크 |
| L | 폭 85% (낮고 넓은 건물) | 넓은 랜드마크 |
| T | 높이 88% (높은 탑·빌딩) | 고층 랜드마크 |

- **팀 색**: 같은 그림을 두 벌로 만드는 항목은 팀 색 부분(띠·조끼·등롱 천·깃발)만 바꾸고 나머지는 한 픽셀도 바꾸지 않는다.
  - 우리 편 `ours`: 금빛 주황 **#D9A441**
  - 적 편 `enemy`: 붉은 흙빛 **#B5523B**
- **결과물**: 아래 폴더 구조 그대로 zip 하나로. 파일 이름은 목록에 적힌 그대로(영어 소문자) 쓴다.

```
eoduk-assets.zip
  units/      인물 (A)
  halls/      구청 (B)
  landmarks/  랜드마크 (C)
  props/      지도 소품 (D)
  eoduksini/  밤의 요괴 (E)
  seals/      봉인된 구 표지 (F)
  contact-sheet.png   전체를 한 장에 모아 본 확인용 그림(선택)
```

---

## A. 인물 — `units/` (등급 S)

모두 2~3등신의 귀여운 비율(머리가 몸의 1/3), 전신, 왼쪽 앞을 바라보는 자세.
각 인물마다 **서 있는 그림 1장 + 걷기 2장면**을 만든다(`-walk1`, `-walk2`: 왼발 앞, 오른발 앞). 우리/적 두 벌씩.

| 파일 이름(앞부분) | 이름 | 설명 |
|---|---|---|
| `torchbearer` | 횃불꾼 | 개척하러 나가는 젊은이. 검은 갓, 흰 한복, 팀 색 허리띠. 오른손에 레퍼런스 석등처럼 주황빛이 번지는 횃불을 높이 든다. 앞으로 나아가는 씩씩한 자세 |
| `lanternkeeper` | 등롱지기 | 칸을 지키는 나이 든 문지기. 팀 색 조끼, 긴 장대 끝에 팀 색 천을 씌운 종이 등롱. 땅에 발을 단단히 딛고 버틴다 |
| `dokkaebifire` | 도깨비불 | 빠른 정찰 정령. 몸 없이 떠다니는 불덩이, 작은 눈 두 개와 장난스러운 웃음. 레퍼런스 서낭당 주변의 파란 혼불과 같은 그림체로, 색만 가운데 연노랑에서 가장자리 팀 색으로 |
| `spirit` | 등불 정령 | 사람이 적을 때 돕는 아이 모습의 정령. 아주 밝은 크림색 몸(실제 투명은 아님), 흰 옷에 팀 색 리본, 손바닥에 작은 등불. 은은한 빛 테두리 |

파일 이름 예: `units/torchbearer-ours.png`, `units/torchbearer-ours-walk1.png`, `units/torchbearer-ours-walk2.png`, `units/torchbearer-enemy.png` …
(4종 × 2편 × 3장 = 24장)

Prompt(하나씩 넣을 때, 레퍼런스 첨부): `Isometric pixel art game sprite in the exact style of the attached reference, chibi Joseon-era torchbearer, black gat hat, white hanbok with #D9A441 sash, holding a burning torch high with warm orange glow, full body, transparent background, no ground shadow, no text.`

## B. 구청 — `halls/` (등급 M)

각 구의 시작 칸에 서는 "꺼지지 않는 불씨의 집". 빼앗기지 않는 성소다. **모양은 6장 모두 똑같고, 지붕 꼭대기 깃발과 처마 띠 색만** 구마다 다르다.
설명: 레퍼런스 서낭당과 같은 단청 기와 누각을 조금 더 크고 당당하게. 2층 누각, 돌 기단, 1층 가운데 큰 돌 화로에서 주황 불이 타오르고 빛이 번진다. 처마 끝에 종이 등롱. 실제 구청 건물을 닮게 그리지 않는다.

| 파일 | 구 | 깃발 색 |
|---|---|---|
| `halls/hall-mapo.png` | 마포구 | #3E7C8C |
| `halls/hall-yongsan.png` | 용산구 | #4E6E8E |
| `halls/hall-jung.png` | 중구 | #8D78AD |
| `halls/hall-yeongdeungpo.png` | 영등포구 | #B5523B |
| `halls/hall-dongjak.png` | 동작구 | #5E8A5A |
| `halls/hall-gwanak.png` | 관악구 | #9A6A5E |

Prompt: `Isometric pixel art in the exact style of the attached reference, a two-story Korean dancheong pavilion on a stone platform, large stone brazier with an eternal orange flame glowing on the ground floor, paper lanterns on the eaves, one flag on the roof top colored #3E7C8C, transparent background, no ground shadow, no text.`

## C. 랜드마크 — `landmarks/` (20장)

실제 서울 건물을 **레퍼런스 화풍의 작은 디오라마 모형**으로. 게임 지도에서는 아주 작게 보이므로 **작게 줄여도 알아볼 수 있는 큰 윤곽**이 가장 중요하다. 세부는 그다음이다. 간판·로고·글자는 넣지 않는다. 밤 장면이라 창마다 따뜻한 불빛이 몇 개씩 켜져 있다.

| 파일 | 이름 | 등급 | 그릴 것 |
|---|---|---|---|
| `landmark-assembly.png` | 국회의사당 | L | 낮고 넓은 흰 돌 건물, 열주(기둥 줄), 가운데 큰 초록 돔 |
| `landmark-63building.png` | 63빌딩 | T | 위로 갈수록 살짝 좁아지는 금빛 유리 고층 빌딩 |
| `landmark-parc1.png` | 파크원 | T | 붉은 철골 띠가 기둥 모서리를 감싼 쌍둥이 고층 빌딩 중 하나 |
| `landmark-ifc.png` | IFC | T | 높이가 다른 유리 빌딩 세 동이 모인 무리 |
| `landmark-thehyundai.png` | 더현대 | L | 물결 모양 유리 지붕을 얹은 낮고 넓은 건물, 안에 초록 정원 |
| `landmark-namsantower.png` | 남산서울타워 | T | 산 없이 탑만. 가는 기둥 위 둥근 전망대, 꼭대기 안테나 |
| `landmark-seoulstation.png` | 서울역 | L | 붉은 벽돌에 흰 돌띠, 가운데 초록 돔이 있는 옛 역사 |
| `landmark-museum.png` | 국립중앙박물관 | L | 길고 낮은 회색 돌 건물, 가운데가 크게 뚫린 대문 같은 공간과 넓은 계단 |
| `landmark-myeongdong.png` | 명동 | M | 노점 등불이 늘어선 작은 가게 골목, 뒤로 붉은 벽돌 뾰족탑 성당 |
| `landmark-ddp.png` | 동대문디자인플라자 | L | 모서리 없이 물결처럼 흐르는 은빛 곡면 건물 |
| `landmark-noryangjin.png` | 노량진 수산시장 | L | 넓고 낮은 지붕의 시장 건물, 앞에 수조와 생선 좌판, 푸른 물빛 |
| `landmark-boramae.png` | 보라매공원 | M | 둥근 나무 몇 그루가 선 잔디 언덕, 받침대 위 옛 전투기 한 대 |
| `landmark-cemetery.png` | 국립서울현충원 | M | 짙은 소나무에 둘러싸인 하얀 기념탑과 돌계단 |
| `landmark-snu.png` | 서울대 | M | 열쇠 모양으로 추상화한 큰 철제 정문 조형물, 뒤에 캠퍼스 건물(글자 없음) |
| `landmark-nakseongdae.png` | 낙성대 | M | 작은 석탑과 기와 사당, 석탑 위에 반짝이며 떠 있는 별 하나 |
| `landmark-yeongdeungpostation.png` | 영등포역 | L | 철길 위에 걸친 큰 역 건물, 앞에 짧은 기차 한 칸 |
| `landmark-itaewon.png` | 이태원 | M | 언덕길을 따라 층층이 붙은 알록달록한 가게들 사이로 흰 돔 사원과 가는 첨탑, 줄 전구 |
| `landmark-yeonjudae.png` | 관악산 연주대 | M | 산 없이 가파른 화강암 바위 끝에 매달린 작은 암자 |
| `landmark-worldcup.png` | 월드컵경기장 | L | 방패연 모양 흰 지붕 구조물이 덮인 둥근 경기장 |
| `landmark-hongdae.png` | 홍대앞 | M | 낙서 벽화(글자 없는 무늬) 벽의 작은 공연장들, 따뜻한 조명이 비추는 거리 공연 무대 |

Prompt 예(하나씩 넣을 때): `Isometric pixel art diorama in the exact style of the attached reference, a slim communication tower with a round observation deck and antenna, warm lit windows at night, bold readable silhouette, transparent background, no ground shadow, no text, no logos.`

## D. 지도 소품 — `props/` (등급 S)

칸 위에 올리는 작은 표시. 아주 작게 줄어드니 윤곽을 굵고 단순하게.

| 파일 | 이름 | 그릴 것 |
|---|---|---|
| `props/lantern-lit.png` | 켜진 등불 | 레퍼런스 석등을 작고 단순하게. 창에서 주황빛이 번진다 |
| `props/lantern-off.png` | 꺼진 등불 | 같은 석등, 불이 꺼지고 회색으로 식었다. 이끼만 남음 |
| `props/flag-ours.png` | 우리 깃발 | 나무 장대에 꽂은 삼각 깃발, 천은 #D9A441, 바람에 펄럭임 |
| `props/flag-enemy.png` | 적 깃발 | 같은 깃발, 천은 #B5523B |
| `props/ash.png` | 잿빛 칸 | 어둑시니에게 먹혀 꺼진 돌 화로와 회색 재 더미(#8A8478), 가는 연기 한 줄기 |
| `props/jangseung.png` | 장승 | 레퍼런스 장승을 작게. 몸통 글자 대신 붓 무늬. 구 경계 표시로 쓴다 |
| `props/talisman.png` | 봉인 부적 | 레퍼런스 부적 두루마리를 땅에 세워 박은 모양. 붉은 붓 무늬(글자 없음), 노란 빛 부스러기. 봉인된 구 위에 세운다 |

## E. 밤의 요괴 어둑시니 — `eoduksini/`

게임 이름의 주인공. 밤마다 불빛 가장자리를 먹어 들어오는 어둠. 사람이 쳐다볼수록 커진다는 설화의 요괴다.

| 파일 | 등급 | 그릴 것 |
|---|---|---|
| `eoduksini/body.png` | M | 먹물이 번진 듯 소용돌이치는 검보라 연기 덩어리(#1A1420~#3E3550). 아래가 땅으로 스며들어 흐릿하다. 청록(#4FE3C1)으로 빛나는 눈 두 개만 또렷하다 |
| `eoduksini/body-big.png` | T | 같은 요괴가 크게 부풀어 오른 모습. 눈이 더 많아지고(4~6개) 연기 팔이 사방으로 뻗는다 |
| `eoduksini/eyes.png` | S | 몸 없이 어둠 속에 뜬 청록 눈 한 쌍만. 아주 작게 줄여도 보이게 단순하게 |

## F. 봉인된 구 표지 — `seals/` (19장)

아직 열리지 않은 구를 누르면 뜨는 "열어 주세요" 창 안에 넣는 둥근 표지. **이 묶음만 아이소메트릭이 아니라 정면**으로 그린다.
공통: 둥근 표지판, 안쪽은 크림색 한지(#F6EFDF), 테두리는 어두운 갈색. 아래쪽에 레퍼런스 부적처럼 붉은 붓 무늬 띠가 가로질러 "봉인"된 느낌. 원 안에 그 구의 상징 하나. 원이 캔버스 폭의 80%. 글자 없음.

| 파일 | 구 | 원 안의 상징 |
|---|---|---|
| `seals/seal-jongno.png` | 종로구 | 바위 봉우리 위 민화풍 호랑이(인왕산 호랑이) |
| `seals/seal-seongdong.png` | 성동구 | 작은 언덕을 뒤덮은 노란 개나리(응봉 개나리) |
| `seals/seal-gwangjin.png` | 광진구 | 산 위에서 활을 든 고구려 장수(아차산 온달) |
| `seals/seal-dongdaemun.png` | 동대문구 | 돌 홍예문과 기와지붕의 성문(흥인지문) |
| `seals/seal-jungnang.png` | 중랑구 | 연기가 오르는 언덕 위 봉수대(봉화산 봉수) |
| `seals/seal-seongbuk.png` | 성북구 | 능선을 따라 굽이치는 옛 돌 성곽(북악 성곽) |
| `seals/seal-gangbuk.png` | 강북구 | 둥글고 높은 화강암 봉우리(북한산 인수봉) |
| `seals/seal-dobong.png` | 도봉구 | 뾰족뾰족한 화강암 바위 봉우리들(도봉산 선인봉) |
| `seals/seal-nowon.png` | 노원구 | 소나무 곁에 균형 잡고 선 큰 바위(수락산 바위) |
| `seals/seal-eunpyeong.png` | 은평구 | 절 처마에 매달린 연꽃 등(진관사 연등) |
| `seals/seal-seodaemun.png` | 서대문구 | 불구덩이 다섯 개가 있는 돌 봉수대(안산 봉수대) |
| `seals/seal-gangseo.png` | 강서구 | 약초 다발과 약절구(허준 약초) |
| `seals/seal-yangcheon.png` | 양천구 | 은행나무 곁의 향교 건물(양천향교) |
| `seals/seal-guro.png` | 구로구 | 큰 나무 아래 앉은 작은 노인 아홉(구로 아홉 노인) |
| `seals/seal-geumcheon.png` | 금천구 | 해태 석상(호암산 해태) |
| `seals/seal-seocho.png` | 서초구 | 산처럼 누운 순한 소(우면산 소) |
| `seals/seal-gangnam.png` | 강남구 | 줄지어 빛나는 연등이 걸린 절 지붕(봉은사 연등) |
| `seals/seal-songpa.png` | 송파구 | 백제 돌무지무덤(석촌 백제) |
| `seals/seal-gangdong.png` | 강동구 | 빗살무늬 토기 항아리(암사 빗살무늬) |

---

## 4. 넘기기 전 확인

- [ ] 모든 그림이 레퍼런스와 같은 화풍·시점·빛 방향이다(F 묶음만 정면).
- [ ] 배경이 투명이거나 순수 마젠타 단색이고, 바닥 그림자가 없다.
- [ ] 읽히는 글자·로고·워터마크가 없다.
- [ ] 우리/적 두 벌은 팀 색만 다르다.
- [ ] 같은 등급끼리 크기가 맞고, 물체 바닥이 캔버스 아래 8% 위치에 있다.
- [ ] 파일 이름과 폴더가 목록과 같다. 모두 79장: A 24 + B 6 + C 20 + D 7 + E 3 + F 19 (contact-sheet는 선택).
