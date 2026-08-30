/**
 * 날씨 데이터 조회와 재조회 트리거.
 *
 * 서버리스 프록시를 거치는 이유는 세 가지다.
 *  1. 기상청 API는 CORS 헤더를 주지 않아 브라우저가 직접 호출할 수 없다
 *  2. 인증키를 클라이언트에 노출할 수 없다
 *  3. 관측소 단위 캐싱으로 기상청 호출량을 사용자 수와 무관하게 만든다
 */

import type { WeatherSnapshot } from '../lib/types.ts';
import { haversine, type LatLon } from '../lib/bearing.ts';

/** 마지막 조회 지점에서 이 거리를 넘으면 다시 읽는다. */
export const REFETCH_DISTANCE_M = 1000;

/** 관측이 10분 주기이므로 그 이상 묵히지 않는다. */
export const REFETCH_INTERVAL_MS = 10 * 60_000;

type FetchMark = { pos: LatLon; at: number };

/**
 * 재조회가 필요한지 판단한다.
 * 1km 이동 또는 10분 경과 중 **먼저 오는 쪽**에 다시 읽는다.
 *
 * 1km 이동만으로는 가장 가까운 관측소가 바뀌지 않는 경우가 많지만,
 * 서버 엣지 캐시가 중복 호출을 흡수하므로 클라이언트는 단순하게 둔다.
 */
export function shouldRefetch(
  last: FetchMark | null,
  current: LatLon,
  now: number,
): boolean {
  if (last === null) return true;
  if (now - last.at >= REFETCH_INTERVAL_MS) return true;
  return haversine(last.pos, current) >= REFETCH_DISTANCE_M;
}

/** 재조회 상태를 들고 있는 작은 컨트롤러. */
export class WeatherFeed {
  private last: FetchMark | null = null;
  private snapshot: WeatherSnapshot | null = null;
  private inFlight = false;

  constructor(
    private readonly load: (pos: LatLon) => Promise<WeatherSnapshot>,
    private readonly now: () => number = () => Date.now(),
  ) {}

  current(): WeatherSnapshot | null {
    return this.snapshot;
  }

  /** 위치가 갱신될 때마다 호출한다. 필요할 때만 실제로 네트워크를 탄다. */
  async update(pos: LatLon): Promise<WeatherSnapshot | null> {
    const now = this.now();
    if (this.inFlight || !shouldRefetch(this.last, pos, now)) {
      return this.snapshot;
    }

    this.inFlight = true;
    try {
      this.snapshot = await this.load(pos);
      this.last = { pos, at: now };
    } catch {
      // 통신이 끊겨도 마지막 값을 유지한다. 산간·터널을 지나는 라이더에게는
      // "정보 없음"보다 "10분 전 정보"가 훨씬 유용하다.
      // 오래된 정도는 observedAt으로 화면에 표시된다.
    } finally {
      this.inFlight = false;
    }

    return this.snapshot;
  }
}

/** 프록시에서 스냅샷을 가져온다. */
export async function fetchWeather(pos: LatLon): Promise<WeatherSnapshot> {
  const base = import.meta.env['VITE_API_BASE'] ?? '/api';
  const url = `${base}/weather?lat=${pos.lat.toFixed(5)}&lon=${pos.lon.toFixed(5)}`;

  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`weather ${res.status}`);

  return (await res.json()) as WeatherSnapshot;
}
