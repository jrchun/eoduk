# 프로젝트 규칙 (새 프로젝트 시작 틀)

## 언어: 항상 한국어 (가장 먼저 지킬 것)
- 이 저장소에서 하는 모든 대화는 **한국어**로 한다. 세션이 새로 시작돼도, 사용자가 짧게 말해도, 영어로 된 도구 출력·오류·문서를 읽은 뒤에도 마찬가지다.
- 진행 알림, 질문, 보고, 오류 설명, 승인 창을 띄우기 전 설명, 커밋 메시지, PR 제목·설명, 코드 주석, 문서까지 모두 한국어로 쓴다.
- 사용자는 개발 지식이 많지 않다. 전문 용어는 처음 나올 때 쉬운 말로 풀어 쓴다. 예: "배포(사이트에 올리기)", "PR(변경을 합쳐 달라는 요청)", "Merge(합치기)".
- 명령어, 파일 이름, 오류 원문은 그대로 두되 무슨 뜻인지 한국어로 덧붙인다.
- 무엇을 할지 먼저 한 줄로 말하고, 끝나면 결과(된 것, 안 된 것, 사람이 할 일)를 말한다.

**새 앱을 만들거나 배포하라는 요청이면 먼저 `docs/AGENT_SETUP.md`를 읽고 그 순서를 따른다.** (Codex 등은 `AGENTS.md`)
Cloudflare·Supabase 연결은 MCP(브라우저 로그인)로 한다. **API 토큰을 만들게 하지 않는다.** 앱마다 사용자 계정의 GitHub 저장소가 있고, `main`에 올리면 Cloudflare가 자동 배포한다.

내 도메인: woongstudio.com
- 앱 주소는 `https://<앱이름>.<내 도메인>`(예: `gym-log.woongstudio.com`). 이 줄 한 곳에만 둔다. `cf_mcp.mjs fill`이 읽어 `wrangler.toml`에 넣고, Cloudflare가 DNS·인증서를 자동으로 만든다. 옛 `workers.dev` 주소도 예비로 계속 열린다. 비어 있으면(`(아직 없음)`) `workers.dev` 주소만 쓴다. 이 틀을 다른 사람이 복사해 쓰면 `(아직 없음)`으로 비우거나 자기 도메인으로 바꾼다(도메인은 같은 Cloudflare 계정에 있어야 한다). 자세한 것은 `docs/DOMAIN.md`.

허브 주소: https://hub.woongstudio.com
- 앱 허브(만든 앱들을 모아 보여 주는 페이지)의 주소. 이 줄 한 곳에만 둔다. 비어 있으면(`(아직 없음)`) 허브 등록을 건너뛴다(`docs/AGENT_SETUP.md` 7절). 이 틀을 다른 사람이 복사해 쓰면 `(아직 없음)`으로 비우거나 자기 허브 주소로 바꾼다.

## 구성
- 이 앱: **어둑시니**. 동네(구)끼리 헥스 칸(등불)을 빼앗고 밤에는 어둠을 버티는 지도 땅따먹기 웹게임. 규칙·숫자·구조·데이터 흐름은 `README.md`.
- **Supabase 모드**(사람마다 로그인). 규칙 판정은 전부 `supabase/schema.sql`의 함수에 있다. 표는 읽기만 열고, 쓰기는 `security definer` 함수로만 한다. 내부 함수는 `private` 스키마.
- 숫자를 바꾸면 `web/js/rules.js`(화면 미리보기·테스트)와 `supabase/schema.sql`(실제 판정) **둘 다** 고친다.
- `web/js/`: `rules.js`·`view.js`는 순수 함수(테스트 `tests/rules.test.js`), `map.js` 지도 그리기, `sprites.js` 도트 그림, `story.js` 온보딩·공유 카드, `app.js` 화면 동작.
- **온보딩 그림·공유 카드 지도는 따로 그리지 않는다.** `story.js`가 실제 지도 그리기(`MapView`, `opts.size`·`interactive:false`)로 장면을 만든다. 그래서 지도 디자인을 바꾸면 온보딩도 저절로 같이 바뀐다. 장면 연출(잿빛 칸, 진군 등)만 `SCENES`에서 고친다. 새 홍보·안내 그림이 필요해도 같은 방식으로 만든다.
- 둘러보는 중(구 없음)에는 지도 전체를 안개 없이 보여 준다. 줄여 보면 칸 이름 대신 구 이름표(구 이름 + 등불 칸 수).
- 테마는 게임 시간이 정한다(낮 `data-theme="day"`, 밤·봉인 `night`). 시스템 다크모드를 따르지 않는다. "라이트·다크 확인"은 낮·밤 두 테마로 한다.
- 지도는 `scripts/build_map.mjs`가 `data/geo`에서 만든다(`web/data/map.json`, `supabase/seed.sql`). 칸 번호가 바뀌므로 시즌 사이에만 바꾼다.
- `src/jobs.js`: 10분마다(`*/10 * * * *`) `rpc/tick`. 진군 도착은 지연 계산이라 이 작업은 예비이고, 밤 침식·자정 기록·시즌 정산을 맡는다.
- `web/app.json`·`web/og.png`·`/api/health`의 `starter`: 앱 허브가 읽는 자기소개서·대표 화면·상태(`docs/HUB.md`).
- `src/worker.js`: `/api/*`만 처리(Supabase 모드라 `/api/health`만 쓴다). `wrangler.toml`이 Worker 설정의 기준. 배포 절차와 함정은 `docs/SETUP.md`.
- `scripts/cf_mcp.mjs`: Cloudflare MCP `execute`에 넘길 코드를 만든다(`address`·`prepare`·`fill`·`connect`·`domain`·`status`). 순서는 `docs/AGENT_SETUP.md`.
- 클라우드 세션은 개인 환경 "woong-apps eoduk"(Supabase·사이트·허브 주소 허용)에서 한다.

## 지켜야 할 것
- 화면은 빌드 없는 정적 파일. React·번들러·CSS 프레임워크를 들이지 않는다. 외부 스크립트는 글꼴(Google Fonts)만.
- **이모지를 쓰지 않는다**: 화면, 문구, 자기소개서(`app.json`), 문서, 커밋·PR까지. AI가 만든 티가 난다. 아이콘이 필요하면 글자, 일반 기호(✕ 등), 직접 그린 SVG로.
- 색은 `web/styles.css`의 CSS 변수만 쓴다. **라이트·다크와 폰 폭 400px을 매번 확인**한다(가로 스크롤 없음).
- 읽기는 누구나, 쓰기는 편집 권한이 있어야 한다. **허브 로그인**(D1 모드 + 내 도메인 + 같은 도메인의 허브, `wrangler.toml` `HUB_URL`): 허브에서 한 번 로그인하면 내 앱 전부 편집(`docs/HUB.md` "허브 로그인"). 그 밖의 앱은 사람이 사이트에서 처음 저장할 때 편집 암호를 화면에서 정한다(D1 `settings`에 해시로 저장, `src/api/password.js`). 대시보드 Secret `WRITE_TOKEN`은 어느 경우든 통한다(비상용). 암호 원문을 채팅·저장소에 두지 않는다.
- 모르는 외부 API 사양은 추측하지 말고 공식 문서를 확인한다(Cloudflare 문서는 `https://developers.cloudflare.com/<경로>/index.md`로 마크다운을 받을 수 있다).
- 계산·규칙은 DOM에 접근하지 않는 순수 함수로 두고 `tests/`에 테스트를 붙인다.
- 큰 기능을 바꾸면 `web/app.json`의 `updatedAt`을 그날 날짜로 고친다(화면이 크게 바뀌면 `og.png`도 다시 찍는다). `app.json`은 누구나 볼 수 있고, `public: false`는 허브에서 링크만 숨기는 표시일 뿐 보안 장치가 아니다.

## 작업 흐름
1. 고친 뒤 `npm test`(node + python 테스트)와 로컬 실행(`npx wrangler@4 dev`, 편집 암호는 `.dev.vars`)으로 확인한다.
2. 고친 것은 PR로 올리고, `npm test` 통과와 화면 확인이 끝나면 **AI가 직접 Merge한다**(사용자가 미리 허락함. 사용자가 "합치기 전에 보여 줘"라고 했거나 데이터를 지우는 변경이면 기다린다). `main`에 들어가면 Cloudflare(Workers Builds)가 자동 배포한다. 앱의 첫 연결은 AI가 `cf_mcp.mjs connect`로 하고, 안 되면 사람이 Cloudflare "만들기 › GitHub"를 한다. 배포 뒤 **반드시** `node scripts/check_site.mjs <사이트 주소>`로 실제 사이트를 확인하고, 화면은 브라우저로 폰 폭에서 본다. "배포했습니다"로 끝내지 않는다.
3. 사람에게 맡겨야 하는 일(AI가 못 한 Cloudflare 연결, 사이트에서 편집 암호 정하기, Supabase 설정 클릭)은 `docs/AGENT_SETUP.md`·`docs/SETUP.md`의 해당 줄과 함정을 그대로 안내한다. 그 밖의 일로 사람을 부르지 않는다.
4. 미뤄 둔 일은 `docs/BACKLOG.md`에 적는다(기능 완성도가 디자인보다 먼저). 사용자가 "백로그 진행"이라고 하면 거기서 꺼내 처리한다.

## 실행
- 로컬: `cp .dev.vars.example .dev.vars && npx wrangler@4 d1 execute <이름> --local --file db/schema.sql && npx wrangler@4 dev` (예약 작업 시험: `--test-scheduled` 후 `/__scheduled`)
- 테스트: `npm test`
- 배포 확인: `npm run check -- https://<이름>.<내 도메인>` (내 도메인이 없으면 `https://<이름>.<계정>.workers.dev`)
- Cloudflare 준비·연결: `node scripts/cf_mcp.mjs prepare --name <저장소 이름>` → 생긴 `.wrangler/mcp/prepare.js`를 MCP `execute`로 → `fill`(내 도메인 주소도 넣음) → PR Merge → `connect`(GitHub 번호는 `gh api -X GET search/repositories`) → 첫 배포 뒤 `domain`으로 주소가 붙었는지 확인
