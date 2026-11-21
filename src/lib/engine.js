// ---------------------------------------------------------------------------
// engine.js — the booking engine behind the WhatsApp AI receptionist.
// The AI never writes to the sheet itself: it calls these deterministic
// actions (as n8n tools), so availability and double-booking rules are code,
// not model guesses.
// Depends on: dates.js, phone.js, schedule.js, sheet.js, booking.js
// ---------------------------------------------------------------------------
/* n8n:strip-start */
const { todayIn, addDays, normalizeDate, displayDate, displayTime } = require('./dates');
const { normalizePhone } = require('./phone');
const { doctorNames, isOpenDay } = require('./schedule');
const { STATUS } = require('./sheet');
const { cleanBooking, checkBooking, availableSlots, upcomingForPhone } = require('./booking');
/* n8n:strip-end */

/**
 * args: { action, doctor, date, time, patient_name, visit_type, appointment_id, phone }
 * `phone` is ALWAYS the WhatsApp sender's number (set by the workflow, not the AI),
 * so a patient can only see / cancel their own appointments.
 * returns { response: string for the AI, write: 'none'|'append'|'update', row }
 */
function runEngine(args, rows, config, now, rand) {
  const tz = config.locale.timezone;
  const today = todayIn(tz, now);
  const phone = normalizePhone(args.phone, config.locale.country_code, config.locale.local_phone_length);
  const action = String(args.action || '').toLowerCase();
  const none = (response) => ({ response, write: 'none', row: null });

  if (action === 'availability') {
    const docs = args.doctor ? [args.doctor] : doctorNames(config);
    const start = normalizeDate(args.date, config.locale.sheet_date_order) || today;
    const lines = [];
    for (const doc of docs) {
      if (!doctorNames(config).some((d) => d.toLowerCase() === String(doc).toLowerCase())) {
        lines.push('Unknown doctor "' + doc + '". Doctors: ' + doctorNames(config).join(', '));
        continue;
      }
      // requested date first, then the next open days, until 3 days with free slots are found
      let found = 0;
      for (let i = 0; i < 14 && found < (args.date ? 1 : 3); i++) {
        const d = addDays(start, i);
        if (!isOpenDay(config, doc, d).open) {
          if (i === 0 && args.date) lines.push(doc + ' is not available on ' + displayDate(d) + ' (' + isOpenDay(config, doc, d).reason + ').');
          continue;
        }
        const free = availableSlots(config, rows, doc, d, now);
        if (free.length) {
          found++;
          lines.push(doc + ' on ' + displayDate(d) + ' (' + d + '): ' + free.slice(0, 12).map(displayTime).join(', ') + (free.length > 12 ? ' …' : ''));
        } else if (i === 0 && args.date) {
          lines.push(doc + ' is fully booked on ' + displayDate(d) + '.');
        }
      }
      if (!found && !args.date) lines.push('No free slots for ' + doc + ' in the next 2 weeks.');
    }
    return none(lines.join('\n') || 'No availability found.');
  }

  if (action === 'book') {
    const { booking, errors } = cleanBooking({
      patient_name: args.patient_name,
      phone,
      doctor: args.doctor,
      appt_date: args.date,
      appt_time: args.time,
      visit_type: args.visit_type,
      whatsapp_consent: 'Yes', // the patient is messaging us on WhatsApp
      reject_past_times_today: true,
    }, config, now);
    if (errors.length) return none('NOT BOOKED. ' + errors.join(' '));
    const res = checkBooking(booking, rows, config, now, rand);
    if (!res.ok) {
      return none('NOT BOOKED. ' + res.errors.join(' ') + (res.suggestions.length ? ' Free slots that day: ' + res.suggestions.map(displayTime).join(', ') + '.' : ''));
    }
    const b = res.booking;
    return {
      response: 'BOOKED. Appointment ID ' + b.appointment_id + ' — ' + b.patient_name + ' with ' + b.doctor + ' on ' + displayDate(b.appt_date) + ' at ' + displayTime(b.appt_time) + '.',
      write: 'append',
      row: b,
    };
  }

  if (action === 'my_appointments') {
    const list = upcomingForPhone(rows, phone, today);
    if (!list.length) return none('No upcoming appointments for this WhatsApp number.');
    return none(list.map((r) => r.appointment_id + ': ' + r.doctor + ', ' + displayDate(r.appt_date) + ' at ' + displayTime(r.appt_time)).join('\n'));
  }

  if (action === 'cancel') {
    const id = String(args.appointment_id || '').trim().toUpperCase();
    const row = rows.find((r) => r.appointment_id === id);
    if (!row || row.phone !== phone) return none('NOT CANCELLED. No appointment ' + id + ' found for this WhatsApp number.');
    if (row.status !== STATUS.BOOKED) return none('NOT CANCELLED. ' + id + ' is already ' + row.status + '.');
    if (row.appt_date < today) return none('NOT CANCELLED. ' + id + ' was in the past.');
    return {
      response: 'CANCELLED. ' + id + ' (' + row.doctor + ', ' + displayDate(row.appt_date) + ' ' + displayTime(row.appt_time) + ').',
      write: 'update',
      row: { appointment_id: id, status: STATUS.CANCELLED },
    };
  }

  return none('Unknown action "' + action + '". Use availability, book, my_appointments or cancel.');
}

/**
 * Pull the patient's text message(s) out of a WhatsApp Cloud API webhook.
 * Status callbacks (sent/delivered/read) return [] and are ignored.
 */
function parseIncomingWhatsApp(body) {
  const out = [];
  for (const entry of (body && body.entry) || []) {
    for (const change of entry.changes || []) {
      const v = change.value || {};
      const contacts = v.contacts || [];
      for (const m of v.messages || []) {
        const contact = contacts.find((c) => c.wa_id === m.from) || contacts[0] || {};
        let text = '';
        if (m.type === 'text') text = (m.text && m.text.body) || '';
        else if (m.type === 'interactive') {
          const i = m.interactive || {};
          text = (i.button_reply && i.button_reply.title) || (i.list_reply && i.list_reply.title) || '';
        } else if (m.type === 'button') text = (m.button && m.button.text) || '';
        out.push({
          message_id: m.id,
          from: m.from,
          profile_name: (contact.profile && contact.profile.name) || '',
          type: m.type,
          text: String(text).slice(0, 1000),
          phone_number_id: (v.metadata && v.metadata.phone_number_id) || '',
        });
      }
    }
  }
  return out;
}

/* n8n:strip-start */
module.exports = { runEngine, parseIncomingWhatsApp };
/* n8n:strip-end */
