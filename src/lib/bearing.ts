/** 방위·거리 계산. */

import { normalizeDeg } from './wind.ts';

const R = 6_371_000; // 지구 반경 (m)

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export type LatLon = { lat: number; lon: number };

/** 두 지점 사이 거리 (m). 1km 재조회 판정에 쓴다. */
export function haversine(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * a에서 b로 향하는 초기 방위각 (0–360).
 * Geolocation의 coords.heading이 null일 때 직전 두 위치로 진행 방향을 추정한다.
 */
export function initialBearing(a: LatLon, b: LatLon): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

  return normalizeDeg(toDeg(Math.atan2(y, x)));
}

const COMPASS_16 = [
  '북', '북북동', '북동', '동북동',
  '동', '동남동', '남동', '남남동',
  '남', '남남서', '남서', '서남서',
  '서', '서북서', '북서', '북북서',
] as const;

/** 각도를 16방위 한글로. 22.5° 구간으로 나눈다. */
export function toKorean16(deg: number): string {
  const idx = Math.round(normalizeDeg(deg) / 22.5) % 16;
  return COMPASS_16[idx]!;
}

/**
 * 각도 배열의 평균. 0°/360° 경계를 넘어가는 경우를 벡터 평균으로 처리한다.
 * (359°와 1°의 산술 평균은 180°가 되어버린다.)
 * heading 평활화에 쓴다.
 */
export function averageAngle(degrees: readonly number[]): number | null {
  if (degrees.length === 0) return null;

  let sx = 0;
  let sy = 0;
  for (const d of degrees) {
    const r = toRad(d);
    sx += Math.cos(r);
    sy += Math.sin(r);
  }

  // 정확히 반대 방향들이 상쇄되면 평균이 정의되지 않는다.
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) return null;

  return normalizeDeg(toDeg(Math.atan2(sy, sx)));
}
