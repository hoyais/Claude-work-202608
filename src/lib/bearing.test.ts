import { describe, it, expect } from 'vitest';
import { haversine, initialBearing, toKorean16, averageAngle } from './bearing.ts';
import { toGrid, fromGrid } from './grid.ts';

describe('haversine', () => {
  it('같은 지점은 0', () => {
    const p = { lat: 37.5, lon: 127.0 };
    expect(haversine(p, p)).toBe(0);
  });

  it('위도 1도는 약 111km', () => {
    const d = haversine({ lat: 37, lon: 127 }, { lat: 38, lon: 127 });
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });

  it('1km 판정에 쓸 만한 정밀도가 나온다', () => {
    // 위도 37.5°에서 경도 0.01136° ≈ 1km
    const d = haversine({ lat: 37.5, lon: 127.0 }, { lat: 37.5, lon: 127.01136 });
    expect(d).toBeGreaterThan(950);
    expect(d).toBeLessThan(1050);
  });
});

describe('initialBearing', () => {
  it('정북은 0도', () => {
    const b = initialBearing({ lat: 37.5, lon: 127 }, { lat: 37.6, lon: 127 });
    expect(b).toBeCloseTo(0, 1);
  });

  it('정동은 90도', () => {
    const b = initialBearing({ lat: 37.5, lon: 127 }, { lat: 37.5, lon: 127.1 });
    expect(b).toBeCloseTo(90, 1);
  });

  it('정남은 180도', () => {
    const b = initialBearing({ lat: 37.5, lon: 127 }, { lat: 37.4, lon: 127 });
    expect(b).toBeCloseTo(180, 1);
  });

  it('정서는 270도', () => {
    const b = initialBearing({ lat: 37.5, lon: 127 }, { lat: 37.5, lon: 126.9 });
    expect(b).toBeCloseTo(270, 1);
  });
});

describe('toKorean16', () => {
  it('주요 방위를 정확히 매핑한다', () => {
    expect(toKorean16(0)).toBe('북');
    expect(toKorean16(90)).toBe('동');
    expect(toKorean16(180)).toBe('남');
    expect(toKorean16(270)).toBe('서');
    expect(toKorean16(337.5)).toBe('북북서');
    expect(toKorean16(45)).toBe('북동');
  });

  it('360도는 북으로 돌아온다', () => {
    expect(toKorean16(360)).toBe('북');
    expect(toKorean16(359)).toBe('북');
  });

  it('구간 경계에서 인접 방위로 넘어간다', () => {
    expect(toKorean16(11)).toBe('북');
    expect(toKorean16(12)).toBe('북북동');
  });
});

describe('averageAngle', () => {
  it('빈 배열은 null', () => {
    expect(averageAngle([])).toBeNull();
  });

  it('0/360 경계를 올바르게 평균낸다', () => {
    // 산술 평균이면 180이 되어버리는 케이스
    const avg = averageAngle([350, 10]);
    expect(avg).not.toBeNull();
    expect(Math.min(avg!, 360 - avg!)).toBeLessThan(1);
  });

  it('일반 구간은 산술 평균과 같다', () => {
    expect(averageAngle([80, 100])!).toBeCloseTo(90, 5);
  });
});

describe('기상청 격자 변환', () => {
  it('서울 좌표가 알려진 격자로 변환된다', () => {
    // 서울 종로구 일대 → 기상청 예제 격자 (60, 127)
    const g = toGrid(37.5779, 126.9768);
    expect(g.nx).toBe(60);
    expect(g.ny).toBe(127);
  });

  it('왕복 변환이 원래 좌표 근처로 돌아온다', () => {
    const lat = 37.5;
    const lon = 127.0;
    const g = toGrid(lat, lon);
    const back = fromGrid(g.nx, g.ny);

    // 격자가 5km 단위이므로 오차를 그 범위로 본다
    expect(Math.abs(back.lat - lat)).toBeLessThan(0.05);
    expect(Math.abs(back.lon - lon)).toBeLessThan(0.05);
  });

  it('가까운 좌표는 같은 격자로 수렴한다 (캐시 적중의 근거)', () => {
    // 500m 남짓 떨어진 두 지점
    const a = toGrid(37.5000, 127.0000);
    const b = toGrid(37.5030, 127.0030);
    expect(a).toEqual(b);
  });
});
