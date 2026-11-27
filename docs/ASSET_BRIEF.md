# 어둑시니 그림 작업지시서 (Google Flow용)

2026-11-27 작성. 지도(서울 쿼터뷰)에 올릴 구조물·인물·소품 그림을 Google Flow(구글의 AI 그림·영상 만들기 도구)로 만들 때 쓰는 문서다.
프롬프트(그림을 만들어 달라고 넣는 문장)는 영어로 적었다. 그림 AI가 영어를 더 정확히 알아듣기 때문이다. 각 항목의 한국어 설명은 무엇을 그리는지 확인하는 용도다.

---

## 0. 한눈에 보기

| 묶음 | 개수 | 우선순위 | 지도에서 쓰는 곳 |
|---|---|---|---|
| A. 인물(유닛) | 4종 × 우리/적 = 8장 (+ 걷기 동작) | 1 | 진군하는 사람, 칸을 지키는 사람 |
| B. 구청 | 1종 × 6색 = 6장 | 1 | 각 구의 시작 칸(구청) |
| C. 랜드마크 | 15장 (이미 있는 5장 제외) | 2 | 효과가 붙은 이름 있는 칸 |
| D. 어둑시니(밤의 적) | 3장 | 2 | 밤에 개척지 가장자리를 먹는 어둠 |
| E. 봉인된 구 상징 | 19장 | 3 | 봉인된 구를 눌렀을 때 "열어 주세요" 창 |

**만들지 않는 것** (코드가 직접 그리므로 그림이 필요 없다)
- 땅, 칸(헥스), 한강·샛강, 다리, 산(북한산·남산·관악산 등). 지도 모양이 바뀌면 같이 바뀌어야 해서 코드로 그린다.
- 온보딩(처음 안내) 그림, 공유 카드 그림. 실제 지도를 그대로 찍어서 만든다(`web/js/story.js`).
- 작은 등불·깃발·눈 같은 7~9픽셀짜리 표시. 이미 코드에 도트로 있다(`web/js/sprites.js`).

---

## 1. 모든 그림에 공통으로 지킬 것

### 화풍
- **HD-2D 도트 그림**: 픽셀이 또렷한 도트 인물·건물을, 입체감 있는 디오라마(작은 모형 세트) 지도 위에 세운다.
- **쿼터뷰**: 남쪽에서 북쪽을 비스듬히 내려다본다(위에서 약 27도). 건물은 정면(남쪽 면)과 지붕 윗면이 같이 보인다. 위에서 똑바로 내려다본 그림(탑뷰)이나 옆에서 본 그림은 안 된다.
- **빛은 왼쪽 위(북서쪽)에서**: 왼쪽 면이 밝고 오른쪽 면이 그늘진다. 지도의 산도 같은 방향이다.
- **외곽선**: 진한 갈색(#3a2618) 1픽셀 선. 검정 선은 쓰지 않는다.
- **분위기**: 한지(전통 종이)와 먹선, 등불의 따뜻한 빛. 조선풍 설화와 지금의 서울이 섞인 느낌. 무섭기보다 신비롭게.
- **글자·간판·로고 없음**: 건물에 상호, 영어, 한글 간판을 넣지 않는다. 실제 회사 로고도 넣지 않는다(모양만 닮게).
- **배경**: 한 가지 단색(밝은 초록 #00ff00)으로. 나중에 배경을 지워 투명하게 만든다. 그림자도 바닥에 넓게 깔지 않는다(지도가 그림자를 그린다).
- **한 장에 하나**: 한 그림에 건물 하나, 인물 한 명.

### 색 (화면 `web/styles.css`에 있는 색과 맞춘다)
| 쓰임 | 색 |
|---|---|
| 우리 편(팀 색) | 금빛 주황 #D9A441 |
| 적 편(팀 색) | 붉은 흙빛 #B5523B |
| 외곽선 | #3A2618 |
| 흰 한복 / 그늘 | #EFE4CC / #CDBF9F |
| 등불 빛 / 불꽃 밝은 곳 | #FFE08A / #FFF0A8 |
| 어둑시니 눈 | 청록 #4FE3C1 |
| 잿빛(꺼진 땅) | #8A8478 |

우리/적 두 벌을 만드는 그림은 **팀 색 부분(옷 띠, 등롱 천, 깃발)만** 바꾸고 나머지는 똑같이 둔다.

### 크기와 파일 이름
Flow는 큰 그림(1024픽셀 안팎)을 만든다. 받은 뒤 아래 "완성 크기"로 줄인다. 줄일 때는 **최근접(nearest neighbor) 방식**으로 줄여야 도트가 흐려지지 않는다(줄이는 일은 AI에게 맡겨도 된다).
- 파일 형식: PNG, 배경 투명.
- 그림의 **아래 가운데**가 칸 중심(발이 닿는 곳)에 놓인다. 그래서 건물·인물은 그림 아래 가운데에 바닥이 닿게 그린다.

### 공통 프롬프트 머리말 (모든 프롬프트 앞에 붙인다)

```
Pixel art game sprite, HD-2D style, crisp hard-edged pixels, limited palette, 1-pixel dark brown (#3a2618) outline.
Isometric-like quarter view seen from the south, camera tilted about 27 degrees down, front face and roof both visible.
Light from the upper left, left faces lit, right faces in shade. Warm lantern glow, Korean folklore mood mixed with modern Seoul.
Single object centered, base touching the bottom center, plain flat pure green (#00ff00) background, no ground shadow.
No text, no letters, no signs, no logos, no watermark.
```

---

## 2. Flow에서 만드는 순서

1. **기준 그림 한 장부터**: A-1 횃불꾼(우리 편)을 먼저 만든다. 마음에 드는 것이 나올 때까지 여러 번 뽑는다.
2. **기준 그림을 참고 이미지로 넣는다**: 이후 모든 그림은 기준 그림을 참고(재료) 이미지로 같이 넣고 "same pixel art style as the reference" 를 덧붙인다. 그래야 화풍이 한 벌로 맞는다.
3. **우리/적은 같은 그림을 고쳐서**: 우리 편을 먼저 만든 뒤, 그 그림을 넣고 "change only the team-colored parts from #D9A441 to #B5523B, keep everything else identical" 로 적 편을 만든다.
4. **걷기 동작(선택)**: Flow의 영상 기능으로 인물이 제자리 걷는 짧은 영상(2초)을 만들면, 거기서 4장면을 뽑아 걷기 동작으로 쓸 수 있다. 영상 프롬프트는 A절 끝에 있다.
5. **다 모아서 넘긴다**: 받은 원본(큰 그림)을 그대로 넘겨 주면 배경 지우기·줄이기·파일 이름 붙이기·지도에 얹기는 AI가 한다. 파일 이름을 직접 붙여 주면 더 빠르다(각 항목의 "파일").

---

## A. 인물(유닛) — 우선순위 1

완성 크기: **48×64** (실제 인물은 가운데 약 24×40, 나머지는 투명). 이미 있는 그림을 다시 만드는 것이라 같은 파일 이름·크기로 덮어쓴다.
공통 덧붙임: `chibi proportions (head about 1/3 of body), full body, standing, facing front-left (three-quarter view)`

### A-1. 횃불꾼 — 개척하러 나가는 사람
- 파일: `units/torchbearer-ours-48x64.png`, `units/torchbearer-enemy-48x64.png`
- 설명: 검은 갓, 흰 한복, 허리에 팀 색 띠. 오른손에 활활 타는 횃불을 높이 든다. 씩씩하고 앞으로 나아가는 자세.
- 프롬프트: `A young Joseon-era torchbearer, black gat hat, white hanbok with a #D9A441 waist sash and #D9A441 trim, holding a burning wooden torch high in the right hand, bright orange flame, determined pose, leaning slightly forward.`

### A-2. 등롱지기 — 칸을 지키는 사람
- 파일: `units/lanternkeeper-ours-48x64.png`, `units/lanternkeeper-enemy-48x64.png`
- 설명: 조금 나이 든 문지기. 긴 장대 끝에 팀 색 천을 씌운 등롱(종이 등)을 매달아 든다. 든든하게 버티고 선 자세.
- 프롬프트: `A sturdy Joseon-era lantern keeper, older guard, black gat hat, white hanbok with a #D9A441 vest, holding a long wooden pole with a glowing paper lantern (#D9A441 cloth, warm #FFE08A light inside) hanging from the top, firm defensive stance, feet planted.`

### A-3. 도깨비불 — 빠른 정찰(나중에 쓸 유닛)
- 파일: `units/dokkaebifire-ours-48x64.png`, `units/dokkaebifire-enemy-48x64.png`
- 설명: 사람이 아니라 떠다니는 불덩이 정령. 작은 눈 두 개, 장난스러운 표정, 꼬리처럼 흔들리는 불꽃. 땅에서 살짝 떠 있다.
- 프롬프트: `A small floating dokkaebi fire spirit from Korean folklore, a round wisp of flame with two tiny dark eyes and a mischievous smile, flickering flame tail, core color #FFF0A8 fading to #D9A441 at the edges, hovering slightly above the ground, no body or limbs.`

### A-4. 등불 정령 — 사람이 적을 때 채워 주는 보조 플레이어 (새로 만듦)
- 파일: `units/spirit-ours-48x64.png`, `units/spirit-enemy-48x64.png`
- 설명: 반쯤 투명해 보이는 아이 모습의 정령. 손바닥 위에 작은 등불을 받쳐 든다. 사람 플레이어와 한눈에 구분되게 몸이 은은하게 빛난다(실제 투명이 아니라 밝은 색으로 표현).
- 프롬프트: `A small lantern spirit in the shape of a child, pale glowing body suggested with very light cream colors (not actually transparent), simple white robe with #D9A441 ribbon, holding a tiny glowing lantern on the open palm, calm gentle expression, soft glow outline.`

### 걷기 동작 영상 (선택)
- 넣을 것: 위에서 만든 인물 그림(시작 장면)
- 프롬프트: `The pixel art character walks in place, simple 4-step walk cycle, camera locked, no camera movement, same pose angle, plain green background stays still, 2 seconds, seamless loop.`
- 받은 뒤: 영상에서 발이 다른 4장면을 뽑아 `units/<이름>-<편>-walk-48x64.png`(가로로 4칸 이어 붙인 192×64)로 만든다. AI가 해도 된다.

---

## B. 구청 — 우선순위 1

각 구의 시작 칸. 빼앗을 수도 밤에 먹힐 수도 없는 "불씨의 집"이다.
완성 크기: **40×44**. 모양 하나를 만들고 깃발·지붕 띠 색만 6구 색으로 바꾼다.

- 파일: `landmarks/hall-<구 아이디>.png`
- 설명: 기와지붕을 얹은 작은 누각(정자 같은 2층 건물). 가운데 큰 화로에서 꺼지지 않는 불이 타고, 처마 끝에 등롱이 달렸다. 지붕 꼭대기에 구 색 깃발 하나. 지금 구청 건물을 닮게 그리지 않는다(게임 속 상징 건물).
- 프롬프트: `A small two-story Korean pavilion (nugak) with curved giwa tile roof, a large stone brazier with an eternal flame in the center of the ground floor, paper lanterns hanging from the eaves, one tall flag on the roof top in color <구 색>, stone base platform, sacred and protected feeling.`

| 구 | 아이디 | 깃발 색 |
|---|---|---|
| 마포구 | mapo | #3E7C8C |
| 용산구 | yongsan | #4E6E8E |
| 중구 | jung | #8D78AD |
| 영등포구 | yeongdeungpo | #B5523B |
| 동작구 | dongjak | #5E8A5A |
| 관악구 | gwanak | #9A6A5E |

---

## C. 랜드마크 — 우선순위 2

이미 있는 5장(63빌딩·파크원·더현대·IFC·국회의사당)과 같은 크기 감각으로 만든다. 지도에서 한 칸 위에 서기 때문에 **아주 작게 줄었을 때도 무엇인지 알아보는 실루엣**(윤곽)이 가장 중요하다. 세부 장식보다 큰 모양을 살린다.
완성 크기 기준: 높은 건물·탑 **16×48**, 넓은 건물 **28×22**, 중간 **22×30**.

| # | 파일 | 이름 | 완성 크기 | 설명 | 프롬프트(주제 부분) |
|---|---|---|---|---|---|
| C-1 | `landmarks/landmark-namsantower.png` | 남산서울타워 | 16×48 | 산 위가 아니라 탑만(산은 지도가 그린다). 가는 기둥 위 둥근 전망대, 꼭대기 안테나. 전망대 창에 따뜻한 불빛 | `A slim tall communication tower with a round observation deck near the top and a thin antenna spire, warm lights in the deck windows, concrete base.` |
| C-2 | `landmarks/landmark-seoulstation.png` | 서울역 | 28×22 | 붉은 벽돌과 흰 돌띠의 옛 역사, 가운데 초록 돔 지붕 | `An old European-style railway station, red brick walls with white stone bands, a central green copper dome, arched windows.` |
| C-3 | `landmarks/landmark-museum.png` | 국립중앙박물관 | 28×22 | 길고 낮은 돌 건물, 가운데가 크게 뚫린 계단형 대청 | `A long low modern stone museum building with a huge open central gateway and wide stairs, light gray stone.` |
| C-4 | `landmarks/landmark-myeongdong.png` | 명동 | 22×30 | 좁은 골목에 늘어선 가게와 노점 등불, 뾰족탑 성당 하나가 뒤에 보인다(간판 글자 없음) | `A cluster of small busy shop buildings with street stall lanterns, and a red brick gothic cathedral spire rising behind them.` |
| C-5 | `landmarks/landmark-ddp.png` | 동대문디자인플라자 | 28×22 | 은빛 곡면이 물결처럼 흐르는 우주선 같은 건물 | `A futuristic flowing building with smooth curved silver metal panels, no straight edges, like a landed spaceship.` |
| C-6 | `landmarks/landmark-noryangjin.png` | 노량진 수산시장 | 28×22 | 넓은 지붕 아래 수조와 생선 좌판, 파란 물빛 | `A wide fish market hall with a broad low roof, fish tanks and stalls visible at the front, blue water glints.` |
| C-7 | `landmarks/landmark-boramae.png` | 보라매공원 | 22×30 | 잔디 언덕 위 은퇴한 옛 전투기 한 대와 나무 몇 그루 | `A small grassy park mound with a few round trees and an old retired fighter jet displayed on a pedestal.` |
| C-8 | `landmarks/landmark-cemetery.png` | 국립서울현충원 | 22×30 | 소나무 사이 하얀 기념탑, 엄숙하고 조용하게 | `A white memorial tower monument surrounded by dark pine trees, solemn and quiet, stone steps.` |
| C-9 | `landmarks/landmark-snu.png` | 서울대 | 22×30 | 정문 조형물(기울어진 큰 철제 문 모양)과 뒤의 캠퍼스 건물 | `A large abstract steel gate sculpture shaped like a stylized key or letter form, with a modern campus building behind, no readable letters.` |
| C-10 | `landmarks/landmark-nakseongdae.png` | 낙성대 | 22×30 | 별이 떨어졌다는 설화의 터. 작은 석탑과 사당, 위에 반짝이는 별 하나 | `A small Korean stone pagoda beside a tiny shrine with a tile roof, one small glowing star hovering above the pagoda, folklore mood.` |
| C-11 | `landmarks/landmark-yeongdeungpostation.png` | 영등포역 | 28×22 | 철길 위에 걸친 큰 역 건물, 앞에 기차 한 칸 | `A large modern railway station building straddling train tracks, one short train car in front, glass and concrete.` |
| C-12 | `landmarks/landmark-itaewon.png` | 이태원 | 22×30 | 언덕길을 따라 층층이 붙은 알록달록한 작은 가게들과 둥근 지붕 사원 | `Colorful small shop buildings stacked along a hillside street, a white mosque dome with a slender minaret among them, string lights.` |
| C-13 | `landmarks/landmark-yeonjudae.png` | 관악산(연주대) | 16×28 | 산은 지도가 그리므로 바위 끝에 매달린 작은 암자만 | `A tiny Buddhist hermitage pavilion perched on the edge of a steep granite rock outcrop, small tile roof.` |
| C-14 | `landmarks/landmark-worldcup.png` | 월드컵경기장 | 28×22 | 방패연(전통 연) 모양 지붕이 덮인 둥근 경기장 | `A round football stadium with a white roof structure shaped like a traditional Korean shield kite, roof cables.` |
| C-15 | `landmarks/landmark-hongdae.png` | 홍대앞 | 22×30 | 낙서 벽화가 있는 작은 공연장들과 거리 공연 무대, 노란 조명 | `Small live music club buildings with colorful graffiti walls (abstract shapes, no letters), a tiny street busking stage with a warm spotlight.` |

이미 있는 5장(다시 만들지 않아도 됨): `landmark-63building`(16×47)·`landmark-parc1`(17×47)·`landmark-ifc`(15×35)·`landmark-thehyundai`(27×21)·`landmark-assembly`(26×22). 새 화풍과 너무 다르면 같은 방식으로 다시 뽑아 덮어쓴다.

---

## D. 어둑시니(밤의 적) — 우선순위 2

밤마다 개척지 가장자리를 먹어 들어오는 어둠. 게임 이름의 주인공이다. 불 켜진 칸을 둘러싸고 나타난다.

### D-1. 어둑시니 몸통
- 파일: `units/eoduksini-64x64.png` (완성 64×64)
- 설명: 먹물이 번진 듯한 검보라 연기 덩어리. 형체가 흐릿하고 아래쪽이 땅에 스며든다. 청록 눈 두 개만 또렷하다. 사람이 쳐다볼수록 커진다는 설화의 요괴라, 무섭기보다 으스스하고 신비롭게.
- 프롬프트: `Eoduksini, a Korean folklore shadow yokai, a blob of swirling ink-like dark purple smoke (#1a1420 to #3e3550), soft edges dissolving into the ground at the bottom, two glowing teal eyes (#4FE3C1), eerie but not gory, mysterious.`

### D-2. 어둑시니 눈 (안개 속에 떠 있는 눈)
- 파일: `units/eoduksini-eyes-16x8.png` (완성 16×8)
- 설명: 몸 없이 어둠 속에 뜬 눈 한 쌍. 지도 안개 위에 여기저기 띄운다.
- 프롬프트: `Just a pair of glowing teal (#4FE3C1) slanted eyes floating in darkness, no body, simple, readable at very small size, on pure green background.`

### D-3. 잿빛 칸 표시 (먹힌 칸)
- 파일: `units/ash-32x20.png` (완성 32×20)
- 설명: 어둑시니에게 먹혀 꺼진 칸에 남는 꺼진 화로와 재 더미. 연기 한 줄기.
- 프롬프트: `A small extinguished stone brazier with a pile of gray ash (#8A8478) and one thin wisp of smoke rising, cold and quiet.`

---

## E. 봉인된 구 상징 — 우선순위 3

아직 열리지 않은 19개 구를 눌렀을 때 뜨는 "열어 주세요" 투표 창에 넣는 동그란 표지(엠블럼). 지도 위가 아니라 창 안에 쓰므로 쿼터뷰가 아니어도 된다.
완성 크기: **48×48**.
공통 프롬프트(머리말 대신 이것을 쓴다):

```
Pixel art round emblem badge, 48x48 feel, crisp pixels, 1-pixel dark brown (#3a2618) outline, hanji paper cream background inside the circle (#F6EFDF),
a folded paper talisman seal strip across the bottom edge, front view, flat, plain pure green (#00ff00) background outside the circle, no text, no letters.
Inside the circle: <상징>
```

| 구 | 파일 | 상징(한국어) | 상징(프롬프트) |
|---|---|---|---|
| 종로구 | `seals/seal-jongno.png` | 인왕산 호랑이 | a Korean folk-painting tiger on a rocky peak |
| 성동구 | `seals/seal-seongdong.png` | 응봉 개나리 | yellow forsythia flowers on a small hill |
| 광진구 | `seals/seal-gwangjin.png` | 아차산 온달 | an ancient Goguryeo general with a bow on a mountain |
| 동대문구 | `seals/seal-dongdaemun.png` | 흥인지문 | a traditional Korean city gate with a stone arch and tile roof |
| 중랑구 | `seals/seal-jungnang.png` | 봉화산 봉수 | a beacon fire tower with smoke on a hill |
| 성북구 | `seals/seal-seongbuk.png` | 북악 성곽 | a winding old stone fortress wall on a ridge |
| 강북구 | `seals/seal-gangbuk.png` | 북한산 인수봉 | a tall rounded granite rock peak |
| 도봉구 | `seals/seal-dobong.png` | 도봉산 선인봉 | jagged granite rock spires |
| 노원구 | `seals/seal-nowon.png` | 수락산 바위 | a large balanced boulder with pine trees |
| 은평구 | `seals/seal-eunpyeong.png` | 진관사 연등 | lotus lanterns hanging at a temple |
| 서대문구 | `seals/seal-seodaemun.png` | 안산 봉수대 | a stone beacon platform with five fire pits |
| 강서구 | `seals/seal-gangseo.png` | 허준 약초 | medicinal herbs and a mortar and pestle |
| 양천구 | `seals/seal-yangcheon.png` | 양천향교 | a Confucian school building with a ginkgo tree |
| 구로구 | `seals/seal-guro.png` | 구로 아홉 노인 | nine tiny old men silhouettes under a big tree |
| 금천구 | `seals/seal-geumcheon.png` | 호암산 해태 | a haetae guardian lion statue |
| 서초구 | `seals/seal-seocho.png` | 우면산 소 | a resting ox shaped like a gentle mountain |
| 강남구 | `seals/seal-gangnam.png` | 봉은사 연등 | a temple roof with rows of glowing lanterns |
| 송파구 | `seals/seal-songpa.png` | 석촌 백제 | an ancient Baekje stone tomb mound |
| 강동구 | `seals/seal-gangdong.png` | 암사 빗살무늬 | a prehistoric comb-pattern clay pot |

---

## 3. 받은 그림 검수표

넘기기 전에(또는 AI가 받은 뒤) 아래를 확인한다. 하나라도 걸리면 다시 뽑는다.

- [ ] 글자·간판·로고·워터마크가 없다.
- [ ] 쿼터뷰(남쪽에서 비스듬히)다. 탑뷰나 정측면이 아니다. (E 상징은 예외)
- [ ] 빛이 왼쪽 위에서 온다(왼쪽이 밝다).
- [ ] 배경이 단색 초록이고 물체에 초록이 섞이지 않았다.
- [ ] 우리/적 두 벌이 팀 색만 다르고 모양은 같다.
- [ ] 완성 크기로 줄였을 때도 무엇인지 알아본다(특히 랜드마크).
- [ ] 이모지 같은 장식, 실사 사진 느낌, 흐린 수채화 느낌이 없다.
- [ ] 다른 게임의 캐릭터·건물을 닮지 않았다.

## 4. 그림을 넘긴 뒤 AI가 하는 일

1. 초록 배경 지우기 → 완성 크기로 최근접 축소 → 파일 이름대로 `web/assets/` 아래에 저장.
2. 랜드마크·구청은 `scripts/build_map.mjs`의 `SPRITES`에 위치를 더하고 `web/js/sprites.js`의 `IMG`에 등록.
3. 지도에서 먼저 읽혀야 하는 순서(서울 모양 → 구 이름 → 점령 색 → 진군·경고 → 칸 이름)를 해치지 않는지 낮·밤 테마와 폰 폭 400px에서 확인하고, 하나씩 얹는다.
