/**
 * heading-up 지도.
 *
 * 진행 방향이 항상 화면 위쪽을 향하도록 회전하고, 라이더 마커는 화면
 * 아래 1/3 지점에 두어 전방 시야를 확보한다(디자인 가이드 03장/07장).
 * 전방 시야는 750m 고정 — 속도에 따라 축척을 바꾸지 않는다(기획안 05장).
 * 확대·축소·회전은 전부 앱이 제어하므로 사용자 조작은 막는다.
 */

import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

/** z16 근방이 위도 37° 부근에서 대략 750m 시야에 해당한다. */
const FIXED_ZOOM = 16;

/** 라이더 마커를 화면 아래쪽 1/3에 두기 위한 상단 패딩 비율.
 *  top = 0.32*H 로 두면 유효 중심이 대략 0.66*H(아래 1/3 경계)에 위치한다. */
const TOP_PADDING_RATIO = 0.32;

function styleUrl(key: string): string {
  return `https://api.maptiler.com/maps/streets-v2/style.json?key=${key}`;
}

/**
 * 스타일을 강제로 바꾸는 우회로. 외부 타일 서버에 접근할 수 없는 환경에서
 * 렌더링·회전 동작을 검증할 때 쓴다(scripts/check-map.mjs).
 * '{' 로 시작하면 스타일 객체 JSON, 아니면 URL로 본다.
 */
function resolveStyle(key: string): string | maplibregl.StyleSpecification {
  const override = import.meta.env['VITE_MAP_STYLE'];
  if (!override) return styleUrl(key);
  return override.trimStart().startsWith('{')
    ? (JSON.parse(override) as maplibregl.StyleSpecification)
    : override;
}

export class RideMap {
  private map: maplibregl.Map | null = null;
  private lastHeading = 0;

  constructor(containerId: string, apiKey: string) {
    const style = resolveStyle(apiKey);
    // 키도 없고 대체 스타일도 없으면 지도를 만들지 않는다 — 폴백 스케치가 대신 보인다
    if (!apiKey && typeof style === 'string' && style.includes('key=')) return;

    this.map = new maplibregl.Map({
      container: containerId,
      style,
      center: [126.9327, 37.5285], // 초기값(여의도). 실제 위치가 오면 바로 갱신된다
      zoom: FIXED_ZOOM,
      pitch: 0,
      bearing: 0,
      attributionControl: { compact: true },
      // 앱이 위치·방향·축척을 전부 제어하므로 사용자 조작은 막는다
      interactive: false,
      dragPan: false,
      dragRotate: false,
      scrollZoom: false,
      touchZoomRotate: false,
      doubleClickZoom: false,
      keyboard: false,
    });
  }

  get ready(): boolean {
    return this.map !== null;
  }

  /** 진행 방향·위치를 반영한다. heading 이 없으면 마지막 방향을 유지한다. */
  update(lat: number, lon: number, heading: number | null): void {
    if (!this.map) return;

    if (heading !== null) this.lastHeading = heading;

    const container = this.map.getContainer();
    const topPadding = container.clientHeight * TOP_PADDING_RATIO;

    this.map.jumpTo({
      center: [lon, lat],
      bearing: this.lastHeading,
      zoom: FIXED_ZOOM,
      padding: { top: topPadding, bottom: 0, left: 0, right: 0 },
    });
  }

  resize(): void {
    this.map?.resize();
  }
}
