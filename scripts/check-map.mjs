/**
 * 지도가 실제로 뜨는지, heading-up 회전이 되는지 눈으로 확인한다.
 * S1 스파이크의 핵심 질문: MapLibre + MapTiler가 이 환경에서 실제로 동작하는가.
 *
 *   node scripts/check-map.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdir } from 'node:fs/promises';

/**
 * 이 샌드박스에서는 브라우저가 api.maptiler.com 으로 나가는 터널이 계속 끊긴다
 * (curl 은 정상 — 프록시와 크로미움 사이 문제). 타일 서버 없이도 검증하려고
 * 로컬 스타일을 끼워 넣는다. 확인 대상은 "타일 그림"이 아니라
 * WebGL 렌더링 · heading-up 회전 · 마커 위치다.
 */
const SEOUL = [126.9327, 37.5285];
const d = 0.004;
const testStyle = {
  version: 8,
  sources: {
    roads: {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [
          // 회전이 눈에 띄도록 비대칭 'ㄱ' 모양 + 북쪽으로 뻗는 가지
          {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates: [
                [SEOUL[0] - d, SEOUL[1] - d],
                [SEOUL[0] + d, SEOUL[1] - d],
                [SEOUL[0] + d, SEOUL[1] + d * 2],
              ],
            },
          },
          {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates: [
                [SEOUL[0], SEOUL[1]],
                [SEOUL[0], SEOUL[1] + d * 3],
              ],
            },
          },
        ],
      },
    },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#e8ece9' } },
    {
      id: 'roads',
      type: 'line',
      source: 'roads',
      paint: { 'line-color': '#7d8f88', 'line-width': 10 },
    },
  ],
};

const server = await createServer({
  server: { port: 5198 },
  define: {
    'import.meta.env.VITE_MAP_STYLE': JSON.stringify(JSON.stringify(testStyle)),
  },
});
await server.listen();
await mkdir('screenshots', { recursive: true });

// 이 샌드박스는 외부 HTTPS가 로컬 프록시를 거쳐야 한다. 브라우저는 이를
// 자동으로 읽지 않으므로 명시적으로 넘긴다.
const proxy = process.env.HTTPS_PROXY
  ? { server: process.env.HTTPS_PROXY }
  : undefined;

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  proxy: proxy ? { ...proxy, bypass: '<-loopback>,localhost,127.0.0.1' } : undefined,
  // 헤드리스 크로미움은 소프트웨어 WebGL이 기본 꺼져 있어 MapLibre가 못 뜬다
  args: [
    '--use-gl=angle',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
  ],
});

const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
});

const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (e) => consoleErrors.push(String(e)));
page.on('requestfailed', (req) => {
  console.log('  ✗ 요청 실패:', req.url(), '—', req.failure()?.errorText);
});

const resp = await page.goto('http://localhost:5198/', { waitUntil: 'load', timeout: 20000 }).catch((e) => {
  console.log('goto 실패:', e.message);
  return null;
});
console.log('goto 응답:', resp ? resp.status() : '없음');
await page.waitForFunction(() => '__setScenario' in window, { timeout: 15000 });

const debug = await page.evaluate(() => {
  const el = document.getElementById('maplibre');
  const canvas = el?.querySelector('canvas');
  return {
    컨테이너: el ? `${el.clientWidth}x${el.clientHeight}` : null,
    캔버스: canvas ? `${canvas.clientWidth}x${canvas.clientHeight}` : null,
    폴백숨김: document.getElementById('map-fallback')?.hidden,
  };
});
console.log('레이아웃:', JSON.stringify(debug));
await page.evaluate(() => window.__setScenario('headwind'));

// 타일 로딩 대기 (프록시 경유라 느릴 수 있다)
await page.waitForTimeout(1500);
await page.addStyleTag({ content: '.devbar{display:none !important}' });
await page.screenshot({ path: 'screenshots/map-north.png' });
console.log('✓ north (heading=0) 캡처');

// 회전 테스트: 90도로 틀어본다
await page.evaluate(() => window.__setHeading(90));
await page.waitForTimeout(600);
await page.screenshot({ path: 'screenshots/map-east.png' });
console.log('✓ east (heading=90) 캡처');

await page.evaluate(() => window.__setHeading(225));
await page.waitForTimeout(600);
await page.screenshot({ path: 'screenshots/map-sw.png' });
console.log('✓ southwest (heading=225) 캡처');

console.log('\n콘솔 에러/경고:', consoleErrors.length ? '' : '없음');
for (const e of consoleErrors) console.log(' ', e.slice(0, 200));

await browser.close();
await server.close();
