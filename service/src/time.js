// Schedule time computation: cron (5/6-field), rate, one-shot and timezone math.
// Wall-clock semantics follow the task timezone (Intl-based); DST gaps are
// skipped and ambiguous times resolve to the earlier instant, like standard
// cron implementations.

const TZ_PARTS_CACHE = new Map();

function tzFormatter(timeZone) {
  let fmt = TZ_PARTS_CACHE.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
    });
    TZ_PARTS_CACHE.set(timeZone, fmt);
  }
  return fmt;
}

export function wallClock(instantMs, timeZone) {
  const parts = tzFormatter(timeZone).formatToParts(new Date(instantMs));
  const out = {};
  for (const part of parts) out[part.type] = part.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: out.hour === '24' ? 0 : Number(out.hour),
    minute: Number(out.minute),
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(out.weekday),
  };
}

// Convert a wall-clock time in `timeZone` to the UTC instant. Returns the
// earlier instant when the time is ambiguous (fall-back) and null when the
// wall time does not exist (spring-forward gap).
export function wallToInstant({ year, month, day, hour, minute }, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  // Determine the zone offset at the guessed instant, then correct.
  const offsetMs = zoneOffsetMs(guess, timeZone);
  let candidate = guess - offsetMs;
  // Verify; if it still doesn't map back, the wall time may be in a gap or
  // the offset changed across the correction — probe a small window.
  for (const probe of [candidate, guess - zoneOffsetMs(candidate)]) {
    if (matchesWall(probe, { year, month, day, hour, minute }, timeZone)) {
      // Prefer the earlier instant in the ambiguous case: check 30/60 min earlier.
      const earlier = probe - 30 * 60 * 1000;
      if (matchesWall(earlier, { year, month, day, hour, minute }, timeZone)) return earlier;
      return probe;
    }
  }
  // Handle gap: try shifting forward up to 2h in 5-min steps — if we can find
  // the instant whose wall clock rounds to the requested time, it doesn't
  // exist; the requested wall time is a gap → return null.
  for (let shift = 5; shift <= 120; shift += 5) {
    const probe = guess + shift * 60 * 1000;
    if (matchesWall(probe, { year, month, day, hour, minute }, timeZone)) return null;
  }
  return null;
}

function matchesWall(instantMs, expected, timeZone) {
  const w = wallClock(instantMs, timeZone);
  return (
    w.year === expected.year &&
    w.month === expected.month &&
    w.day === expected.day &&
    w.hour === expected.hour &&
    w.minute === expected.minute
  );
}

function zoneOffsetMs(instantMs, timeZone) {
  const w = wallClock(instantMs, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
  return asUtc - Math.floor(instantMs / 60000) * 60000;
}

export function isValidTimezone(timeZone) {
  try {
    tzFormatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- cron

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DOW_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function parseField(field, min, max, names, allowSeven) {
  const values = new Set();
  for (const piece of field.split(',')) {
    const match = piece.match(/^([^\/-]+)(?:-([^\/]+))?(?:\/(\d+))?$/);
    if (!match) throw new Error(`invalid cron field: ${field}`);
    const startToken = match[1];
    const endToken = match[2]; // absent → single value
    const step = match[3] ? Number(match[3]) : 1;
    if (!Number.isInteger(step) || step < 1) throw new Error(`invalid step in cron field: ${field}`);
    const isStar = startToken === '*';
    let start = isStar ? min : resolveName(startToken, names);
    let end = endToken !== undefined ? resolveName(endToken, names) : start;
    if (isStar && endToken === undefined) {
      end = max;
    }
    if (start < min || end > max || start > end) {
      if (!(allowSeven && start === 7 && end === 7)) {
        throw new Error(`cron value out of range: ${field}`);
      }
      start = 0;
      end = 0;
    }
    for (let v = start; v <= end; v += step) values.add(v);
  }
  if (values.size === 0) throw new Error(`empty cron field: ${field}`);
  return values;
}

function resolveName(token, names) {
  const numeric = Number(token);
  if (Number.isInteger(numeric)) return numeric;
  const index = names.indexOf(String(token).toLowerCase().slice(0, 3));
  if (index === -1) throw new Error(`unknown cron name: ${token}`);
  return index;
}

export function parseCron(expr) {
  const fields = String(expr)
    .trim()
    .split(/\s+/);
  let seconds = new Set([0]);
  let rest = fields;
  if (fields.length === 6) {
    seconds = parseField(fields[0], 0, 59, null, false);
    rest = fields.slice(1);
  } else if (fields.length !== 5) {
    throw new Error('cron must have 5 fields (min hour day month dow) or 6 (sec min hour day month dow)');
  }
  const minute = parseField(rest[0], 0, 59, null, false);
  const hour = parseField(rest[1], 0, 23, null, false);
  const dayOfMonth = parseField(rest[2], 1, 31, null, false);
  const month = parseField(rest[3], 1, 12, MONTH_NAMES, false);
  // E-197: vixie-cron accepts 7 as a Sunday alias for 0. The dow field range
  // is 0-7, so the alias survives parseField as a literal 7 — but
  // dayMatches() compares against weekday 0-6, where 7 never matches. That
  // made every "每周日" task built by the UI picker ("… * * 7") compute
  // nextRunAt = null and never schedule at all. Normalize 7 → 0 here.
  const dayOfWeek = new Set([...parseField(rest[4], 0, 7, DOW_NAMES, true)].map((v) => v % 7));
  // RFC nuance: if both dom and dow are restricted, either may match.
  const domStar = /^\*/.test(rest[2]) || /^.*\/.*$/.test(rest[2]) && rest[2].split('/')[1] !== undefined && /^\*/.test(rest[2].split('/')[0]);
  const dowStar = /^\*/.test(rest[4]) || /^\*\/\d+/.test(rest[4]);
  return {
    seconds: [...seconds].sort((a, b) => a - b),
    minute: [...minute].sort((a, b) => a - b),
    hour: [...hour].sort((a, b) => a - b),
    dayOfMonth: [...dayOfMonth].sort((a, b) => a - b),
    month: [...month].sort((a, b) => a - b),
    dayOfWeek: [...dayOfWeek].sort((a, b) => a - b),
    domRestricted: !domStar,
    dowRestricted: !dowStar,
  };
}

export function nextCronInstant(parsed, afterMs, timeZone) {
  const start = new Date(afterMs + 1000);
  let w = wallClock(start.getTime(), timeZone);
  for (let dayOffset = 0; dayOffset < 800; dayOffset += 1) {
    const dayInstant = wallToInstant(
      { year: w.year, month: w.month, day: w.day, hour: 0, minute: 0 },
      timeZone,
    );
    if (dayInstant === null) {
      w = advanceDay(w);
      continue;
    }
    const dayWall = wallClock(dayInstant, timeZone);
    if (dayMatches(parsed, dayWall)) {
      for (const hour of parsed.hour) {
        for (const minute of parsed.minute) {
          for (const second of parsed.seconds) {
            const instant = wallToInstant(
              { year: dayWall.year, month: dayWall.month, day: dayWall.day, hour, minute },
              timeZone,
            );
            if (instant === null) continue; // DST gap: skip
            if (instant + second * 1000 > afterMs) return instant + second * 1000;
          }
        }
      }
    }
    w = advanceDay(w);
  }
  return null;
}

function dayMatches(parsed, wall) {
  if (!parsed.month.includes(wall.month)) return false;
  const domOk = parsed.dayOfMonth.includes(wall.day);
  const dowOk = parsed.dayOfWeek.includes(wall.weekday);
  if (parsed.domRestricted && parsed.dowRestricted) return domOk || dowOk;
  if (parsed.domRestricted) return domOk;
  if (parsed.dowRestricted) return dowOk;
  return true;
}

function advanceDay(w) {
  // Move wall clock forward one day using UTC math on the wall date.
  const next = new Date(Date.UTC(w.year, w.month - 1, w.day + 1, 12));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
    hour: 0,
    minute: 0,
    weekday: (w.weekday + 1) % 7,
  };
}

// ---------------------------------------------------------------- specs

export const SPEC_KINDS = ['one_shot', 'cron', 'rate', 'timeline'];

export function validateScheduleSpec(spec) {
  if (!spec || typeof spec !== 'object') throw new Error('scheduleSpec must be an object');
  const kind = spec.kind;
  const timezone = spec.timezone || 'Asia/Shanghai';
  if (!isValidTimezone(timezone)) throw new Error(`unknown timezone: ${timezone}`);
  if (!SPEC_KINDS.includes(kind)) throw new Error(`scheduleSpec.kind must be one of ${SPEC_KINDS.join(', ')}`);
  if (kind === 'one_shot') {
    if (!Number.isFinite(spec.dateTime)) throw new Error('one_shot requires dateTime (unix seconds)');
  } else if (kind === 'cron') {
    parseCron(String(spec.expr || ''));
  } else if (kind === 'rate') {
    if (!Number.isFinite(spec.intervalMinutes) || spec.intervalMinutes < 1) {
      throw new Error('rate requires intervalMinutes >= 1');
    }
  } else if (kind === 'timeline') {
    if (!spec.project || typeof spec.project !== 'string') throw new Error('timeline requires project');
    if (!spec.milestone || typeof spec.milestone !== 'string') throw new Error('timeline requires milestone');
    if (!Number.isFinite(spec.offsetDays)) spec.offsetDays = 0;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(spec.time || ''))) {
      throw new Error('timeline requires time as HH:MM');
    }
  }
  return true;
}

// Next due instant for a task, in unix seconds (null = no future occurrence).
export function nextRunAt(task, fromMs = Date.now()) {
  const raw = task.scheduleSpec ?? task.schedule_spec;
  const spec = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!spec || typeof spec !== 'object') return null;
  const tz = spec.timezone || task.timezone || 'Asia/Shanghai';
  if (spec.kind === 'one_shot') {
    return spec.dateTime > Math.floor(fromMs / 1000) + 1 ? spec.dateTime : null;
  }
  if (spec.kind === 'cron') {
    const parsed = parseCron(spec.expr);
    const instant = nextCronInstant(parsed, fromMs, tz);
    return instant === null ? null : Math.floor(instant / 1000);
  }
  if (spec.kind === 'rate') {
    const anchorMs = task.last_run_at ? task.last_run_at * 1000 : fromMs;
    return Math.floor((anchorMs + spec.intervalMinutes * 60000) / 1000);
  }
  // timeline: computed by the timeline module (needs release data)
  return null;
}

export function wallTimeString(instantSec, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(instantSec * 1000)).replace(',', '');
}
