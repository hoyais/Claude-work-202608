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
import { readGridPoint } from '../../src/lib/gridfile.ts';
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

/** 격자 파일 API(typ01). 하늘상태를 여기서 받는다. */
const GRID_BASE = 'https://apihub.kma.go.kr/api/typ01/cgi-bin/url';

/**
 * 캐시 수명 10분. 실황 관측 주기와 같다.
 * 하늘상태(예보)는 더 오래 캐싱해도 되지만, 같은 응답에 실려 나가므로
 * 실황 주기에 맞춰 함께 갱신한다. 호출량 차이는 무시할 만하다.
 */
const NCST_TTL_S = 600;

/**
 * 격자 파일 캐시 수명. 초단기예보는 10분마다 발표되지만 하늘상태는 빠르게
 * 변하지 않고, 341KB짜리 파일이라 자주 받을 이유가 없다. tmfc/tmef가 캐시 키에
 * 들어 있어 시각이 바뀌면 어차피 새로 받는다.
 */
const GRID_TTL_S = 1800;

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
      const snapshot = await load(
        nx, ny, env.KMA_KEY, env.KMA_BASE ?? DEFAULT_BASE, ctx,
      );
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
  ctx: ExecutionContext,
): Promise<WeatherSnapshot> {
  const [ncst, fcst] = await Promise.all([
    fetchNcst(nx, ny, key, base),
    fetchSky(nx, ny, key, ctx).catch(() => null), // 하늘상태는 실패해도 진행
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
 * 하늘상태(SKY)를 초단기예보 격자 파일에서 읽는다.
 *
 * typ02 의 getUltraSrtFcst(지점 조회)는 별도 활용신청이 필요해 쓸 수 없고,
 * typ01 의 격자 API 는 승인되어 있다. 격자 파일은 전국 한 장(341KB)이라
 * 사용자가 몇이든 30분에 한 번만 받으면 되고, 응답에서 필요한 격자점만
 * 바이트 오프셋으로 잘라 읽으므로 파싱 비용도 들지 않는다.
 */
async function fetchSky(
  nx: number,
  ny: number,
  key: string,
  ctx: ExecutionContext,
): Promise<Sky | null> {
  const { tmfc, tmef } = vsrtBase(new Date());

  // 격자 파일은 전국 한 장이므로 위치와 무관하게 캐시를 공유한다.
  // 이 캐시가 없으면 격자점마다 341KB를 다시 받게 된다.
  const cacheKey = new Request(`https://cache.local/grid/SKY/${tmfc}/${tmef}`);
  const cache = caches.default;

  let text: string;
  const hit = await cache.match(cacheKey);

  if (hit) {
    text = await hit.text();
  } else {
    const url =
      `${GRID_BASE}/nph-dfs_vsrt_grd?authKey=${encodeURIComponent(key)}` +
      `&tmfc=${tmfc}&tmef=${tmef}&vars=SKY`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`KMA grid ${res.status}`);

    text = await res.text();
    // 활용신청 오류 등은 JSON 한 덩어리로 온다 — 격자 파일은 훨씬 크다
    if (text.length < 1000) throw new Error(`KMA grid: ${text.slice(0, 200)}`);

    ctx.waitUntil(
      cache.put(
        cacheKey,
        new Response(text, {
          headers: { 'cache-control': `public, max-age=${GRID_TTL_S}` },
        }),
      ),
    );
  }

  const code = readGridPoint(text, nx, ny);
  return code === null ? null : mapSky(code);
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

/**
 * 초단기예보 격자 API의 발표시각(tmfc)과 예보시각(tmef). 둘 다 KST.
 *
 *  tmfc: YYYYMMDDHHmm — 10분 단위로 발표된다. 생산 지연을 감안해 40분 뒤로 잡는다.
 *  tmef: YYYYMMDDHH   — 예보 대상 시각. 지금 시각의 하늘상태를 쓰면 된다.
 */
function vsrtBase(now: Date): { tmfc: string; tmef: string } {
  const d = new Date(toKst(now));
  const tmef = `${ymd(d)}${pad(d.getUTCHours())}`;

  d.setUTCMinutes(d.getUTCMinutes() - 40);
  const m = Math.floor(d.getUTCMinutes() / 10) * 10;

  return {
    tmfc: `${ymd(d)}${pad(d.getUTCHours())}${pad(m)}`,
    tmef,
  };
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
 * 기상청 SKY 코드. 실제 격자 응답에는 1·3·4만 나타난다(2는 쓰이지 않음).
 * 그래도 2가 오면 '구름조금'으로 보아 partly 로 둔다.
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
