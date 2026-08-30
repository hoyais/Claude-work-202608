import { describe, it, expect } from 'vitest';
import { byteOffset, readGridPoint, GRID_NX, GRID_NY } from './gridfile.ts';

/** 실제 응답과 같은 형식의 격자 텍스트를 만든다. 값은 격자 인덱스 그대로. */
function makeGrid(value: (nx: number, ny: number) => number): string {
  const lines: string[] = [];
  for (let ny = 1; ny <= GRID_NY; ny++) {
    let line = '';
    for (let nx = 1; nx <= GRID_NX; nx++) {
      // 실제 응답과 동일한 9바이트 고정폭: 값 7자리 우측정렬 + ',' + ' '
      line += value(nx, ny).toFixed(2).padStart(7, ' ') + ', ';
      if (nx % 20 === 0 || nx === GRID_NX) {
        lines.push(line);
        line = '';
      }
    }
  }
  return lines.join('\n');
}

describe('byteOffset', () => {
  it('첫 값은 0에서 시작한다', () => {
    expect(byteOffset(1, 1)).toBe(0);
  });

  it('같은 행에서 20번째까지는 줄바꿈이 끼지 않는다', () => {
    expect(byteOffset(20, 1)).toBe(19 * 9);
  });

  it('21번째 값 앞에는 줄바꿈이 하나 들어간다', () => {
    expect(byteOffset(21, 1)).toBe(20 * 9 + 1);
  });

  it('다음 행은 8줄만큼 줄바꿈이 누적된다', () => {
    expect(byteOffset(1, 2)).toBe(GRID_NX * 9 + 8);
  });
});

describe('readGridPoint', () => {
  const grid = makeGrid((nx, ny) => (nx + ny / 1000) % 100);

  it('격자 곳곳에서 정확한 값을 읽는다', () => {
    for (const [nx, ny] of [
      [1, 1], [20, 1], [21, 1], [149, 1],
      [1, 2], [59, 126], [98, 76], [149, 253],
    ] as const) {
      const expected = Number((((nx + ny / 1000) % 100)).toFixed(2));
      expect(readGridPoint(grid, nx, ny), `nx=${nx} ny=${ny}`).toBeCloseTo(expected, 2);
    }
  });

  it('결측값(-99)은 null', () => {
    const missing = makeGrid(() => -99);
    expect(readGridPoint(missing, 59, 126)).toBeNull();
  });

  it('격자 범위를 벗어나면 null', () => {
    expect(readGridPoint(grid, 0, 1)).toBeNull();
    expect(readGridPoint(grid, 150, 1)).toBeNull();
    expect(readGridPoint(grid, 1, 0)).toBeNull();
    expect(readGridPoint(grid, 1, 254)).toBeNull();
  });

  it('잘린 응답에도 터지지 않는다', () => {
    expect(readGridPoint('', 59, 126)).toBeNull();
    expect(readGridPoint(grid.slice(0, 50), 149, 253)).toBeNull();
  });
});
