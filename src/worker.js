const UPSTREAM_URL = 'https://apply.duofriend.com/applet/appointment/get-venue-project';
const CLASSIFY_ID = '409344908805888';
const MAIN_ID = '409344904611366';

// 球馆营业时间 8:30-22:30：每小时 25 分抓取对应的下一个整点时段。
const CAPTURE_START_HOUR = 8;
const CAPTURE_END_HOUR = 21;
const KEY_SLOTS = [
  ['19:30', '20:30'],
  ['20:30', '21:30']
];
const EXPECTED_COURTS = [
  'VIP1', 'VIP2', 'VIP3', 'VIP4', 'VIP5',
  'A6', 'A7', 'A8', 'A9', 'A10', 'A11', 'A12', 'A13', 'A14', 'A15'
];
const CRON = '25-29 * * * *';
// 每个时段最多重试 5 次：:25-:29，全部在 :30 锁场之前。
const RETRY_MINUTES = [25, 26, 27, 28, 29];
const ALERT_CRON = '0,30 * * * *';
const ALERT_START_MINUTE = 8 * 60 + 30; // 08:30
const ALERT_END_MINUTE = 18 * 60; // 18:00
const BARK_PUSH_URL = 'https://api.day.app/Q9oUhYzRZXCCrtpC87i2b3/';

class UpstreamError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

function json(body, init = {}) {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=UTF-8');
  headers.set('cache-control', 'no-store, max-age=0');
  headers.set('access-control-allow-origin', '*');
  headers.set('access-control-allow-methods', 'GET, POST, OPTIONS');
  headers.set('access-control-allow-headers', 'Content-Type, Accept, Cache-Control');
  return new Response(JSON.stringify(body), { ...init, headers });
}

function errorResponse(message, status = 500) {
  return json({ code: status, message }, { status });
}

function getShanghaiParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now);
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

function getTodayInShanghai() {
  const values = getShanghaiParts();
  return `${values.year}-${values.month}-${values.day}`;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function getWindowForHour(hour) {
  if (!Number.isInteger(hour) || hour < CAPTURE_START_HOUR || hour > CAPTURE_END_HOUR) return null;
  return { beginTime: `${pad2(hour)}:30`, endTime: `${pad2(hour + 1)}:30` };
}

function shiftDate(value, days) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days, 12)).toISOString().slice(0, 10);
}

function normalizeDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return null;
  return value;
}

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function hasBookingMarker(slot) {
  return Boolean(slot) && (hasValue(slot.orderId) || hasValue(slot.status));
}

function isSlotAvailable(slot) {
  return Boolean(slot) && Number(slot.isSure) === 1 && !hasBookingMarker(slot);
}

function getSlotState(slot) {
  if (!slot) return 'missing';
  if (isSlotAvailable(slot)) return 'available';
  if (hasBookingMarker(slot)) return 'booked';
  return 'sold';
}

function findSlot(project, beginTime, endTime) {
  return (project?.timeList || []).find(slot =>
    slot.beginTime === beginTime && slot.endTime === endTime
  ) || null;
}

function analyzeCourt(project, name) {
  const slots = KEY_SLOTS.map(([beginTime, endTime]) => findSlot(project, beginTime, endTime));
  const freeCount = slots.filter(isSlotAvailable).length;
  const state = !project || slots.some(slot => !slot)
    ? 'missing'
    : freeCount === 2
      ? 'available'
      : freeCount === 1
        ? 'partial'
        : 'sold';

  return {
    name,
    slots,
    state,
    label: state === 'available'
      ? '整段可订'
      : state === 'partial'
        ? '部分可订'
        : state === 'missing'
          ? '时段缺失'
          : '整段不可订',
    fullyAvailable: Boolean(project) && slots.length === 2 && slots.every(isSlotAvailable)
  };
}

function analyzeProjects(projects) {
  const projectMap = new Map(
    projects.map(project => [String(project?.projectName || '').trim(), project])
  );
  const courts = EXPECTED_COURTS.map(name => analyzeCourt(projectMap.get(name), name));
  const slots = KEY_SLOTS.map(([beginTime, endTime], index) => {
    const availableCourts = courts
      .filter(court => isSlotAvailable(court.slots[index]))
      .map(court => court.name);
    return { beginTime, endTime, availableCount: availableCourts.length, availableCourts };
  });
  const continuousCourts = courts.filter(court => court.fullyAvailable).map(court => court.name);

  return {
    courts,
    continuousCount: continuousCourts.length,
    continuousCourts,
    slots
  };
}

function analyzeWindow(projects, beginTime, endTime) {
  const projectMap = new Map(
    projects.map(project => [String(project?.projectName || '').trim(), project])
  );
  const courts = EXPECTED_COURTS.map(name => {
    const slot = findSlot(projectMap.get(name), beginTime, endTime);
    return {
      name,
      available: isSlotAvailable(slot),
      state: getSlotState(slot),
      isSure: slot?.isSure ?? null,
      hasBookingMarker: hasBookingMarker(slot)
    };
  });
  const availableCourts = courts.filter(court => court.available).map(court => court.name);

  return {
    availableCount: availableCourts.length,
    availableCourts,
    details: courts.map(({ name, state, isSure, hasBookingMarker }) => ({
      name,
      state,
      isSure,
      hasBookingMarker
    }))
  };
}

async function fetchVenuePayload(date) {
  const url = new URL(UPSTREAM_URL);
  url.search = new URLSearchParams({
    classifyId: CLASSIFY_ID,
    mainId: MAIN_ID,
    selectDate: date,
    _: String(Date.now())
  }).toString();

  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
      cache: 'no-store',
      signal: AbortSignal.timeout(10000)
    });
  } catch (error) {
    throw new UpstreamError('Unable to reach the venue service.');
  }

  if (!response.ok) {
    throw new UpstreamError(`Venue service returned HTTP ${response.status}.`, response.status);
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new UpstreamError('Venue service returned invalid JSON.');
  }

  if (Number(payload?.code) !== 0) {
    throw new UpstreamError(payload?.message || 'Venue service returned an error.');
  }

  const dayData = Array.isArray(payload.data) ? payload.data[0] : null;
  const projects = Array.isArray(dayData?.projectList) ? dayData.projectList : [];
  if (!projects.length) {
    throw new UpstreamError('Venue service did not return court data.');
  }

  return { payload, projects };
}

async function handleAvailability(url) {
  const date = normalizeDate(url.searchParams.get('date') || getTodayInShanghai());
  if (!date) return errorResponse('The date must use YYYY-MM-DD.', 400);

  try {
    const { payload, projects } = await fetchVenuePayload(date);
    const dashboard = analyzeProjects(projects);
    return json({
      ...payload,
      dashboard: {
        date,
        generatedAt: new Date().toISOString(),
        ...dashboard
      }
    });
  } catch (error) {
    const status = error instanceof UpstreamError && error.status >= 400 && error.status < 500
      ? error.status
      : 502;
    return errorResponse(error.message || 'Unable to load venue availability.', status);
  }
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (error) {
    return fallback;
  }
}

function parseHistoryLimit(value) {
  const limit = Number.parseInt(value || '30', 10);
  if (!Number.isFinite(limit)) return 30;
  return Math.min(Math.max(limit, 1), 90);
}

function deriveContinuous(windows) {
  const first = windows.find(window => window.beginTime === KEY_SLOTS[0][0]);
  const second = windows.find(window => window.beginTime === KEY_SLOTS[1][0]);
  const firstOk = first?.status === 'success';
  const secondOk = second?.status === 'success';

  if (!firstOk || !secondOk) {
    return {
      beginTime: KEY_SLOTS[0][0],
      endTime: KEY_SLOTS[1][1],
      status: firstOk || secondOk ? 'partial' : 'failed',
      availableCount: null,
      availableCourts: [],
      error: first?.error || second?.error || null
    };
  }

  const courts = EXPECTED_COURTS.filter(name =>
    first.availableCourts.includes(name) && second.availableCourts.includes(name)
  );
  return {
    beginTime: KEY_SLOTS[0][0],
    endTime: KEY_SLOTS[1][1],
    status: 'success',
    availableCount: courts.length,
    availableCourts: courts,
    error: null
  };
}

function buildHistoryItems(rows) {
  const byDate = new Map();
  for (const row of rows) {
    let item = byDate.get(row.snapshot_date);
    if (!item) {
      item = { date: row.snapshot_date, windows: [] };
      byDate.set(row.snapshot_date, item);
    }
    item.windows.push({
      beginTime: row.window_begin,
      endTime: row.window_end,
      capturedAt: row.captured_at,
      sourceTimestamp: row.source_timestamp,
      status: row.status,
      availableCount: row.available_count,
      availableCourts: parseJson(row.available_courts, []),
      error: row.error_message || null
    });
  }

  const items = [...byDate.values()].map(item => {
    item.windows.sort((a, b) => a.beginTime.localeCompare(b.beginTime));
    item.continuous = deriveContinuous(item.windows);
    return item;
  });
  items.sort((a, b) => b.date.localeCompare(a.date));
  return items;
}

async function handleHistory(env, url) {
  const limit = parseHistoryLimit(url.searchParams.get('days'));
  const cutoff = shiftDate(getTodayInShanghai(), -(limit - 1));
  try {
    const result = await env.DB.prepare(`
      SELECT
        snapshot_date,
        window_begin,
        window_end,
        captured_at,
        source_timestamp,
        status,
        available_count,
        available_courts,
        details_json,
        error_message
      FROM venue_snapshots
      WHERE snapshot_date >= ?
      ORDER BY snapshot_date DESC, window_begin ASC
    `).bind(cutoff).all();

    return json({
      items: buildHistoryItems(result.results || []),
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Unable to read history', error);
    return errorResponse('Unable to read snapshot history.', 500);
  }
}

function getMinuteOfDay(parts) {
  return Number(parts.hour) * 60 + Number(parts.minute);
}

async function loadAlertConfig(env) {
  return env.DB.prepare(
    'SELECT threshold, enabled, updated_at FROM alert_config WHERE id = 1'
  ).bind().first();
}

async function saveAlertConfig(env, { threshold, enabled }) {
  const updatedAt = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO alert_config (id, threshold, enabled, updated_at)
    VALUES (1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      threshold = excluded.threshold,
      enabled = excluded.enabled,
      updated_at = excluded.updated_at
  `).bind(threshold, enabled ? 1 : 0, updatedAt).run();
  return updatedAt;
}

async function handleAlertGet(env) {
  const config = await loadAlertConfig(env);
  return json({
    enabled: Boolean(config?.enabled),
    threshold: config?.threshold ?? null,
    updatedAt: config?.updated_at ?? null
  });
}

async function handleAlertStart(env, request) {
  let body;
  try {
    body = await request.json();
  } catch (error) {
    return errorResponse('请求格式错误。', 400);
  }

  const threshold = Number(body?.threshold);
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > 15) {
    return errorResponse('阈值必须是 1-15 的整数。', 400);
  }

  if (getMinuteOfDay(getShanghaiParts()) > ALERT_END_MINUTE) {
    return errorResponse('今天的监控时段已结束（8:30–18:00），明天 8:30 再开始。', 400);
  }

  const updatedAt = await saveAlertConfig(env, { threshold, enabled: true });
  return json({ enabled: true, threshold, updatedAt });
}

async function handleAlertStop(env) {
  const config = await loadAlertConfig(env);
  const updatedAt = await saveAlertConfig(env, {
    threshold: config?.threshold ?? null,
    enabled: false
  });
  return json({
    enabled: false,
    threshold: config?.threshold ?? null,
    updatedAt
  });
}

async function checkAlert(env) {
  const config = await loadAlertConfig(env);
  if (!config) return;

  const minuteOfDay = getMinuteOfDay(getShanghaiParts());

  // 过了 18:00 自动关闭当天的提醒，第二天需要重新点“开始”。
  if (minuteOfDay > ALERT_END_MINUTE) {
    if (Number(config.enabled) === 1) {
      await saveAlertConfig(env, { threshold: config.threshold, enabled: false });
    }
    return;
  }

  if (Number(config.enabled) !== 1) return;

  // 只处理 8:30-18:00 的整半点（cron 每半小时触发，这里是双重保险）。
  if (minuteOfDay < ALERT_START_MINUTE || minuteOfDay % 30 !== 0) return;

  try {
    const { projects } = await fetchVenuePayload(getTodayInShanghai());
    const dashboard = analyzeProjects(projects);
    if (dashboard.continuousCount < Number(config.threshold)) {
      const message = `剩 ${dashboard.continuousCount} 个空场：${dashboard.continuousCourts.join('、')}`;
      await fetch(BARK_PUSH_URL + encodeURIComponent(message), { method: 'GET' });
      console.log(`Alert pushed: ${message}`);
    }
  } catch (error) {
    console.error('Unable to run alert check', error);
  }
}

async function writeSnapshot(env, snapshot) {
  await env.DB.prepare(`
    INSERT INTO venue_snapshots (
      snapshot_date,
      window_begin,
      window_end,
      captured_at,
      source_timestamp,
      status,
      available_count,
      available_courts,
      details_json,
      error_message,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(snapshot_date, window_begin) DO UPDATE SET
      window_end = excluded.window_end,
      captured_at = excluded.captured_at,
      source_timestamp = excluded.source_timestamp,
      status = excluded.status,
      available_count = excluded.available_count,
      available_courts = excluded.available_courts,
      details_json = excluded.details_json,
      error_message = excluded.error_message,
      updated_at = excluded.updated_at
    WHERE venue_snapshots.status <> 'success'
  `).bind(
    snapshot.date,
    snapshot.window.beginTime,
    snapshot.window.endTime,
    snapshot.capturedAt,
    snapshot.sourceTimestamp,
    snapshot.status,
    snapshot.availableCount,
    snapshot.availableCourts,
    snapshot.details,
    snapshot.error,
    snapshot.capturedAt,
    snapshot.capturedAt
  ).run();
}

async function captureSnapshot(env, window) {
  const date = getTodayInShanghai();
  const existing = await env.DB.prepare(
    'SELECT status FROM venue_snapshots WHERE snapshot_date = ? AND window_begin = ?'
  ).bind(date, window.beginTime).first();
  if (existing?.status === 'success') return;

  const capturedAt = new Date().toISOString();
  try {
    const { payload, projects } = await fetchVenuePayload(date);
    const analysis = analyzeWindow(projects, window.beginTime, window.endTime);
    await writeSnapshot(env, {
      date,
      window,
      capturedAt,
      sourceTimestamp: Number(payload.timestamp) || null,
      status: 'success',
      availableCount: analysis.availableCount,
      availableCourts: JSON.stringify(analysis.availableCourts),
      details: JSON.stringify(analysis.details),
      error: null
    });
    console.log(`Saved venue snapshot for ${date} ${window.beginTime}-${window.endTime}.`);
  } catch (error) {
    console.error(
      `Unable to save venue snapshot for ${date} ${window.beginTime}-${window.endTime}.`,
      error
    );
    try {
      await writeSnapshot(env, {
        date,
        window,
        capturedAt,
        sourceTimestamp: null,
        status: 'failed',
        availableCount: null,
        availableCourts: null,
        details: null,
        error: String(error?.message || 'Unknown snapshot error').slice(0, 500)
      });
    } catch (writeError) {
      console.error(`Unable to record snapshot failure for ${date}.`, writeError);
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/') && request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-headers': 'Content-Type, Accept, Cache-Control',
          'access-control-max-age': '86400',
          'cache-control': 'no-store'
        }
      });
    }
    if (url.pathname === '/api/availability') {
      if (request.method !== 'GET') return errorResponse('Method not allowed.', 405);
      return handleAvailability(url);
    }
    if (url.pathname === '/api/history') {
      if (request.method !== 'GET') return errorResponse('Method not allowed.', 405);
      return handleHistory(env, url);
    }
    if (url.pathname === '/api/alert') {
      if (request.method === 'GET') return handleAlertGet(env);
      if (request.method === 'POST') return handleAlertStart(env, request);
      return errorResponse('Method not allowed.', 405);
    }
    if (url.pathname === '/api/alert/stop') {
      if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
      return handleAlertStop(env);
    }
    if (url.pathname.startsWith('/api/')) return errorResponse('Not found.', 404);
    return env.ASSETS.fetch(request);
  },

  async scheduled(controller, env, ctx) {
    if (controller.cron === CRON) {
      const parts = getShanghaiParts();
      const hour = Number(parts.hour);
      const minute = Number(parts.minute);
      if (!RETRY_MINUTES.includes(minute)) return;
      const window = getWindowForHour(hour);
      if (!window) return;

      await captureSnapshot(env, window);
      return;
    }

    if (controller.cron === ALERT_CRON) {
      await checkAlert(env);
      return;
    }
  }
};
