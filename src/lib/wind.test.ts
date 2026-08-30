import { describe, it, expect } from 'vitest';
import {
  mod,
  normalizeDeg,
  relativeAngle,
  classifyWind,
  arrowDeg,
  intensity,
} from './wind.ts';

describe('mod', () => {
  it('음수에서도 양수를 돌려준다', () => {
    expect(mod(-10, 360)).toBe(350);
    expect(mod(-370, 360)).toBe(350);
    expect(mod(370, 360)).toBe(10);
  });
});

describe('normalizeDeg', () => {
  it('0 이상 360 미만으로 접는다', () => {
    expect(normalizeDeg(0)).toBe(0);
    expect(normalizeDeg(360)).toBe(0);
    expect(normalizeDeg(-90)).toBe(270);
    expect(normalizeDeg(450)).toBe(90);
  });
});

describe('relativeAngle', () => {
  it('정면에서 불어오면 0', () => {
    expect(relativeAngle(0, 0)).toBe(0);
    expect(relativeAngle(180, 180)).toBe(0);
  });

  it('오른쪽에서 불어오면 양수', () => {
    // 북쪽으로 주행 중 동풍(동에서 불어옴) → 오른쪽
    expect(relativeAngle(90, 0)).toBe(90);
  });

  it('왼쪽에서 불어오면 음수', () => {
    // 북쪽으로 주행 중 서풍(서에서 불어옴) → 왼쪽
    expect(relativeAngle(270, 0)).toBe(-90);
  });

  it('등 뒤에서 불어오면 ±180', () => {
    expect(Math.abs(relativeAngle(180, 0))).toBe(180);
  });

  it('0/360 경계를 넘어가도 최단 각을 쓴다', () => {
    // 진행 350°, 풍향 10° → 실제 차이는 20°이지 340°가 아니다
    expect(relativeAngle(10, 350)).toBe(20);
    expect(relativeAngle(350, 10)).toBe(-20);
  });

  it('항상 -180 ~ 180 범위에 들어온다', () => {
    for (let v = 0; v < 360; v += 7) {
      for (let h = 0; h < 360; h += 11) {
        const t = relativeAngle(v, h);
        expect(t).toBeGreaterThan(-181);
        expect(t).toBeLessThanOrEqual(180);
      }
    }
  });
});

describe('classifyWind', () => {
  const moving = true;

  it('정면 ±45°는 맞바람', () => {
    expect(classifyWind(0, 0, moving)).toBe('headwind');
    expect(classifyWind(45, 0, moving)).toBe('headwind');
    expect(classifyWind(315, 0, moving)).toBe('headwind');
  });

  it('등 뒤 ±45°는 뒷바람', () => {
    expect(classifyWind(180, 0, moving)).toBe('tailwind');
    expect(classifyWind(135, 0, moving)).toBe('tailwind');
    expect(classifyWind(225, 0, moving)).toBe('tailwind');
  });

  it('그 사이는 좌우 측풍', () => {
    expect(classifyWind(90, 0, moving)).toBe('crossRight');
    expect(classifyWind(270, 0, moving)).toBe('crossLeft');
    expect(classifyWind(46, 0, moving)).toBe('crossRight');
    expect(classifyWind(134, 0, moving)).toBe('crossRight');
    expect(classifyWind(314, 0, moving)).toBe('crossLeft');
  });

  it('경계값이 정확히 한쪽으로만 간다', () => {
    // 45와 135는 각각 맞바람/뒷바람에 포함 (측풍이 아님)
    expect(classifyWind(45, 0, moving)).toBe('headwind');
    expect(classifyWind(135, 0, moving)).toBe('tailwind');
    // 바로 옆은 측풍
    expect(classifyWind(45.1, 0, moving)).toBe('crossRight');
    expect(classifyWind(134.9, 0, moving)).toBe('crossRight');
  });

  it('진행 방위가 0이 아닐 때도 상대 기준으로 판정한다', () => {
    // 남쪽으로 주행(180) 중 남풍(180, 남에서 불어옴) → 맞바람
    expect(classifyWind(180, 180, moving)).toBe('headwind');
    // 남쪽으로 주행 중 북풍(0) → 뒷바람
    expect(classifyWind(0, 180, moving)).toBe('tailwind');
    // 남쪽으로 주행 중 서풍(270, 서에서 불어옴) → 오른쪽
    expect(classifyWind(270, 180, moving)).toBe('crossRight');
  });

  it('정지 상태이거나 방위를 모르면 판정하지 않는다', () => {
    expect(classifyWind(0, 0, false)).toBe('unknown');
    expect(classifyWind(0, null, true)).toBe('unknown');
  });
});

describe('arrowDeg', () => {
  it('맞바람이면 아래(180°)를 가리킨다', () => {
    expect(arrowDeg(0, 0)).toBe(180);
    expect(arrowDeg(90, 90)).toBe(180);
  });

  it('뒷바람이면 위(0°)를 가리킨다', () => {
    expect(arrowDeg(180, 0)).toBe(0);
    expect(arrowDeg(0, 180)).toBe(0);
  });

  it('우측풍이면 왼쪽 아래로 흐른다', () => {
    // 오른쪽에서 불어오므로 바람은 왼쪽으로 간다 → 270°
    expect(arrowDeg(90, 0)).toBe(270);
  });

  it('좌측풍이면 오른쪽으로 흐른다', () => {
    expect(arrowDeg(270, 0)).toBe(90);
  });

  it('항상 0 이상 360 미만', () => {
    for (let v = 0; v < 360; v += 13) {
      for (let h = 0; h < 360; h += 17) {
        const d = arrowDeg(v, h);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThan(360);
      }
    }
  });

  it('방위를 모르면 절대 방위 기준으로 그린다', () => {
    expect(arrowDeg(0, null)).toBe(180);
    expect(arrowDeg(90, null)).toBe(270);
  });
});

describe('intensity', () => {
  it('3 / 7 m/s를 경계로 나눈다', () => {
    expect(intensity(0)).toBe('weak');
    expect(intensity(2.9)).toBe('weak');
    expect(intensity(3)).toBe('normal');
    expect(intensity(6.9)).toBe('normal');
    expect(intensity(7)).toBe('strong');
    expect(intensity(20)).toBe('strong');
  });
});
