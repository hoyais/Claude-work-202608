/**
 * 바람 영향도 판정.
 *
 * 좌표계 규약 — 여기서 부호를 틀리면 화면 전체가 조용히 잘못된 값을 보여준다.
 *
 *  - windFrom: 기상청 VEC. 바람이 **불어오는** 방향을 진북 기준 0–360°로 준다.
 *  - heading : 진행 방위. 진북 기준 0–360°.
 *  - 화살표  : 디자인 가이드에 따라 바람이 **가는** 방향을 가리킨다(불어오는 방향의 반대).
 */

import type { WindState, Intensity } from './types.ts';

/** 항상 양수를 돌려주는 나머지 연산. JS의 %는 음수를 그대로 남긴다. */
export function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** 0 이상 360 미만으로 정규화. */
export function normalizeDeg(deg: number): number {
  return mod(deg, 360);
}

/**
 * 진행 방향 기준 상대 풍향. -180 ~ +180.
 *
 *   0에 가까움  → 정면에서 불어옴 (맞바람)
 *   양수        → 오른쪽에서 불어옴
 *   음수        → 왼쪽에서 불어옴
 *   ±180        → 등 뒤에서 불어옴 (뒷바람)
 */
export function relativeAngle(windFrom: number, heading: number): number {
  return mod(windFrom - heading + 180, 360) - 180;
}

/** 상대각을 5단계로 분류. 정지·방위 불명 상태는 판정하지 않는다. */
export function classifyWind(
  windFrom: number,
  heading: number | null,
  isMoving: boolean,
): WindState {
  if (heading === null || !isMoving) return 'unknown';

  const theta = relativeAngle(windFrom, heading);
  const abs = Math.abs(theta);

  if (abs <= 45) return 'headwind';
  if (abs >= 135) return 'tailwind';
  return theta > 0 ? 'crossRight' : 'crossLeft';
}

/**
 * 화면 기준 화살표 회전각 (0° = 위쪽).
 *
 * 지도는 heading-up이므로 진행 방위만큼 이미 회전해 있다. 여기에 "바람이 가는 방향"
 * (= windFrom + 180)을 얹으면 아래 식이 된다.
 *
 *   맞바람  (windFrom == heading)       → 180°  아래(라이더 쪽)를 가리킴
 *   뒷바람  (windFrom == heading + 180) → 0°    위쪽을 가리킴
 *
 * 지도 위에 뿌리는 절대 풍향 화살표도 같은 회전 프레임 안에 있으므로 이 값을 그대로 쓴다.
 * 절대 방위로 그리면 지도가 회전할 때 화살표만 어긋난다.
 */
export function arrowDeg(windFrom: number, heading: number | null): number {
  // 방위를 모르면 지도를 회전시키지 않으므로(북쪽 고정) 절대 방위 그대로 그린다.
  const h = heading ?? 0;
  return normalizeDeg(windFrom - h + 180);
}

/** 풍속 3단계. 경계값은 디자인 가이드 04장 기준. */
export function intensity(speedMs: number): Intensity {
  if (speedMs < 3) return 'weak';
  if (speedMs < 7) return 'normal';
  return 'strong';
}

const STATE_LABEL: Record<WindState, string> = {
  headwind: '맞바람',
  crossLeft: '좌측풍',
  crossRight: '우측풍',
  tailwind: '뒷바람',
  unknown: '정지',
};

/** 화면에 표시할 한글 라벨. 라벨 폭을 고정해 상태 전환 시 글자가 움직이지 않게 한다. */
export function stateLabel(state: WindState): string {
  return STATE_LABEL[state];
}
