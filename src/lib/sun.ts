/**
 * 일출·일몰 시각 계산 (NOAA 태양 위치 알고리즘).
 *
 * 야간 모드 전환에 쓴다. 위경도와 날짜만으로 계산되므로 외부 API 의존성이 없다.
 * 시스템 다크 모드를 따르지 않는 이유는 디자인 가이드 08장 참고.
 */

import type { Theme } from './types.ts';

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/** 태양 중심이 지평선 아래 0.833°일 때를 일출·일몰로 본다(대기 굴절 + 태양 반지름). */
const ZENITH = 90.833;

/** 박명을 고려한 여유. 일몰 후 20분에 야간 진입, 일출 20분 전에 주간 복귀. */
export const TWILIGHT_MARGIN_MS = 20 * 60_000;

type SunTimes = { sunrise: Date; sunset: Date } | null;

/**
 * 해당 날짜의 일출·일몰 시각.
 * 극지방처럼 해가 뜨거나 지지 않는 날은 null을 반환한다.
 */
export function sunTimes(date: Date, lat: number, lon: number): SunTimes {
  const dayOfYear = getDayOfYear(date);

  // 태양 적위와 균시차 (fractional year 기준 근사)
  const gamma = ((2 * Math.PI) / 365) * (dayOfYear - 1 + 0.5);

  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));

  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);

  const latR = toRad(lat);

  const cosHa =
    Math.cos(toRad(ZENITH)) / (Math.cos(latR) * Math.cos(decl)) -
    Math.tan(latR) * Math.tan(decl);

  // 백야 / 극야
  if (cosHa > 1 || cosHa < -1) return null;

  const ha = toDeg(Math.acos(cosHa));

  // UTC 기준 분
  const sunriseMin = 720 - 4 * (lon + ha) - eqTime;
  const sunsetMin = 720 - 4 * (lon - ha) - eqTime;

  return {
    sunrise: utcMinutesToDate(date, sunriseMin),
    sunset: utcMinutesToDate(date, sunsetMin),
  };
}

/**
 * 지금이 주간인지 야간인지.
 * 일출·일몰을 구할 수 없는 경우에는 주간으로 둔다(밝은 화면이 안전한 기본값).
 */
export function resolveTheme(
  now: Date,
  lat: number,
  lon: number,
): Theme {
  const times = sunTimes(now, lat, lon);
  if (!times) return 'day';

  const t = now.getTime();
  const dayStart = times.sunrise.getTime() - TWILIGHT_MARGIN_MS;
  const dayEnd = times.sunset.getTime() + TWILIGHT_MARGIN_MS;

  return t >= dayStart && t < dayEnd ? 'day' : 'night';
}

function getDayOfYear(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const cur = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
  return Math.floor((cur - start) / 86_400_000) + 1;
}

function utcMinutesToDate(date: Date, minutes: number): Date {
  const base = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
  return new Date(base + minutes * 60_000);
}
