// ---------------------------------------------------------------------------
// sheet.js — the Appointments tab schema and row cleanup.
// Depends on: dates.js
// ---------------------------------------------------------------------------
/* n8n:strip-start */
const { normalizeDate, normalizeTime } = require('./dates');
/* n8n:strip-end */

// Exact header row of the "Appointments" tab (A..O). n8n matches by name —
// never rename these in a client's sheet.
const APPOINTMENT_COLUMNS = [
  'appointment_id', 'patient_name', 'phone', 'doctor', 'appt_date', 'appt_time',
  'visit_type', 'status', 'payment_status', 'amount_paid', 'payment_mode',
  'follow_up_date', 'whatsapp_consent', 'last_reminder_date', 'booked_on',
];

const STATUS = { BOOKED: 'Booked', COMPLETED: 'Completed', NO_SHOW: 'No-show', CANCELLED: 'Cancelled' };

/**
 * Google Sheets can hand back numbers, formatted dates or stray spaces if a
 * receptionist typed into the sheet by hand. Clean every row before using it.
 */
function normalizeRow(raw, config) {
  const order = (config && config.locale && config.locale.sheet_date_order) || 'DMY';
  const r = {};
  for (const col of APPOINTMENT_COLUMNS) {
    const v = raw[col];
    r[col] = v === undefined || v === null ? '' : typeof v === 'string' ? v.trim() : v;
  }
  r.appointment_id = String(r.appointment_id).toUpperCase();
  r.phone = String(r.phone).replace(/\D/g, '');
  r.appt_date = normalizeDate(r.appt_date, order);
  r.appt_time = normalizeTime(r.appt_time);
  r.follow_up_date = normalizeDate(r.follow_up_date, order);
  r.last_reminder_date = normalizeDate(r.last_reminder_date, order);
  r.booked_on = normalizeDate(r.booked_on, order);
  r.amount_paid = r.amount_paid === '' ? '' : Number(r.amount_paid) || 0;
  r.status = canonicalStatus(r.status);
  if (raw.row_number !== undefined) r.row_number = raw.row_number;
  return r;
}

function canonicalStatus(s) {
  const k = String(s || '').toLowerCase().replace(/[\s_-]/g, '');
  if (k === 'booked' || k === '') return STATUS.BOOKED;
  if (k === 'completed' || k === 'done') return STATUS.COMPLETED;
  if (k === 'noshow') return STATUS.NO_SHOW;
  if (k === 'cancelled' || k === 'canceled') return STATUS.CANCELLED;
  return String(s);
}

/** Only rows that actually are appointments (skip blank / half-typed lines). */
function cleanRows(items, config) {
  return items
    .map((r) => normalizeRow(r, config))
    .filter((r) => r.appointment_id && r.appt_date);
}

/** Full 15-column object with '' defaults — what we append to the sheet. */
function toSheetRow(partial) {
  const out = {};
  for (const col of APPOINTMENT_COLUMNS) out[col] = partial[col] === undefined ? '' : partial[col];
  return out;
}

/* n8n:strip-start */
module.exports = { APPOINTMENT_COLUMNS, STATUS, normalizeRow, canonicalStatus, cleanRows, toSheetRow };
/* n8n:strip-end */
