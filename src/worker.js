const UPSTREAM_URL = 'https://apply.duofriend.com/applet/appointment/get-venue-project';
const CLASSIFY_ID = '409344908805888';
const MAIN_ID = '409344904611366';
const TARGET_SLOTS = [
  ['19:30', '20:30'],
  ['20:30', '21:30']
];
const EXPECTED_COURTS = [
  'VIP1', 'VIP2', 'VIP3', 'VIP4', 'VIP5',
  'A6', 'A7', 'A8', 'A9', 'A10', 'A11', 'A12', 'A13', 'A14', 'A15'
];
const PRIMARY_CRON = '25 11 * * *';
const BACKUP_CRON = '27 11 * * *';

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
  return new Response(JSON.stringify(body), { ...init, headers });
}

function errorResponse(message, status = 500) {
  return json({ code: status, message }, { status });
}

function getTodayInShanghai() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
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
  const slots = TARGET_SLOTS.map(([beginTime, endTime]) => findSlot(project, beginTime, endTime));
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
  const slots = TARGET_SLOTS.map(([beginTime, endTime], index) => {
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

function makeSnapshotDetails(courts) {
  return courts.map(court => ({
    name: court.name,
    continuous: court.fullyAvailable,
    slots: court.slots.map((slot, index) => ({
      beginTime: TARGET_SLOTS[index][0],
      endTime: TARGET_SLOTS[index][1],
      state: getSlotState(slot),
      isSure: slot?.isSure ?? null,
      hasBookingMarker: hasBookingMarker(slot)
    }))
  }));
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
      cache: 'no-store'
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
  const limit = Number.parseInt(value || '14', 10);
  if (!Number.isFinite(limit)) return 14;
  return Math.min(Math.max(limit, 1), 90);
}

async function handleHistory(env, url) {
  const limit = parseHistoryLimit(url.searchParams.get('days'));
  try {
    const result = await env.DB.prepare(`
      SELECT
        snapshot_date,
        captured_at,
        source_timestamp,
        status,
        continuous_count,
        continuous_courts,
        first_slot_count,
        first_slot_courts,
        second_slot_count,
        second_slot_courts,
        target_slots_json,
        error_message
      FROM venue_snapshots
      ORDER BY snapshot_date DESC
      LIMIT ?
    `).bind(limit).all();

    const items = (result.results || []).map(row => ({
      date: row.snapshot_date,
      capturedAt: row.captured_at,
      sourceTimestamp: row.source_timestamp,
      status: row.status,
      continuousCount: row.continuous_count,
      continuousCourts: parseJson(row.continuous_courts, []),
      slots: [
        {
          beginTime: TARGET_SLOTS[0][0],
          endTime: TARGET_SLOTS[0][1],
          availableCount: row.first_slot_count,
          availableCourts: parseJson(row.first_slot_courts, [])
        },
        {
          beginTime: TARGET_SLOTS[1][0],
          endTime: TARGET_SLOTS[1][1],
          availableCount: row.second_slot_count,
          availableCourts: parseJson(row.second_slot_courts, [])
        }
      ],
      details: parseJson(row.target_slots_json, []),
      error: row.error_message || null
    }));

    return json({ items, generatedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Unable to read history', error);
    return errorResponse('Unable to read snapshot history.', 500);
  }
}

async function writeSnapshot(env, snapshot) {
  await env.DB.prepare(`
    INSERT INTO venue_snapshots (
      snapshot_date,
      captured_at,
      source_timestamp,
      status,
      continuous_count,
      continuous_courts,
      first_slot_count,
      first_slot_courts,
      second_slot_count,
      second_slot_courts,
      target_slots_json,
      error_message,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(snapshot_date) DO UPDATE SET
      captured_at = excluded.captured_at,
      source_timestamp = excluded.source_timestamp,
      status = excluded.status,
      continuous_count = excluded.continuous_count,
      continuous_courts = excluded.continuous_courts,
      first_slot_count = excluded.first_slot_count,
      first_slot_courts = excluded.first_slot_courts,
      second_slot_count = excluded.second_slot_count,
      second_slot_courts = excluded.second_slot_courts,
      target_slots_json = excluded.target_slots_json,
      error_message = excluded.error_message,
      updated_at = excluded.updated_at
    WHERE venue_snapshots.status <> 'success'
  `).bind(
    snapshot.date,
    snapshot.capturedAt,
    snapshot.sourceTimestamp,
    snapshot.status,
    snapshot.continuousCount,
    snapshot.continuousCourts,
    snapshot.firstSlotCount,
    snapshot.firstSlotCourts,
    snapshot.secondSlotCount,
    snapshot.secondSlotCourts,
    snapshot.details,
    snapshot.error,
    snapshot.capturedAt,
    snapshot.capturedAt
  ).run();
}

async function captureSnapshot(env, isBackup) {
  const date = getTodayInShanghai();
  if (isBackup) {
    const existing = await env.DB.prepare(
      'SELECT status FROM venue_snapshots WHERE snapshot_date = ?'
    ).bind(date).first();
    if (existing?.status === 'success') return;
  }

  const capturedAt = new Date().toISOString();
  try {
    const { payload, projects } = await fetchVenuePayload(date);
    const dashboard = analyzeProjects(projects);
    const firstSlot = dashboard.slots[0];
    const secondSlot = dashboard.slots[1];
    await writeSnapshot(env, {
      date,
      capturedAt,
      sourceTimestamp: Number(payload.timestamp) || null,
      status: 'success',
      continuousCount: dashboard.continuousCount,
      continuousCourts: JSON.stringify(dashboard.continuousCourts),
      firstSlotCount: firstSlot.availableCount,
      firstSlotCourts: JSON.stringify(firstSlot.availableCourts),
      secondSlotCount: secondSlot.availableCount,
      secondSlotCourts: JSON.stringify(secondSlot.availableCourts),
      details: JSON.stringify(makeSnapshotDetails(dashboard.courts)),
      error: null
    });
    console.log(`Saved venue snapshot for ${date}.`);
  } catch (error) {
    console.error(`Unable to save venue snapshot for ${date}.`, error);
    try {
      await writeSnapshot(env, {
        date,
        capturedAt,
        sourceTimestamp: null,
        status: 'failed',
        continuousCount: null,
        continuousCourts: null,
        firstSlotCount: null,
        firstSlotCourts: null,
        secondSlotCount: null,
        secondSlotCourts: null,
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
    if (url.pathname === '/api/availability') {
      if (request.method !== 'GET') return errorResponse('Method not allowed.', 405);
      return handleAvailability(url);
    }
    if (url.pathname === '/api/history') {
      if (request.method !== 'GET') return errorResponse('Method not allowed.', 405);
      return handleHistory(env, url);
    }
    if (url.pathname.startsWith('/api/')) return errorResponse('Not found.', 404);
    return env.ASSETS.fetch(request);
  },

  async scheduled(controller, env, ctx) {
    const isBackup = controller.cron === BACKUP_CRON;
    if (controller.cron !== PRIMARY_CRON && !isBackup) return;
    ctx.waitUntil(captureSnapshot(env, isBackup));
  }
};
