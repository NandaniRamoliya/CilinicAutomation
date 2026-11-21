// ---------------------------------------------------------------------------
// dates.js — timezone-safe date/time helpers.
// All dates in the Sheet are plain text "YYYY-MM-DD", times are "HH:MM" (24h).
// This file is compiled into n8n Code nodes by scripts/build.js, so it must be
// plain JavaScript with no imports (the strip blocks are removed at build time).
// ---------------------------------------------------------------------------

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Today's date (YYYY-MM-DD) in the clinic's timezone. */
function todayIn(tz, now) {
  const d = now instanceof Date ? now : new Date();
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

/** Current time (HH:MM, 24h) in the clinic's timezone. */
function timeIn(tz, now) {
  const d = now instanceof Date ? now : new Date();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d);
  const h = parts.find((p) => p.type === 'hour').value;
  const m = parts.find((p) => p.type === 'minute').value;
  return pad2(h) + ':' + pad2(m);
}

function isIsoDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Add n calendar days to an ISO date string. */
function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Whole days from iso a to iso b (b - a). */
function daysBetween(a, b) {
  const ta = Date.parse(a + 'T00:00:00Z');
  const tb = Date.parse(b + 'T00:00:00Z');
  return Math.round((tb - ta) / 86400000);
}

function weekdayName(iso) {
  return WEEKDAYS[new Date(iso + 'T00:00:00Z').getUTCDay()];
}

/**
 * Normalise whatever a form / Google Sheet gives us into YYYY-MM-DD.
 * Handles: "2026-11-18", "2026-11-18T00:00:00.000Z", "18/11/2026", "18-11-2026",
 * "11/18/2026" (only when order === 'MDY'), and Google serial numbers (45980).
 * Returns '' when it cannot be parsed.
 */
function normalizeDate(value, order) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number' && value > 20000 && value < 80000) {
    // Google Sheets / Excel serial date (days since 1899-12-30)
    return new Date(Date.UTC(1899, 11, 30) + value * 86400000).toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  const iso = s.slice(0, 10);
  if (isIsoDate(iso)) return iso;
  const m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = m[3];
    const [day, month] = order === 'MDY' ? [b, a] : [a, b];
    const out = y + '-' + pad2(month) + '-' + pad2(day);
    return isIsoDate(out) ? out : '';
  }
  return '';
}

/**
 * Normalise a time into HH:MM (24h). Accepts "9:5", "09:05", "17:30",
 * "5:30 PM", "5 pm", "17:30:00", and Sheets day-fractions (0.729166 = 17:30).
 */
function normalizeTime(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number' && value >= 0 && value < 1) {
    const total = Math.round(value * 24 * 60);
    return pad2(Math.floor(total / 60)) + ':' + pad2(total % 60);
  }
  const s = String(value).trim().toLowerCase();
  const m = s.match(/^(\d{1,2})(?:[:.](\d{1,2}))?(?::\d{2})?\s*(am|pm)?$/);
  if (!m) return '';
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return '';
  return pad2(h) + ':' + pad2(min);
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function fromMinutes(total) {
  return pad2(Math.floor(total / 60)) + ':' + pad2(total % 60);
}

/** "2026-11-18" -> "18 Nov 2026" */
function displayDate(iso) {
  if (!isIsoDate(iso)) return iso || '';
  const [y, m, d] = iso.split('-').map(Number);
  return d + ' ' + MONTHS[m - 1] + ' ' + y;
}

/** "17:30" -> "5:30 PM" */
function displayTime(hhmm) {
  const t = normalizeTime(hhmm);
  if (!t) return hhmm || '';
  let [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 === 0 ? 12 : h % 12;
  return h + ':' + pad2(m) + ' ' + ampm;
}

/* n8n:strip-start */
module.exports = {
  WEEKDAYS, MONTHS, pad2, todayIn, timeIn, isIsoDate, addDays, daysBetween, weekdayName,
  normalizeDate, normalizeTime, toMinutes, fromMinutes, displayDate, displayTime,
};
/* n8n:strip-end */
