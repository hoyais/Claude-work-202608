/** WeatherSnapshot + RideContext → Display. 화면이 필요로 하는 값을 한 번에 만든다. */

import type { Display, RideContext, WeatherSnapshot, Theme } from '../lib/types.ts';
import { classifyWind, arrowDeg, intensity, stateLabel } from '../lib/wind.ts';
import { toKorean16 } from '../lib/bearing.ts';
import { feelsLike, toKmh, stalenessMinutes } from '../lib/weather.ts';
import { resolveTheme } from '../lib/sun.ts';

export function buildDisplay(
  weather: WeatherSnapshot,
  ride: RideContext,
  opts: { now?: number; theme?: Theme; offline?: boolean } = {},
): Display {
  const now = opts.now ?? Date.now();
  const state = classifyWind(weather.windFrom, ride.heading, ride.isMoving);

  const theme =
    opts.theme ??
    resolveTheme(new Date(now), ride.position.lat, ride.position.lon);

  return {
    state,
    label: stateLabel(state),
    arrowDeg: arrowDeg(weather.windFrom, ride.heading),
    intensity: intensity(weather.windSpeed),
    windSpeed: weather.windSpeed,
    bearingKo: toKorean16(weather.windFrom),
    temperature: weather.temperature,
    feelsLike: feelsLike(weather.temperature, weather.windSpeed, weather.humidity),
    sky: weather.sky,
    precip: weather.precip,
    theme,
    speedKmh: toKmh(ride.speed),
    staleMinutes: stalenessMinutes(weather.observedAt, now),
  };
}
