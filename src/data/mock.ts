/**
 * 목 데이터.
 *
 * API 키 승인을 기다리는 동안, 그리고 네트워크가 막힌 환경에서 UI를 검증하기 위한 것.
 * .env 에 VITE_USE_MOCK=true 를 두면 활성화된다.
 */

import type { WeatherSnapshot, RideContext } from '../lib/types.ts';

export type Scenario = {
  id: string;
  name: string;
  weather: WeatherSnapshot;
  ride: RideContext;
};

const SEOUL = { lat: 37.5285, lon: 126.9327 }; // 한강 여의도 부근

function snap(
  windSpeed: number,
  windFrom: number,
  over: Partial<WeatherSnapshot> = {},
): WeatherSnapshot {
  return {
    windSpeed,
    windFrom,
    temperature: 22,
    humidity: 55,
    sky: 'clear',
    precip: 'none',
    observedAt: Date.now(),
    ...over,
  };
}

function ride(heading: number | null, speedKmh: number): RideContext {
  return {
    position: SEOUL,
    speed: speedKmh / 3.6,
    heading,
    isMoving: speedKmh >= 3,
  };
}

/** 화면 검증용 시나리오. 네 가지 바람 상태 + 경계·예외 조건. */
export const SCENARIOS: Scenario[] = [
  {
    id: 'headwind',
    name: '맞바람',
    // 북쪽으로 주행 중 북북서풍 → 정면
    weather: snap(6.8, 337.5),
    ride: ride(0, 21),
  },
  {
    id: 'crossRight',
    name: '우측풍',
    // 북쪽으로 주행 중 동북동풍 → 오른쪽에서
    weather: snap(5.2, 67.5),
    ride: ride(0, 19),
  },
  {
    id: 'crossLeft',
    name: '좌측풍',
    weather: snap(5.9, 292.5),
    ride: ride(0, 23),
  },
  {
    id: 'tailwind',
    name: '뒷바람',
    // 북쪽으로 주행 중 남남동풍 → 등 뒤에서
    weather: snap(4.1, 157.5),
    ride: ride(0, 26),
  },
  {
    id: 'weak',
    name: '약한 바람',
    // 풍속이 낮으면 색을 옅게 — 잘못된 경고를 주지 않는다
    weather: snap(1.8, 337.5),
    ride: ride(0, 18),
  },
  {
    id: 'strong',
    name: '강풍',
    weather: snap(11.4, 337.5),
    ride: ride(0, 15),
  },
  {
    id: 'stopped',
    name: '정지',
    // 절대 풍향·풍속은 유지하고 상대 판정만 보류한다
    weather: snap(6.8, 337.5),
    ride: ride(null, 0),
  },
  {
    id: 'rain',
    name: '비 · 추움',
    weather: snap(7.2, 45, { temperature: 4, sky: 'cloudy', precip: 'rain', humidity: 88 }),
    ride: ride(90, 17),
  },
  {
    id: 'night',
    name: '야간',
    weather: snap(6.8, 337.5),
    ride: ride(0, 20),
  },
  {
    id: 'stale',
    name: '오래된 데이터',
    weather: snap(6.8, 337.5, { observedAt: Date.now() - 34 * 60_000 }),
    ride: ride(0, 20),
  },
];

export function getScenario(id: string): Scenario {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0]!;
}
