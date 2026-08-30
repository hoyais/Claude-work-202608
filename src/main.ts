/**
 * 자전거 날씨 — 진입점.
 *
 * 실행 즉시 주행 화면으로 들어간다. 로그인·목록·설정 단계 없이
 * 위치 권한만 받으면 바로 동작한다.
 */

import './styles.css';
import type { AppState, RideContext, Theme } from './lib/types.ts';
import { render } from './ui/render.ts';
import { buildDisplay } from './ui/display.ts';
import { WeatherFeed, fetchWeather } from './data/client.ts';
import { initialBearing, averageAngle, type LatLon } from './lib/bearing.ts';
import { SCENARIOS, getScenario } from './data/mock.ts';

const USE_MOCK = import.meta.env['VITE_USE_MOCK'] === 'true';

/** 3 km/h 미만에서는 GPS 방위가 불안정해 판정을 보류한다. */
const MOVING_THRESHOLD_MS = 3 / 3.6;

/** 코너에서 지도 회전이 늦지 않도록 평활화는 짧게 잡는다. */
const HEADING_WINDOW = 5;

// ---------------------------------------------------------------- 목 모드

function runMock(): void {
  const bar = document.getElementById('devbar')!;
  bar.hidden = false;

  let currentId = SCENARIOS[0]!.id;

  const paint = () => {
    const s = getScenario(currentId);

    // 야간 시나리오만 테마를 강제하고, 나머지는 일출·일몰 계산을 그대로 쓴다
    const theme: Theme | undefined = s.id === 'night' ? 'night' : 'day';

    render({
      kind: 'ready',
      display: buildDisplay(s.weather, s.ride, { theme }),
    });

    bar.querySelectorAll('button').forEach((b) => {
      b.dataset['on'] = String(b.dataset['id'] === currentId);
    });
  };

  for (const s of SCENARIOS) {
    const btn = document.createElement('button');
    btn.textContent = s.name;
    btn.dataset['id'] = s.id;
    btn.addEventListener('click', () => {
      currentId = s.id;
      paint();
    });
    bar.appendChild(btn);
  }

  paint();

  // 스크린샷 도구가 특정 상태를 바로 잡을 수 있게 열어둔다
  (window as unknown as Record<string, unknown>)['__setScenario'] = (
    id: string,
  ) => {
    currentId = id;
    paint();
  };
}

// ---------------------------------------------------------------- 실 모드

function runLive(): void {
  const feed = new WeatherFeed(fetchWeather);
  const headings: number[] = [];
  let lastPos: LatLon | null = null;
  let lastHeading: number | null = null;

  const set = (s: AppState) => render(s);
  set({ kind: 'locating' });

  if (!('geolocation' in navigator)) {
    set({ kind: 'permission-denied' });
    return;
  }

  navigator.geolocation.watchPosition(
    async (p) => {
      const pos: LatLon = {
        lat: p.coords.latitude,
        lon: p.coords.longitude,
      };
      const speed = p.coords.speed ?? 0;
      const isMoving = speed >= MOVING_THRESHOLD_MS;

      // heading은 기기·브라우저에 따라 null로 오는 경우가 있다.
      // 그럴 때는 직전 두 지점의 방위각으로 대신한다.
      let raw = p.coords.heading;
      if ((raw === null || Number.isNaN(raw)) && lastPos && isMoving) {
        raw = initialBearing(lastPos, pos);
      }

      if (raw !== null && !Number.isNaN(raw) && isMoving) {
        headings.push(raw);
        if (headings.length > HEADING_WINDOW) headings.shift();
        lastHeading = averageAngle(headings) ?? lastHeading;
      }
      // 정지 중에는 직전 유효 방위를 유지한다 (lastHeading 그대로)

      lastPos = pos;

      const ride: RideContext = {
        position: pos,
        speed,
        heading: lastHeading,
        isMoving,
      };

      const weather = await feed.update(pos);
      if (!weather) {
        set({ kind: 'locating' });
        return;
      }

      set({ kind: 'ready', display: buildDisplay(weather, ride) });
    },
    (err) => {
      set(
        err.code === err.PERMISSION_DENIED
          ? { kind: 'permission-denied' }
          : { kind: 'locating' },
      );
    },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 20_000 },
  );

  keepAwake();
}

/** 거치대에 물린 채 쓰므로 화면이 꺼지면 안 된다. */
async function keepAwake(): Promise<void> {
  const nav = navigator as Navigator & {
    wakeLock?: { request(type: 'screen'): Promise<{ release(): void }> };
  };
  if (!nav.wakeLock) return;

  let lock: { release(): void } | null = null;

  const acquire = async () => {
    try {
      lock = await nav.wakeLock!.request('screen');
    } catch {
      // 배터리 절약 모드 등에서 거부될 수 있다. 앱은 계속 동작한다.
    }
  };

  await acquire();

  // 화면이 꺼졌다 돌아오면 잠금이 풀려 있으므로 다시 잡는다
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && lock === null) void acquire();
  });
}

// ----------------------------------------------------------------

if (USE_MOCK) runMock();
else runLive();
