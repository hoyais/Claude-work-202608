/**
 * 기상청 API 허브 연결 확인.
 *
 * 인증키가 살아 있는지, 응답 구조가 worker의 파서 가정과 맞는지 확인한다.
 * 클라우드 개발 환경에서는 외부 호출이 막혀 있어 검증할 수 없으므로,
 * 로컬에서 한 번 돌려 결과를 확인하는 용도다.
 *
 *   node scripts/verify-kma.mjs
 *
 * 키는 worker/.dev.vars 의 KMA_KEY 또는 환경변수에서 읽는다.
 *
 * 참고: 발표 시각 계산 로직은 worker/src/index.ts 와 같은 규칙을 쓴다.
 * 이 스크립트는 빌드 없이 돌아가야 해서 의도적으로 중복해 두었다.
 */

import { readFileSync } from 'node:fs';

const BASE =
  process.env.KMA_BASE ??
  'https://apihub.kma.go.kr/api/typ02/openApi/VilageFcstInfoService_2.0';

function readKey() {
  if (process.env.KMA_KEY) return process.env.KMA_KEY;
  try {
    const txt = readFileSync(new URL('../worker/.dev.vars', import.meta.url), 'utf8');
    const m = txt.match(/^\s*KMA_KEY\s*=\s*(.+?)\s*$/m);
    if (m) return m[1];
  } catch {
    /* 파일이 없으면 아래에서 안내 */
  }
  return null;
}

const KEY = readKey();
if (!KEY) {
  console.error('KMA_KEY 를 찾을 수 없습니다.');
  console.error('  worker/.dev.vars 에 KMA_KEY=... 를 넣거나');
  console.error('  KMA_KEY=... node scripts/verify-kma.mjs 로 실행하세요.');
  process.exit(1);
}

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
const toKst = (d) => d.getTime() + 9 * 3600_000;

/** 실황: 매시 정시 발표 + 약 40분 지연 */
function ncstBase(now) {
  const d = new Date(toKst(now));
  if (d.getUTCMinutes() < 40) d.setUTCHours(d.getUTCHours() - 1);
  d.setUTCMinutes(0, 0, 0);
  return { date: ymd(d), time: `${pad(d.getUTCHours())}00` };
}

/** 초단기예보: 매시 30분 발표 + 약 15분 지연 */
function fcstBase(now) {
  const d = new Date(toKst(now));
  if (d.getUTCMinutes() < 45) d.setUTCHours(d.getUTCHours() - 1);
  d.setUTCMinutes(30, 0, 0);
  return { date: ymd(d), time: `${pad(d.getUTCHours())}30` };
}

// 서울 여의도(37.5285, 126.9327) 격자.
// src/lib/grid.ts 의 toGrid 로 계산한 값이며 bearing.test.ts 가 이 변환을 검증한다.
const NX = 59;
const NY = 126;

async function call(op, base) {
  const url =
    `${BASE}/${op}?authKey=${encodeURIComponent(KEY)}` +
    `&pageNo=1&numOfRows=100&dataType=JSON` +
    `&base_date=${base.date}&base_time=${base.time}&nx=${NX}&ny=${NY}`;

  // 키가 로그에 남지 않도록 가린다
  console.log(`\n▶ ${op}  base_date=${base.date} base_time=${base.time}`);
  console.log(`  ${url.replace(KEY, '***')}`);

  const res = await fetch(url);
  console.log(`  HTTP ${res.status}`);

  const text = await res.text();

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    console.log('  ✗ JSON 파싱 실패 — 응답 앞부분:');
    console.log('  ' + text.slice(0, 400).replace(/\n/g, '\n  '));
    return null;
  }

  const header = body?.response?.header;
  console.log(`  resultCode=${header?.resultCode} resultMsg=${header?.resultMsg}`);

  const items = body?.response?.body?.items?.item;
  if (!Array.isArray(items)) {
    console.log('  ✗ items 구조가 예상과 다릅니다. 응답 전체:');
    console.log('  ' + JSON.stringify(body).slice(0, 600));
    return null;
  }

  return items;
}

const now = new Date();

console.log('기상청 API 허브 연결 확인');
console.log(`  base : ${BASE}`);
console.log(`  key  : ${KEY.slice(0, 4)}…${KEY.slice(-3)} (${KEY.length}자)`);
console.log(`  격자 : nx=${NX} ny=${NY}`);

// ---- 실황 (바람·기온) ----
const ncst = await call('getUltraSrtNcst', ncstBase(now));
if (ncst) {
  const map = Object.fromEntries(ncst.map((i) => [i.category, i.obsrValue]));
  console.log('\n  파싱 결과:');
  for (const c of ['WSD', 'VEC', 'T1H', 'REH', 'PTY']) {
    const v = map[c];
    console.log(`    ${c.padEnd(4)} = ${v ?? '(없음)'}`);
  }
  const missing = ['WSD', 'VEC', 'T1H', 'REH', 'PTY'].filter((c) => !(c in map));
  console.log(
    missing.length
      ? `  ✗ 빠진 항목: ${missing.join(', ')}`
      : '  ✓ worker 파서가 기대하는 항목이 모두 있습니다',
  );
  console.log(`  (참고) 전체 category: ${ncst.map((i) => i.category).join(', ')}`);
}

// ---- 초단기예보 (하늘상태) ----
const fcst = await call('getUltraSrtFcst', fcstBase(now));
if (fcst) {
  const sky = fcst.find((i) => i.category === 'SKY');
  console.log('\n  파싱 결과:');
  console.log(`    SKY  = ${sky?.fcstValue ?? '(없음)'}  (1 맑음 / 3 구름많음 / 4 흐림)`);
  console.log(
    sky ? '  ✓ 하늘상태를 읽을 수 있습니다' : '  ✗ SKY 항목이 없습니다',
  );
  const cats = [...new Set(fcst.map((i) => i.category))];
  console.log(`  (참고) 전체 category: ${cats.join(', ')}`);
}

console.log('\n완료. 위 출력을 그대로 공유해 주시면 파서를 맞추겠습니다.');
