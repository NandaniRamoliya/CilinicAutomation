// ---------------------------------------------------------------------------
// reminders.js — decides WHO gets a WhatsApp reminder right now.
// Depends on: dates.js, sheet.js, booking.js, whatsapp.js
// ---------------------------------------------------------------------------
/* n8n:strip-start */
const { todayIn, timeIn, addDays, toMinutes } = require('./dates');
const { STATUS } = require('./sheet');
const { upcomingForPhone } = require('./booking');
const { templateFields, buildTemplatePayload } = require('./whatsapp');
/* n8n:strip-end */

/**
 * mode 'evening'  : appointment reminder for TOMORROW's bookings
 *                   + follow-up reminder when follow_up_date is TOMORROW
 * mode 'same_day' : appointment reminder N hours before today's bookings
 *
 * Safety rules (all modes):
 *  - only whatsapp_consent = Yes and a phone number present
 *  - at most one reminder per row per day (last_reminder_date)
 *  - no follow-up nudge if the patient already has a new booking
 */
function selectReminders(rows, config, now, mode) {
  const tz = config.locale.timezone;
  const today = todayIn(tz, now);
  const tomorrow = addDays(today, 1);
  const r = config.reminders || {};
  const tpls = config.whatsapp.templates || {};
  const out = [];

  for (const row of rows) {
    if (row.whatsapp_consent !== 'Yes' || !row.phone) continue;
    if (row.last_reminder_date === today) continue;

    let type = '';
    if (mode === 'same_day') {
      const hours = Number(r.same_day_hours_before || 0);
      if (!hours || row.status !== STATUS.BOOKED || row.appt_date !== today) continue;
      const diff = toMinutes(row.appt_time) - toMinutes(timeIn(tz, now));
      if (diff > 0 && diff <= hours * 60) type = 'appointment_reminder';
    } else {
      if (r.appointment_day_before !== false && row.status === STATUS.BOOKED && row.appt_date === tomorrow) {
        type = 'appointment_reminder';
      } else if (r.follow_up !== false && row.status === STATUS.COMPLETED && row.follow_up_date === tomorrow) {
        if (upcomingForPhone(rows, row.phone, today).length === 0) type = 'follow_up_reminder';
      }
    }
    if (!type) continue;
    const tpl = tpls[type];
    if (!tpl || !tpl.name) continue;
    const fields = templateFields(row, config);
    out.push({
      appointment_id: row.appointment_id,
      phone: row.phone,
      reminder_type: type,
      wa_payload: buildTemplatePayload(row.phone, tpl, fields),
    });
  }
  return out;
}

/* n8n:strip-start */
module.exports = { selectReminders };
/* n8n:strip-end */
