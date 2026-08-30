/**
 * 위경도 ↔ 기상청 격자(nx, ny) 변환.
 *
 * 기상청이 공개한 DFS 좌표 변환(람베르트 정각원추 투영)을 그대로 옮긴 것.
 * 격자는 5×5km 단위이므로, 가까운 위치의 사용자들이 같은 (nx, ny)로 수렴한다.
 * → 프록시 캐시 키로 쓰면 기상청 호출량이 사용자 수가 아니라 격자 수에 비례한다.
 */

const RE = 6371.00877; // 지구 반경 (km)
const GRID = 5.0; // 격자 간격 (km)
const SLAT1 = 30.0; // 투영 위도 1 (deg)
const SLAT2 = 60.0; // 투영 위도 2 (deg)
const OLON = 126.0; // 기준점 경도 (deg)
const OLAT = 38.0; // 기준점 위도 (deg)
const XO = 43; // 기준점 X 격자
const YO = 136; // 기준점 Y 격자

const DEGRAD = Math.PI / 180.0;

const re = RE / GRID;
const slat1 = SLAT1 * DEGRAD;
const slat2 = SLAT2 * DEGRAD;
const olon = OLON * DEGRAD;
const olat = OLAT * DEGRAD;

const sn =
  Math.log(Math.cos(slat1) / Math.cos(slat2)) /
  Math.log(
    Math.tan(Math.PI * 0.25 + slat2 * 0.5) /
      Math.tan(Math.PI * 0.25 + slat1 * 0.5),
  );

const sf =
  (Math.tan(Math.PI * 0.25 + slat1 * 0.5) ** sn * Math.cos(slat1)) / sn;

const ro = (re * sf) / Math.tan(Math.PI * 0.25 + olat * 0.5) ** sn;

export type Grid = { nx: number; ny: number };

/** 위경도 → 기상청 격자. */
export function toGrid(lat: number, lon: number): Grid {
  const ra =
    (re * sf) / Math.tan(Math.PI * 0.25 + lat * DEGRAD * 0.5) ** sn;

  let theta = lon * DEGRAD - olon;
  if (theta > Math.PI) theta -= 2 * Math.PI;
  if (theta < -Math.PI) theta += 2 * Math.PI;
  theta *= sn;

  return {
    nx: Math.floor(ra * Math.sin(theta) + XO + 0.5),
    ny: Math.floor(ro - ra * Math.cos(theta) + YO + 0.5),
  };
}

/** 격자 → 위경도 (격자 중심). 검산과 디버깅에 쓴다. */
export function fromGrid(nx: number, ny: number): { lat: number; lon: number } {
  const xn = nx - XO;
  const yn = ro - ny + YO;

  let ram = Math.sqrt(xn * xn + yn * yn);
  if (sn < 0) ram = -ram;

  const alat = 2 * Math.atan((re * sf / ram) ** (1 / sn)) - Math.PI * 0.5;

  let theta: number;
  if (Math.abs(xn) <= 0) {
    theta = 0;
  } else if (Math.abs(yn) <= 0) {
    theta = Math.PI * 0.5;
    if (xn < 0) theta = -theta;
  } else {
    theta = Math.atan2(xn, yn);
  }

  const alon = theta / sn + olon;

  return { lat: alat / DEGRAD, lon: alon / DEGRAD };
}
