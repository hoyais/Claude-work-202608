/**
 * 목 데이터 상태를 실제 브라우저로 렌더해 스크린샷을 남긴다.
 * 네트워크가 막힌 환경에서도 UI를 눈으로 확인하기 위한 검증 도구.
 *
 *   node scripts/shoot.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdir } from 'node:fs/promises';

const SHOTS = [
  'headwind',
  'crossRight',
  'crossLeft',
  'tailwind',
  'weak',
  'strong',
  'stopped',
  'rain',
  'night',
  'nosky',
  'stale',
];

const server = await createServer({ server: { port: 5199 } });
await server.listen();

await mkdir('screenshots', { recursive: true });

// 이 환경에는 Chromium이 미리 설치되어 있다. 버전이 다를 수 있으므로 경로를 직접 지정한다.
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage({
  viewport: { width: 390, height: 844 }, // iPhone 14 급
  deviceScaleFactor: 2,
});

await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => '__setScenario' in window);

// 개발용 패널은 화면을 가리므로 스크린샷에서는 숨긴다
await page.addStyleTag({ content: '.devbar{display:none !important}' });

for (const id of SHOTS) {
  await page.evaluate((s) => window.__setScenario(s), id);
  await page.waitForTimeout(420); // 크로스페이드 완료 대기
  await page.screenshot({ path: `screenshots/${id}.png` });
  console.log(`✓ ${id}`);
}

// 예외 화면
await page.evaluate(() => {
  document.getElementById('overlay').hidden = false;
  document.getElementById('overlay-title').textContent = '위치 권한이 필요합니다';
  document.getElementById('overlay-body').textContent =
    '진행 방향을 알아야 바람이 맞바람인지 뒷바람인지 계산할 수 있어요.';
  const b = document.getElementById('overlay-cta');
  b.hidden = false;
  b.textContent = '권한 허용하기';
});
await page.waitForTimeout(200);
await page.screenshot({ path: 'screenshots/permission.png' });
console.log('✓ permission');

await browser.close();
await server.close();
