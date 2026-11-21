// Load, default and validate a client's client.config.json.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const CLIENTS_DIR = path.join(ROOT, 'clients');

const REMINDER_FIELDS = [
  'patient_name', 'first_name', 'doctor', 'clinic_name', 'clinic_phone', 'clinic_address', 'appointment_id',
  'appt_date', 'display_date', 'appt_time', 'display_time', 'follow_up_date', 'follow_up_display_date',
];
const REPORT_FIELDS = ['clinic_name', 'date', 'total', 'completed', 'no_show', 'not_updated', 'collection', 'pending', 'tomorrow'];

const DEFAULTS = {
  locale: { timezone: 'Asia/Kolkata', country_code: '91', local_phone_length: 10, currency: 'Rs', sheet_date_order: 'DMY' },
  google: { appointments_tab: 'Appointments' },
  schedule: { slot_minutes: 15, closed_weekdays: ['Sunday'], holidays: [], patients_per_slot: 1, max_days_ahead: 60 },
  visit_types: ['New', 'Follow-up'],
  follow_up_options_days: [7, 15, 30],
  payment_modes: ['Cash', 'UPI', 'Card'],
  notifications: { report_emails: [], report_whatsapp_numbers: [] },
  schedules: { reminder_cron: '0 18 * * *', report_cron: '0 21 * * *', same_day_reminder_cron: '0 8-19 * * *' },
  reminders: { appointment_day_before: true, follow_up: true, same_day_hours_before: 0 },
  whatsapp: { enabled: true, graph_api_version: 'v21.0', templates: {} },
  features: { booking_confirmation_whatsapp: false, doctor_report_whatsapp: false, razorpay_advance_fee: false, ai_whatsapp_assistant: false },
  ai_assistant: { provider: 'openai', model: 'gpt-4.1-mini', verify_token: 'AUTO', memory_messages: 12, languages: 'English, Hindi, Hinglish', emergency_number: '112', extra_clinic_info: '' },
  n8n: { credentials: {}, workflow_ids: { error_handler: '', booking_engine: '' } },
};

const DEFAULT_CREDENTIAL_NAMES = {
  google_sheets: 'Google Sheets (clinic)',
  gmail: 'Gmail (alerts)',
  whatsapp: 'WhatsApp Cloud API',
};

function isObj(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function merge(def, val) {
  if (!isObj(def) || !isObj(val)) return val === undefined ? def : val;
  const out = Object.assign({}, def);
  for (const k of Object.keys(val)) out[k] = merge(def[k], val[k]);
  return out;
}

function configPath(slug) {
  return path.join(CLIENTS_DIR, slug, 'client.config.json');
}

function listClients() {
  return fs.readdirSync(CLIENTS_DIR).filter((d) => !d.startsWith('_') && fs.existsSync(configPath(d)));
}

function loadConfig(slug) {
  const file = configPath(slug);
  if (!fs.existsSync(file)) throw new Error('No config at ' + path.relative(ROOT, file) + '. Run: npm run new-client -- ' + slug);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete raw._readme;
  const config = merge(DEFAULTS, raw);
  if (config.ai_assistant.verify_token === 'AUTO') {
    config.ai_assistant.verify_token = 'verify-' + crypto.createHash('sha256').update('clinic-kit|' + config.client.slug + '|' + config.google.sheet_id).digest('hex').slice(0, 20);
  }
  const errors = validateConfig(config, slug);
  if (errors.length) {
    const e = new Error('client.config.json for "' + slug + '" has ' + errors.length + ' problem(s):\n  - ' + errors.join('\n  - '));
    e.problems = errors;
    throw e;
  }
  return config;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function validateSessions(sessions, where, errors) {
  if (!Array.isArray(sessions) || !sessions.length) errors.push(where + ': needs at least one session {start,end}');
  for (const s of sessions || []) {
    if (!TIME_RE.test(s.start) || !TIME_RE.test(s.end)) errors.push(where + ': session times must be HH:MM (24h), got ' + JSON.stringify(s));
    else if (s.start >= s.end) errors.push(where + ': session start must be before end, got ' + s.start + '-' + s.end);
  }
}

function validateWeekdays(list, where, errors) {
  for (const w of list || []) {
    if (!WEEKDAYS.includes(String(w).toLowerCase()) && !WEEKDAYS.map((x) => x.slice(0, 3)).includes(String(w).toLowerCase())) {
      errors.push(where + ': unknown weekday "' + w + '"');
    }
  }
}

function validateConfig(c, slug) {
  const errors = [];
  const json = JSON.stringify(c);
  const placeholders = [...new Set((json.match(/REPLACE_[^"]*/g) || []))];
  if (placeholders.length) errors.push('Fill the placeholders: ' + placeholders.join(' | '));

  if (c.client.slug !== slug) errors.push('client.slug must equal the folder name "' + slug + '"');
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(c.client.slug || '')) errors.push('client.slug: lowercase letters, digits and dashes only');
  for (const k of ['clinic_name', 'short_name']) if (!c.client[k]) errors.push('client.' + k + ' is required');
  try { new Intl.DateTimeFormat('en', { timeZone: c.locale.timezone }); } catch (e) { errors.push('locale.timezone "' + c.locale.timezone + '" is not a valid IANA timezone'); }
  if (!['DMY', 'MDY'].includes(c.locale.sheet_date_order)) errors.push('locale.sheet_date_order must be DMY or MDY');
  if (!c.google.sheet_id) errors.push('google.sheet_id is required');

  if (!Array.isArray(c.doctors) || !c.doctors.length) errors.push('doctors: add at least one doctor');
  const names = (c.doctors || []).map((d) => (typeof d === 'string' ? d : d && d.name));
  if (names.some((n) => !n)) errors.push('doctors: every doctor needs a name');
  if (new Set(names.map((n) => String(n).toLowerCase())).size !== names.length) errors.push('doctors: duplicate names');

  validateSessions(c.schedule.sessions, 'schedule.sessions', errors);
  validateWeekdays(c.schedule.closed_weekdays, 'schedule.closed_weekdays', errors);
  for (const d of c.doctors || []) {
    if (d && typeof d === 'object') {
      if (d.sessions) validateSessions(d.sessions, 'doctor "' + d.name + '" sessions', errors);
      validateWeekdays(d.closed_weekdays, 'doctor "' + d.name + '" closed_weekdays', errors);
    }
  }
  if (!(c.schedule.slot_minutes >= 5 && c.schedule.slot_minutes <= 240)) errors.push('schedule.slot_minutes must be 5-240');
  for (const h of c.schedule.holidays || []) if (!/^\d{4}-\d{2}-\d{2}$/.test(h)) errors.push('schedule.holidays: use YYYY-MM-DD, got "' + h + '"');

  if (!EMAIL_RE.test(c.notifications.admin_email || '')) errors.push('notifications.admin_email must be an email (you / your agency)');
  if (!c.notifications.report_emails.length) errors.push('notifications.report_emails: add the doctor/owner email');
  for (const e of c.notifications.report_emails) if (!EMAIL_RE.test(e)) errors.push('notifications.report_emails: "' + e + '" is not an email');

  for (const [k, v] of Object.entries(c.schedules)) {
    if (String(v).trim().split(/\s+/).length !== 5) errors.push('schedules.' + k + ' must be a 5-field cron, got "' + v + '"');
  }

  if (c.whatsapp.enabled) {
    if (!c.whatsapp.phone_number_id) errors.push('whatsapp.phone_number_id is required when whatsapp.enabled');
    const need = ['appointment_reminder'];
    if (c.reminders.follow_up) need.push('follow_up_reminder');
    if (c.features.booking_confirmation_whatsapp) need.push('booking_confirmation');
    if (c.features.doctor_report_whatsapp) need.push('doctor_report');
    for (const k of need) {
      const t = c.whatsapp.templates[k];
      if (!t || !t.name) errors.push('whatsapp.templates.' + k + '.name is required');
    }
    for (const [k, t] of Object.entries(c.whatsapp.templates)) {
      const allowed = k === 'doctor_report' ? REPORT_FIELDS : REMINDER_FIELDS;
      for (const p of (t && t.params) || []) {
        if (!allowed.includes(p)) errors.push('whatsapp.templates.' + k + ': unknown param "' + p + '". Allowed: ' + allowed.join(', '));
      }
    }
    if (c.features.doctor_report_whatsapp && !c.notifications.report_whatsapp_numbers.length) {
      errors.push('notifications.report_whatsapp_numbers: needed for doctor_report_whatsapp');
    }
  } else {
    for (const f of ['booking_confirmation_whatsapp', 'doctor_report_whatsapp', 'ai_whatsapp_assistant']) {
      if (c.features[f]) errors.push('features.' + f + ' needs whatsapp.enabled = true');
    }
  }
  if (c.features.ai_whatsapp_assistant) {
    if (!['openai', 'anthropic'].includes(c.ai_assistant.provider)) errors.push('ai_assistant.provider must be openai or anthropic');
    if (!c.ai_assistant.model) errors.push('ai_assistant.model is required');
    if (!c.client.clinic_phone) errors.push('client.clinic_phone is required for the AI assistant (human handoff)');
  }
  return errors;
}

/** What gets frozen into Code nodes: everything except n8n credential refs + verify token. */
function runtimeConfig(c) {
  const r = JSON.parse(JSON.stringify(c));
  delete r.n8n;
  delete r.ai_assistant;
  return r;
}

module.exports = {
  ROOT, CLIENTS_DIR, DEFAULTS, DEFAULT_CREDENTIAL_NAMES, REMINDER_FIELDS, REPORT_FIELDS,
  loadConfig, validateConfig, runtimeConfig, listClients, configPath, merge,
};
