/** DOM 렌더링. 상태 → 화면. */

import type { AppState, Display, Sky, Precip } from '../lib/types.ts';

const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const SKY_TEXT: Record<Sky, string> = {
  clear: '맑음',
  partly: '구름조금',
  cloudy: '흐림',
};

const PRECIP_TEXT: Record<Exclude<Precip, 'none'>, string> = {
  rain: '비',
  snow: '눈',
  sleet: '진눈깨비',
  shower: '소나기',
};

/**
 * 강수가 있으면 하늘상태보다 우선한다.
 * 하늘상태를 모르고(초단기예보 미연동) 강수도 없으면 아무 말도 하지 않는다.
 * 모르는 것을 "맑음"이라고 지어내면 화면이 조용히 거짓말을 하게 된다.
 */
function weatherText(sky: Sky | null, precip: Precip): string {
  if (precip !== 'none') return PRECIP_TEXT[precip];
  return sky === null ? '' : SKY_TEXT[sky];
}

function weatherIcon(sky: Sky | null, precip: Precip): string {
  if (precip !== 'none') {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round">
      <path d="M7 15a4 4 0 0 1 .6-8A5.5 5.5 0 0 1 18 8.5a3.5 3.5 0 0 1-.5 6.5"/>
      <line x1="8" y1="19" x2="7" y2="22"/><line x1="13" y1="19" x2="12" y2="22"/><line x1="18" y1="19" x2="17" y2="22"/>
    </svg>`;
  }
  if (sky === 'cloudy') {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round">
      <path d="M7 18a4.5 4.5 0 0 1 .6-9A5.5 5.5 0 0 1 18 10.5a3.8 3.8 0 0 1-.4 7.5z"/>
    </svg>`;
  }
  // 하늘상태를 모르면 온도만 보여준다 (아이콘 없음)
  if (sky === null) return '';
  if (sky === 'partly') {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round">
      <circle cx="9" cy="8" r="3.2"/>
      <path d="M12 18a4 4 0 0 1 .5-8A4.8 4.8 0 0 1 21 11.5a3.2 3.2 0 0 1-.4 6.5z"/>
    </svg>`;
  }
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round">
    <circle cx="12" cy="12" r="4.6"/>
    <line x1="12" y1="1.5" x2="12" y2="3.6"/><line x1="12" y1="20.4" x2="12" y2="22.5"/>
    <line x1="1.5" y1="12" x2="3.6" y2="12"/><line x1="20.4" y1="12" x2="22.5" y2="12"/>
    <line x1="4.6" y1="4.6" x2="6.1" y2="6.1"/><line x1="17.9" y1="17.9" x2="19.4" y2="19.4"/>
    <line x1="19.4" y1="4.6" x2="17.9" y2="6.1"/><line x1="6.1" y1="17.9" x2="4.6" y2="19.4"/>
  </svg>`;
}

/** 지도 위에 뿌리는 절대 풍향 화살표. 지도와 같은 회전 프레임을 쓴다. */
function renderMapWind(deg: number, state: string): void {
  const svg = $<SVGSVGElement & HTMLElement>('map-wind');
  if (state === 'unknown') {
    svg.innerHTML = '';
    return;
  }

  const spots = [
    [18, 22], [64, 14], [82, 40], [26, 55], [72, 68], [14, 82], [56, 90],
  ];

  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.innerHTML = spots
    .map(
      // 다이얼과 같은 규약: 0°에서 위쪽을 가리킨다
      ([x, y]) => `<g transform="translate(${x} ${y}) rotate(${deg}) scale(0.9)">
        <line x1="0" y1="3.2" x2="0" y2="-2.2" vector-effect="non-scaling-stroke"/>
        <path d="M0 -4.4 L-1.5 -1.1 L0 -2 L1.5 -1.1 Z"/>
      </g>`,
    )
    .join('');
}

function renderDisplay(d: Display): void {
  const app = $('app');
  app.dataset['state'] = d.state;
  app.dataset['theme'] = d.theme;
  app.dataset['intensity'] = d.intensity;

  $('label').textContent = d.label;
  $('speed').textContent = d.windSpeed.toFixed(1);
  $('bearing').textContent = d.bearingKo;
  $('temp').textContent = `${Math.round(d.temperature)}°`;

  // 체감온도가 기온과 같으면 보여줄 이유가 없다. 글랜스 화면에서 의미 없는
  // 숫자 하나가 늘어나는 것은 손해다.
  const feels = Math.round(d.feelsLike);
  const sameAsTemp = feels === Math.round(d.temperature);
  $('feels-wrap').hidden = sameAsTemp;
  if (!sameAsTemp) $('feels').textContent = `${feels}°`;
  const text = weatherText(d.sky, d.precip);
  const icon = weatherIcon(d.sky, d.precip);
  $('sky-text').textContent = text;
  $('sky-text').hidden = text === '';
  $('sky-sep').hidden = text === '';
  $('sky-icon').innerHTML = icon;
  $('sky-icon').hidden = icon === '';
  $('kmh').textContent = `${Math.round(d.speedKmh)} km/h`;

  // GPS 노이즈로 화살표가 미세하게 떠는 것을 막기 위해 5° 단위로 반올림
  const deg = Math.round(d.arrowDeg / 5) * 5;
  $('arrow').style.transform = `rotate(${deg}deg)`;
  renderMapWind(deg, d.state);

  const stale = $('stale');
  if (d.staleMinutes === null) {
    stale.hidden = true;
  } else {
    stale.hidden = false;
    stale.textContent = `${d.staleMinutes}분 전 정보 · 연결 끊김`;
  }

  // 주소창 색까지 상태색에 맞춘다
  const meta = document.getElementById('theme-color') as HTMLMetaElement | null;
  if (meta) {
    const styles = getComputedStyle(app);
    meta.content = styles.getPropertyValue('--band-fill').trim() || '#101418';
  }
}

const ICON_LOCATION_OFF = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
  <circle cx="12" cy="12" r="9"/><line x1="6" y1="18" x2="18" y2="6"/>
</svg>`;

const ICON_SEARCHING = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
  <circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8" opacity="0.45"/>
</svg>`;

function showOverlay(
  icon: string,
  title: string,
  body: string,
  cta?: { label: string; onClick: () => void },
): void {
  $('overlay').hidden = false;
  $('overlay-icon').innerHTML = icon;
  $('overlay-title').textContent = title;
  $('overlay-body').textContent = body;

  const btn = $<HTMLButtonElement>('overlay-cta');
  if (cta) {
    btn.hidden = false;
    btn.textContent = cta.label;
    btn.onclick = cta.onClick;
  } else {
    btn.hidden = true;
    btn.onclick = null;
  }
}

/** 앱 상태를 화면에 반영한다. 모든 실패 상태에 화면이 있다. */
export function render(state: AppState): void {
  if (state.kind === 'ready' || state.kind === 'offline') {
    $('overlay').hidden = true;
    renderDisplay(state.display);
    return;
  }

  if (state.kind === 'permission-denied') {
    showOverlay(
      ICON_LOCATION_OFF,
      '위치 권한이 필요합니다',
      '진행 방향을 알아야 바람이 맞바람인지 뒷바람인지 계산할 수 있어요.',
      { label: '권한 허용하기', onClick: () => location.reload() },
    );
    return;
  }

  showOverlay(
    ICON_SEARCHING,
    '신호 찾는 중',
    '하늘이 트인 곳에서 잠시 기다려 주세요.',
  );
}
