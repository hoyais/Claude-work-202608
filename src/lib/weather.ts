/** 체감온도 등 파생 값 계산. 추가 API 호출 없이 이미 받은 값으로만 구한다. */

/**
 * 체감온도.
 *
 * 기상청 기준을 따라 계절에 맞는 식을 고른다.
 *  - 겨울(기온 10°C 이하, 풍속 1.3 m/s 이상): 바람에 의한 체감온도(wind chill)
 *  - 여름(기온 25°C 이상): 습도에 의한 열지수 계열 근사
 *  - 그 밖(봄·가을 구간): 두 식 모두 적용 범위를 벗어나므로 기온을 그대로 쓴다
 *
 * 적용 범위를 벗어난 구간에서 억지로 식을 밀어넣으면 실제와 어긋난 값이 나오므로
 * 일부러 기온을 그대로 반환한다.
 */
export function feelsLike(
  tempC: number,
  windMs: number,
  humidityPct: number,
): number {
  if (tempC <= 10 && windMs >= 1.3) {
    const v = (windMs * 3.6) ** 0.16; // km/h로 변환 후 지수
    return round1(13.12 + 0.6215 * tempC - 11.37 * v + 0.3965 * v * tempC);
  }

  if (tempC >= 25) {
    // 습구온도 근사를 이용한 여름철 체감온도
    const tw = wetBulb(tempC, humidityPct);
    return round1(
      -0.2442 +
        0.55399 * tw +
        0.45535 * tempC -
        0.0022 * tw * tw +
        0.00278 * tw * tempC +
        3.0,
    );
  }

  return round1(tempC);
}

/** Stull 근사식으로 습구온도를 구한다. */
function wetBulb(tempC: number, humidityPct: number): number {
  const rh = clamp(humidityPct, 1, 100);
  return (
    tempC * Math.atan(0.151977 * Math.sqrt(rh + 8.313659)) +
    Math.atan(tempC + rh) -
    Math.atan(rh - 1.676331) +
    0.00391838 * rh ** 1.5 * Math.atan(0.023101 * rh) -
    4.686035
  );
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** m/s → km/h. */
export function toKmh(ms: number): number {
  return ms * 3.6;
}

/** 관측 시각이 얼마나 오래됐는지 (분). 신선하면 null. */
export function stalenessMinutes(
  observedAt: number,
  now: number,
  thresholdMin = 20,
): number | null {
  const min = Math.floor((now - observedAt) / 60_000);
  return min >= thresholdMin ? min : null;
}
