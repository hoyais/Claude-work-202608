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
    sky: fcst, // 활용신청이 안 됐거나 실패하면 null
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

/**
 * 하늘상태(SKY)를 지점 초단기예보(getUltraSrtFcst)에서 읽는다.
 *
 * 이전에는 이 API의 활용신청이 막혀 있어 341KB짜리 격자 파일(nph-dfs_vsrt_grd)
 * 에서 SKY 한 칸만 잘라 썼다. 지점 API가 승인되면서 지점 실황(fetchNcst)과
 * 같은 방식의 가벼운 호출(수 KB)로 대체한다.
 *
 * 응답은 여러 미래 시각의 예보를 한꺼번에 주므로, 그중 가장 이른(지금과 가장
 * 가까운) fcstDate/fcstTime의 SKY 값을 고른다.
 */
async function fetchSky(
  nx: number,
  ny: number,
  key: string,
  base: string,
): Promise<Sky | null> {
  const { date, time } = fcstBase(new Date());

  const url =
    `${base}/getUltraSrtFcst?authKey=${encodeURIComponent(key)}` +
    `&pageNo=1&numOfRows=100&dataType=JSON` +
    `&base_date=${date}&base_time=${time}&nx=${nx}&ny=${ny}`;

  const items = await kmaItems(url);
  const sky = items.filter((i) => i.category === 'SKY');
  if (sky.length === 0) return null;

  const earliest = sky.reduce((a, b) =>
    `${a.fcstDate}${a.fcstTime}` <= `${b.fcstDate}${b.fcstTime}` ? a : b,
  );

  return mapSky(Number(earliest.fcstValue));
}

type KmaItem = {
  category: string;
  obsrValue?: string;
  fcstValue?: string;
  fcstDate?: string;
  fcstTime?: string;
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

  // API 허브는 오류를 두 가지 형태로 돌려준다.
  //  1. { response: { header: { resultCode, resultMsg } } }        — 서비스 내부 오류
  //  2. { result: { status, message } }                             — 게이트웨이 오류
  //     (예: 403 "활용신청이 필요한 API 입니다")
  const gate = (body as { result?: { status?: number; message?: string } }).result;
  if (gate?.status && gate.status >= 400) {
    throw new Error(`KMA ${gate.status}: ${gate.message}`);
  }

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

/** 지점 초단기예보 발표 기준 시각 (KST). 매시 30분 발표 + 생산 지연 감안 45분. */
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

/**
 * 기상청 SKY 코드. 실제 관측에는 1·3·4가 흔하고 2는 잘 쓰이지 않는다.
 * 2가 오면 '구름조금'으로 보아 partly 로 둔다.
 */
function mapSky(code: number): Sky {
  if (code === 2 || code === 3) return 'partly';
  if (code >= 4) return 'cloudy';
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
