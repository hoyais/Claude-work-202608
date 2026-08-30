# 자전거 날씨

주행 중 **진행 방향 기준**으로 바람이 맞바람인지 뒷바람인지 보여주는 자전거용 PWA.

일반 날씨 앱은 "북서풍 6.8 m/s"라는 절대값만 준다. 라이더에게 필요한 건 내가 가는
방향 기준의 상대값이다. 앱을 켜면 곧바로 주행 화면이 뜨고, 거치대에 물린 채 흘긋
보면 판단이 끝난다.

## 현재 상태

| 단계 | 내용 | 상태 |
|---|---|---|
| S0 | 스캐폴딩 | ✅ |
| S3 | 계산 로직 + 단위 테스트 (37개) | ✅ |
| S4 | UI (목 데이터로 검증) | ✅ |
| S2 | 서버리스 프록시 (API 허브) | ✅ 초단기실황 **실 API 검증 완료** / 초단기예보는 활용신청 대기 |
| S1 | 지도 회전·GPS heading 스파이크 | ⏳ 실기기 필요 |
| S5 | PWA 셸 (manifest / SW) | ⏳ |
| S6 | 필드 테스트 | ⏳ |

기상청 **초단기실황은 실제 응답까지 확인**했다(바람·기온·습도·강수형태 정상).
**초단기예보는 아직 활용신청이 안 되어 403**이 나므로 하늘상태(맑음/흐림)를 받을 수 없다.
이 경우 `sky`는 `null`이 되고 화면은 기온만 보여준다 — 모르는 것을 "맑음"이라고
지어내지 않는다. 지도 타일은 아직 붙이지 않았고, 현재는 목 데이터 모드로 UI가 동작한다.

### 하늘상태를 받으려면

[API 허브](https://apihub.kma.go.kr)에서 **초단기예보(getUltraSrtFcst)** 를 추가로
활용신청해야 한다. 실황과 별개의 신청이다. 신청 전에는 다음 응답이 온다.

```json
{"result":{"status":403,"message":"활용신청이 필요한 API 입니다. 활용신청 후 다시 시도해 주십시오."}}
```

## 빠른 실행 (API 키 없이)

```bash
npm install
cp .env.example .env    # VITE_USE_MOCK=true 그대로 두면 됨
npm run dev             # → http://localhost:5173
```

목 모드에서는 화면 하단에 상태 전환 버튼이 뜬다. 맞바람·측풍·뒷바람·야간·강풍 등
10가지 시나리오를 눌러가며 확인할 수 있다.

## 실제 데이터 연결

### 1. 기상청 API 키

[기상청 API 허브](https://apihub.kma.go.kr)에서 **초단기실황·초단기예보**를 신청한다.

> 공공데이터포털(`apis.data.go.kr`)과 API 허브(`apihub.kma.go.kr`)는 같은
> `VilageFcstInfoService_2.0`을 서로 다른 게이트웨이로 제공한다. 인증 파라미터도
> 각각 `serviceKey` / `authKey`로 다르다. 이 프로젝트는 **API 허브** 기준이며,
> 공공데이터포털을 쓰려면 `KMA_BASE` 환경변수로 베이스 URL을 바꾸고 파라미터
> 이름을 함께 고쳐야 한다.

```bash
echo 'KMA_KEY=발급받은_인증키' > worker/.dev.vars   # gitignore 처리되어 있음
node scripts/verify-kma.mjs                        # 키와 응답 구조 확인
```

`verify-kma.mjs`는 인증키가 살아 있는지, 응답 구조가 worker의 파서 가정과 맞는지
확인한다. 실황/예보 각각의 활용신청 상태도 여기서 드러난다.

> **프록시 뒤에서 실행할 때** — Node의 내장 `fetch`는 `HTTPS_PROXY`를 읽지 않는다.
> Claude Code 클라우드 세션처럼 프록시를 거쳐야 하는 환경에서는
> `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt` 를 앞에 붙인다.
> 일반 로컬 환경에서는 그냥 실행하면 된다.

### 2. 프록시 실행

```bash
cd worker
npx wrangler dev        # → http://localhost:8787
```

### 3. 앱을 실 모드로

`.env`를 수정한다.

```
VITE_USE_MOCK=false
VITE_API_BASE=http://localhost:8787
VITE_MAPTILER_KEY=발급받은_키
```

### 4. 배포 (실기기 테스트용)

```bash
cd worker
npx wrangler secret put KMA_KEY
npx wrangler deploy
```

폰에서 라이딩 테스트를 하려면 배포가 사실상 필수다. Geolocation은 HTTPS에서만
동작하는데, 로컬 개발 서버에 폰으로 접속하면(`192.168.x.x`) HTTP라 위치를 못 읽는다.

## 명령

```bash
npm run dev         # 개발 서버
npm test            # 단위 테스트
npm run typecheck   # 타입 검사
npm run build       # 프로덕션 빌드
node scripts/shoot.mjs        # 목 데이터 상태를 스크린샷으로 저장 (screenshots/)
node scripts/verify-kma.mjs   # 기상청 API 키·응답 구조 확인
```

## 구조

```
src/
  lib/          순수 로직 — 여기가 이 앱의 실제 난이도
    wind.ts       상대 풍향 판정, 화살표 회전각
    bearing.ts    16방위, haversine, 방위각 평균
    grid.ts       위경도 → 기상청 격자 (DFS 변환)
    weather.ts    체감온도
    sun.ts        일출·일몰 (NOAA)
  data/
    client.ts     프록시 호출 + 1km 재조회 트리거
    mock.ts       목 시나리오
  ui/
    display.ts    스냅샷 + 주행상태 → 화면값
    render.ts     DOM 렌더링
worker/
  src/index.ts    기상청 프록시 (CORS·인증키·캐싱)
```

## 좌표 규약 — 건드리기 전에 읽을 것

부호를 틀리면 화면이 **조용히** 잘못된 값을 보여준다. 테스트가 이 규약을 지킨다.

- `windFrom` — 기상청 VEC. 바람이 **불어오는** 방향 (0–360, 진북 기준)
- `heading` — 진행 방위 (0–360, 진북 기준)
- 화살표 — 바람이 **가는** 방향을 가리킨다 (기상 관례와 반대)
- 화살표 SVG는 **0°에서 위쪽**을 가리키도록 그려져 있다

```
θ = ((windFrom - heading + 540) % 360) - 180   // -180 ~ +180

|θ| ≤ 45    맞바람        θ > 0  우측풍
|θ| ≥ 135   뒷바람        θ < 0  좌측풍
```

지도 위 절대 풍향 화살표도 **같은 회전각**을 쓴다. 지도가 heading-up으로 회전하므로,
절대 방위로 그리면 지도가 돌 때 화살표만 어긋난다.

## 확정된 설계 결정

- 계획 모드(적합도 지수·예보 그래프·즐겨찾기)는 **보류**. 주행 모드 단독
- 전방 시야 **750 m 고정** (z16). 속도 연동하지 않음 — 축척이 늘 같아야 눈에 익는다
- 화면 **세로 고정**
- 야간 전환은 시스템 다크 모드가 아니라 **일출·일몰 기준** (일몰 +20분 / 일출 −20분)
- 주행 기록 **저장하지 않음** → 계정·DB·개인정보 처리방침 불필요
- 알림 없음, 광고 없음, 완전 무료
- 돌풍(순간최대풍속)은 초단기실황 API에 **없어서 제외**
  (실제 응답 확인: `PTY, REH, RN1, T1H, UUU, VVV, VEC, WSD` — 돌풍 없음)
- 하늘상태를 모르면 `sky: null`. **추측해서 채우지 않는다**

## 알려진 제약

- **적록색약** — 맞바람(빨강)/뒷바람(초록)은 가장 구분이 어려운 조합이다.
  화살표 방향·텍스트 라벨·명도 차이를 보조 채널로 두었으나, 시뮬레이터 검증 필요
- **관측소 거리** — 초단기실황은 관측소 지점값이라 멀수록 오차가 커진다.
  화면에 거리를 표시하지 않기로 했으므로 사용자가 원인을 알 수 없다
- **Wake Lock** — iOS Safari 지원 여부 미검증. 미지원이면 네이티브 전환을 앞당길 근거
