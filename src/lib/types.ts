/** 런타임 타입. 저장소가 없으므로 영속 스키마는 없다. */

export type WindState =
  | 'headwind'
  | 'crossLeft'
  | 'crossRight'
  | 'tailwind'
  | 'unknown';

export type Intensity = 'weak' | 'normal' | 'strong';

export type Sky = 'clear' | 'partly' | 'cloudy';

export type Precip = 'none' | 'rain' | 'snow' | 'sleet' | 'shower';

export type Theme = 'day' | 'night';

/** 프록시가 정규화해서 돌려주는 관측 스냅샷. */
export type WeatherSnapshot = {
  /** m/s (WSD) */
  windSpeed: number;
  /** 0–360, 바람이 불어오는 방향 (VEC) */
  windFrom: number;
  /** °C (T1H) */
  temperature: number;
  /** % (REH) — 체감온도 계산에 쓴다 */
  humidity: number;
  /** 하늘상태. 초단기예보를 못 받으면 null (모른다는 뜻). */
  sky: Sky | null;
  precip: Precip;
  /** 관측 시각 (epoch ms). 오래된 값 경고에 쓴다. */
  observedAt: number;
};

/** GPS에서 읽어온 현재 주행 상태. */
export type RideContext = {
  position: { lat: number; lon: number };
  /** m/s */
  speed: number;
  /** 0–360, 확보 실패 시 null */
  heading: number | null;
  /** 3 km/h 이상 */
  isMoving: boolean;
};

/** 화면이 그리기 위해 필요한 모든 것. */
export type Display = {
  state: WindState;
  label: string;
  /** 화면 기준 화살표 회전각 */
  arrowDeg: number;
  intensity: Intensity;
  windSpeed: number;
  /** '북북서' */
  bearingKo: string;
  temperature: number;
  feelsLike: number;
  sky: Sky | null;
  precip: Precip;
  theme: Theme;
  /** km/h */
  speedKmh: number;
  /** 데이터가 오래됐을 때 경과 분, 정상이면 null */
  staleMinutes: number | null;
};

/** 화면 전체가 처할 수 있는 상태. 모든 실패에 화면이 있어야 한다. */
export type AppState =
  | { kind: 'ready'; display: Display }
  | { kind: 'permission-denied' }
  | { kind: 'locating' }
  | { kind: 'offline'; display: Display };
