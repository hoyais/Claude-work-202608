/**
 * 기상청 API 허브 격자 파일(typ01 `*_grd`) 읽기.
 *
 * 응답은 전국 격자를 통째로 담은 고정폭 텍스트다. 149×253 = 37,697개 값이
 * 값마다 정확히 9바이트(`  -3.00, ` 꼴)로 이어지고, 격자 한 행(149개)은
 * 20개씩 7줄 + 9개 1줄, 즉 8줄에 나뉘어 담긴다.
 *
 * 파일 하나가 341KB라 전부 파싱하면 Cloudflare Workers 무료 티어의 요청당
 * CPU 한도(10ms)를 넘길 수 있다. 우리는 격자점 하나만 필요하므로 바이트
 * 오프셋을 직접 계산해 그 자리만 잘라 읽는다.
 */

export const GRID_NX = 149;
export const GRID_NY = 253;

/** 값이 없는 격자(도메인 밖 등)를 나타내는 표식. */
const MISSING = -99;

const BYTES_PER_VALUE = 9;
const VALUES_PER_LINE = 20;
/** 격자 한 행이 차지하는 줄 수: ceil(149 / 20) = 8 */
const LINES_PER_ROW = Math.ceil(GRID_NX / VALUES_PER_LINE);

/**
 * 격자 좌표(nx, ny)의 값이 시작하는 바이트 위치.
 * ny=1이 파일의 첫 행이다(남쪽부터 위로).
 */
export function byteOffset(nx: number, ny: number): number {
  const nx0 = nx - 1;
  const ny0 = ny - 1;
  const index = ny0 * GRID_NX + nx0;
  const linesBefore = ny0 * LINES_PER_ROW + Math.floor(nx0 / VALUES_PER_LINE);
  return index * BYTES_PER_VALUE + linesBefore;
}

/**
 * 격자 텍스트에서 한 점의 값을 읽는다.
 * 범위 밖이거나 결측(-99)이면 null.
 */
export function readGridPoint(
  text: string,
  nx: number,
  ny: number,
): number | null {
  if (nx < 1 || nx > GRID_NX || ny < 1 || ny > GRID_NY) return null;

  const start = byteOffset(nx, ny);
  const slice = text.slice(start, start + BYTES_PER_VALUE);
  if (slice.length < BYTES_PER_VALUE - 1) return null;

  const value = Number.parseFloat(slice.replace(',', ' ').trim());
  if (!Number.isFinite(value) || value <= MISSING) return null;

  return value;
}
