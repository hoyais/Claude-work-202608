/**
 * 서버리스 프록시 — 기상청 API 중계.
 *
 * 브라우저가 기상청을 직접 부를 수 없는 이유:
 *  1. 기상청 API는 CORS 헤더를 주지 않는다 (우회 불가)
 *  2. 인증키가 클라이언트에 노출된다
 *  3. 캐시가 없으면 사용자 수만큼 기상청을 호출하게 된다
 *
 * 캐시 키에 기상청 격자(nx, ny)를 쓰는 것이 핵심이다. 격자는 5×5km 단위라
 * 가까운 사용자들이 같은 키로 수렴하고, 여기에 10분 버킷을 붙이면 별도 만료
 * 로직 없이 자연스럽게 갱신된다. 결과적으로 기상청 호출량은 사용자 수가 아니라
 * 활성 격자 수에 비례한다.
 */

import { toGrid } from '../../src/lib/grid.ts';
import type { WeatherSnapshot, Sky, Precip } from '../../src/lib/types.ts';

export type Env = {
  /** 기상청 API 허브 인증키. wrangler secret 으로 주입한다. */
  KMA_KEY: string;
  /** 게이트웨이를 바꿔야 할 때만 지정. 기본값은 API 허브. */
  KMA_BASE?: string;
};

/**
 * 기상청 API 허브(apihub.kma.go.kr).
 *
 * 같은 VilageFcstInfoService_2.0 이지만 공공데이터포털(apis.data.go.kr)과는
 * 게이트웨이가 다르다. 인증 파라미터 이름도 serviceKey 가 아니라 authKey 다.
 */
const DEFAULT_BASE =
  'https://apihub.kma.go.kr/api/typ02/openApi/VilageFcstInfoService_2.0';

/**
 * 캐시 수명 10분. 실황 관측 주기와 같다.
 * 하늘상태(예보)는 더 오래 캐싱해도 되지만, 같은 응답에 실려 나가므로
 * 실황 주기에 맞춰 함께 갱신한다. 호출량 차이는 무시할 만하다.
 */
const NCST_TTL_S = 600;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'accept',
};

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(req.url);
    if (!url.pathname.endsWith('/weather')) {
      return json({ error: 'not found' }, 404);
    }

    const lat = Number(url.searchParams.get('lat'));
    const lon = Number(url.searchParams.get('lon'));
    if (!isFinite(lat) || !isFinite(lon)) {
      return json({ error: 'lat/lon required' }, 400);
    }

    const { nx, ny } = toGrid(lat, lon);

    // 격자 + 10분 버킷 → 같은 격자의 10분 내 요청은 전부 같은 키
    const bucket = Math.floor(Date.now() / (NCST_TTL_S * 1000));
    const cacheKey = new Request(
      `https://cache.local/w/${nx}/${ny}/${bucket}`,
      { method: 'GET' },
    );
    const cache = caches.default;

    const hit = await cache.match(cacheKey);
    if (hit) return withCors(hit);

    try {
      const snapshot = await load(nx, ny, env.KMA_KEY, env.KMA_BASE ?? DEFAULT_BASE);
      const res = json(snapshot, 200, {
        'cache-control': `public, max-age=${NCST_TTL_S}`,
      });
      ctx.waitUntil(cache.put(cacheKey, res.clone()));
      return res;
    } catch (e) {
      return json({ error: String(e) }, 502);
    }
  },
};

/** 실황(바람·기온)과 예보(하늘상태)를 합쳐 하나의 스냅샷으로 만든다. */
async function load(
  nx: number,
  ny: number,
  key: string,
  base: string,
): Promise<WeatherSnapshot> {
  const [ncst, fcst] = await Promise.all([
    fetchNcst(nx, ny, key, base),
    fetchSky(nx, ny, key, base).catch(() => null), // 하늘상태는 실패해도 진행
  ]);

  return {
    windSpeed: ncst.WSD,
    windFrom: ncst.VEC,
    temperature: ncst.T1H,
    humidity: ncst.REH,
    sky: fcst ?? 'clear',
    precip: mapPrecip(ncst.PTY),
    observedAt: ncst.observedAt,
  };
}

type Ncst = {
  WSD: number;
  VEC: number;
  T1H: number;
  REH: number;
  PTY: number;
  observedAt: number;
};

async function fetchNcst(
  nx: number,
  ny: number,
  key: string,
  base: string,
): Promise<Ncst> {
  // 매시각 정시 발표, 약 40분 후 제공. 아직 안 나왔으면 직전 시각을 쓴다.
  const { date, time, at } = ncstBase(new Date());

  const url =
    `${base}/getUltraSrtNcst?authKey=${encodeURIComponent(key)}` +
    `&pageNo=1&numOfRows=100&dataType=JSON` +
    `&base_date=${date}&base_time=${time}&nx=${nx}&ny=${ny}`;

  const items = await kmaItems(url);
  const pick = (cat: string): number => {
    const it = items.find((i) => i.category === cat);
    return it ? Number(it.obsrValue) : 0;
  };

  return {
    WSD: pick('WSD'),
    VEC: pick('VEC'),
    T1H: pick('T1H'),
    REH: pick('REH'),
    PTY: pick('PTY'),
    observedAt: at,
  };
}

/** 초단기예보에서 가장 가까운 시각의 하늘상태(SKY)를 가져온다. */
async function fetchSky(
  nx: number,
  ny: number,
  key: string,
  base: string,
): Promise<Sky> {
  const { date, time } = fcstBase(new Date());

  const url =
    `${base}/getUltraSrtFcst?authKey=${encodeURIComponent(key)}` +
    `&pageNo=1&numOfRows=60&dataType=JSON` +
    `&base_date=${date}&base_time=${time}&nx=${nx}&ny=${ny}`;

  const items = await kmaItems(url);
  const sky = items.find((i) => i.category === 'SKY');
  return mapSky(sky ? Number(sky.fcstValue) : 1);
}

type KmaItem = {
  category: string;
  obsrValue?: string;
  fcstValue?: string;
};

async function kmaItems(url: string): Promise<KmaItem[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`KMA ${res.status}`);

  const body = (await res.json()) as {
    response?: {
      header?: { resultCode?: string; resultMsg?: string };
      body?: { items?: { item?: KmaItem[] } };
    };
  };

  const header = body.response?.header;
  if (header?.resultCode !== '00') {
    throw new Error(`KMA ${header?.resultCode}: ${header?.resultMsg}`);
  }

  return body.response?.body?.items?.item ?? [];
}

/** 실황 발표 기준 시각 (KST). 정시 발표 + 40분 지연을 반영한다. */
function ncstBase(now: Date): { date: string; time: string; at: number } {
  const kst = toKst(now);
  const d = new Date(kst);

  if (d.getUTCMinutes() < 40) d.setUTCHours(d.getUTCHours() - 1);
  d.setUTCMinutes(0, 0, 0);

  return {
    date: ymd(d),
    time: `${pad(d.getUTCHours())}00`,
    // 관측 시각을 실제 epoch로 되돌린다 (KST → UTC)
    at: d.getTime() - 9 * 3600_000,
  };
}

/** 초단기예보 발표 기준 시각 (KST). 매시 30분 발표 + 15분 지연. */
function fcstBase(now: Date): { date: string; time: string } {
  const d = new Date(toKst(now));

  if (d.getUTCMinutes() < 45) d.setUTCHours(d.getUTCHours() - 1);
  d.setUTCMinutes(30, 0, 0);

  return { date: ymd(d), time: `${pad(d.getUTCHours())}30` };
}

/** UTC 기준 Date를 KST 벽시계로 옮긴다 (getUTC* 로 KST를 읽기 위한 트릭). */
function toKst(d: Date): number {
  return d.getTime() + 9 * 3600_000;
}

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function mapSky(code: number): Sky {
  if (code === 3) return 'partly';
  if (code === 4) return 'cloudy';
  return 'clear';
}

/** 초단기실황 PTY 코드. */
function mapPrecip(code: number): Precip {
  switch (code) {
    case 1:
    case 5:
      return 'rain';
    case 2:
    case 6:
      return 'sleet';
    case 3:
    case 7:
      return 'snow';
    default:
      return 'none';
  }
}

function json(
  data: unknown,
  status = 200,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...CORS, ...extra },
  });
}

function withCors(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v);
  return out;
}
