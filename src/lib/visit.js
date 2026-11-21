// ---------------------------------------------------------------------------
// visit.js — after the patient leaves: status, payment and follow-up date.
// Depends on: dates.js, schedule.js, sheet.js
// ---------------------------------------------------------------------------
/* n8n:strip-start */
const { todayIn, addDays, displayDate } = require('./dates');
const { nextOpenDay } = require('./schedule');
const { STATUS, canonicalStatus } = require('./sheet');
/* n8n:strip-end */

function parseFollowUpDays(v) {
  if (v === undefined || v === null || v === '') return 0;
  const m = String(v).match(/\d+/);
  if (!m) return 0;
  const n = Number(m[0]);
  return /week/i.test(String(v)) ? n * 7 : /month/i.test(String(v)) ? n * 30 : n;
}

/**
 * form: { appointment_id, status, amount_paid, payment_mode, follow_up_after }
 * row : the matching (normalised) sheet row, or undefined
 * returns { error } or { update, message }
 *   update contains ONLY the columns to change (+ appointment_id to match on)
 */
function computeVisitUpdate(form, row, config, now) {
  const id = String(form.appointment_id || '').trim().toUpperCase();
  if (!row) return { error: 'Appointment ID "' + id + '" was not found. Check the ID in the Dashboard tab.' };

  const tz = config.locale.timezone;
  const today = todayIn(tz, now);
  const status = canonicalStatus(form.status);
  if (![STATUS.COMPLETED, STATUS.NO_SHOW, STATUS.CANCELLED, STATUS.BOOKED].includes(status)) {
    return { error: 'Unknown status "' + form.status + '".' };
  }
  if ((status === STATUS.COMPLETED || status === STATUS.NO_SHOW) && row.appt_date > today) {
    return { error: row.appointment_id + ' is for ' + displayDate(row.appt_date) + ' (future). Only today\'s or past visits can be marked ' + status + '. Did you type the right ID?' };
  }

  const update = { appointment_id: row.appointment_id, status };
  let message = row.appointment_id + ' (' + row.patient_name + ') marked ' + status + '.';

  if (status === STATUS.COMPLETED) {
    const counter = Number(form.amount_paid) || 0;
    const mode = String(form.payment_mode || 'Pending');
    const advance = /^online/i.test(String(row.payment_mode)) ? Number(row.amount_paid) || 0 : 0;
    const total = advance + counter;
    update.amount_paid = total;
    update.payment_mode = advance ? (counter ? 'Online+' + mode : 'Online') : mode;
    if (/^free$/i.test(mode)) {
      update.payment_status = 'Free';
      update.amount_paid = advance;
    } else {
      update.payment_status = total > 0 && (advance || mode !== 'Pending') ? 'Paid' : 'Pending';
    }
    const days = parseFollowUpDays(form.follow_up_after);
    if (days > 0) {
      const base = row.appt_date && row.appt_date <= today ? row.appt_date : today;
      update.follow_up_date = nextOpenDay(config, row.doctor, addDays(base, days));
      message += ' Follow-up on ' + displayDate(update.follow_up_date) + '.';
    } else {
      update.follow_up_date = '';
    }
    message += ' Payment: ' + update.payment_status + (update.amount_paid ? ' (' + config.locale.currency + ' ' + update.amount_paid + ')' : '') + '.';
  } else {
    update.follow_up_date = '';
  }
  return { update, message };
}

/* n8n:strip-start */
module.exports = { parseFollowUpDays, computeVisitUpdate };
/* n8n:strip-end */
