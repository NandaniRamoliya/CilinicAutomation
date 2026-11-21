// ---------------------------------------------------------------------------
// booking.js — validate a booking request and check it against the sheet.
// Used by BOTH the reception booking form and the WhatsApp AI assistant, so
// the rules (double booking, closed days, duplicates) are identical everywhere.
// Depends on: dates.js, phone.js, schedule.js, sheet.js
// ---------------------------------------------------------------------------
/* n8n:strip-start */
const { todayIn, timeIn, normalizeDate, normalizeTime, daysBetween, displayDate, displayTime, toMinutes } = require('./dates');
const { normalizePhone, isValidPhone } = require('./phone');
const { doctorSchedule, slotsForDoctor, isOpenDay } = require('./schedule');
const { STATUS, toSheetRow } = require('./sheet');
/* n8n:strip-end */

const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I — easy to read out on phone

function newAppointmentId(existingIds, rand) {
  const r = rand || Math.random;
  const taken = existingIds instanceof Set ? existingIds : new Set(existingIds || []);
  for (let attempt = 0; attempt < 20; attempt++) {
    let id = 'APT-';
    for (let i = 0; i < 6; i++) id += ID_ALPHABET[Math.floor(r() * ID_ALPHABET.length)];
    if (!taken.has(id)) return id;
  }
  throw new Error('Could not generate a unique appointment ID');
}

/**
 * Step 1: clean + validate the request on its own (no sheet needed).
 * input: { patient_name, phone, doctor, appt_date, appt_time, visit_type, whatsapp_consent }
 * returns { booking, errors[] }
 */
function cleanBooking(input, config, now) {
  const tz = config.locale.timezone;
  const errors = [];
  const today = todayIn(tz, now);

  const name = String(input.patient_name || '').replace(/\s+/g, ' ').trim();
  if (name.length < 2) errors.push('Patient name is missing.');

  const phone = normalizePhone(input.phone, config.locale.country_code, config.locale.local_phone_length);
  if (!isValidPhone(phone, config.locale.country_code, config.locale.local_phone_length)) {
    errors.push('Phone number "' + (input.phone || '') + '" is not valid. Use a ' + config.locale.local_phone_length + '-digit mobile number.');
  }

  const ds = doctorSchedule(config, input.doctor);
  if (!ds) errors.push('Doctor "' + (input.doctor || '') + '" is not in this clinic\'s list.');
  const doctor = ds ? ds.name : String(input.doctor || '');

  const date = normalizeDate(input.appt_date, config.locale.sheet_date_order);
  if (!date) errors.push('Appointment date is missing or invalid.');

  const time = normalizeTime(input.appt_time);
  if (!time) errors.push('Time slot is missing or invalid.');

  if (date) {
    const ahead = daysBetween(today, date);
    const maxAhead = Number(config.schedule.max_days_ahead || 60);
    if (ahead < 0) errors.push('Date ' + displayDate(date) + ' is in the past.');
    else if (ahead > maxAhead) errors.push('Bookings are open only ' + maxAhead + ' days ahead.');
    if (ds) {
      const open = isOpenDay(config, doctor, date);
      if (!open.open) errors.push(open.reason + '.');
    }
    if (ahead === 0 && time && input.reject_past_times_today && time < timeIn(tz, now)) {
      errors.push('That time has already passed today.');
    }
  }
  if (ds && time && !slotsForDoctor(config, doctor).includes(time)) {
    errors.push(doctor + ' does not have a ' + displayTime(time) + ' slot.');
  }

  const visitTypes = config.visit_types || ['New', 'Follow-up'];
  const visit_type = visitTypes.find((v) => v.toLowerCase() === String(input.visit_type || '').toLowerCase()) || visitTypes[0];
  const consent = /^(yes|y|true|haan|ha)$/i.test(String(input.whatsapp_consent || '').trim()) ? 'Yes' : 'No';

  const booking = toSheetRow({
    patient_name: name,
    phone,
    doctor,
    appt_date: date,
    appt_time: time,
    visit_type,
    status: STATUS.BOOKED,
    payment_status: 'Pending',
    whatsapp_consent: consent,
    booked_on: today,
  });
  return { booking, errors };
}

function activeRows(rows) {
  return rows.filter((r) => r.status !== STATUS.CANCELLED);
}

/** Free slots for a doctor on a date, given existing sheet rows. */
function availableSlots(config, rows, doctor, date, now) {
  const ds = doctorSchedule(config, doctor);
  if (!ds || !isOpenDay(config, ds.name, date).open) return [];
  const tz = config.locale.timezone;
  const today = todayIn(tz, now);
  if (daysBetween(today, date) < 0) return [];
  const nowTime = timeIn(tz, now);
  const counts = {};
  for (const r of activeRows(rows)) {
    if (r.doctor.toLowerCase() === ds.name.toLowerCase() && r.appt_date === date) {
      counts[r.appt_time] = (counts[r.appt_time] || 0) + 1;
    }
  }
  return slotsForDoctor(config, ds.name).filter(
    (t) => (counts[t] || 0) < ds.patients_per_slot && !(date === today && t <= nowTime),
  );
}

/**
 * Step 2: check the cleaned booking against existing rows.
 * Detects: slot full (double booking), same patient already booked with the
 * same doctor that day (double submit). Suggests the next free slots.
 * returns { ok, errors[], suggestions[], booking (with appointment_id) }
 */
function checkBooking(booking, rows, config, now, rand) {
  const errors = [];
  let suggestions = [];
  const ds = doctorSchedule(config, booking.doctor);
  const sameDay = activeRows(rows).filter(
    (r) => r.appt_date === booking.appt_date && r.doctor.toLowerCase() === booking.doctor.toLowerCase(),
  );
  const inSlot = sameDay.filter((r) => r.appt_time === booking.appt_time);
  if (ds && inSlot.length >= ds.patients_per_slot) {
    errors.push(booking.doctor + ' already has ' + inSlot.length + ' booking(s) at ' + displayTime(booking.appt_time) + ' on ' + displayDate(booking.appt_date) + '.');
    // the 3 free slots closest to the requested time (ties go to the later slot)
    const want = toMinutes(booking.appt_time);
    suggestions = availableSlots(config, rows, booking.doctor, booking.appt_date, now)
      .map((t) => ({ t, d: Math.abs(toMinutes(t) - want), later: toMinutes(t) > want ? 0 : 1 }))
      .sort((a, b) => a.d - b.d || a.later - b.later)
      .slice(0, 3)
      .map((x) => x.t)
      .sort();
  }
  const dup = sameDay.find((r) => r.phone === booking.phone && r.status === STATUS.BOOKED);
  if (dup) {
    errors.push('This patient already has appointment ' + dup.appointment_id + ' with ' + dup.doctor + ' at ' + displayTime(dup.appt_time) + ' that day.');
  }
  const ids = new Set(rows.map((r) => r.appointment_id));
  const out = Object.assign({}, booking, { appointment_id: newAppointmentId(ids, rand) });
  return { ok: errors.length === 0, errors, suggestions, booking: out };
}

/** Upcoming (Booked, today or later) appointments for a phone number. */
function upcomingForPhone(rows, phone, today) {
  return rows
    .filter((r) => r.phone === phone && r.status === STATUS.BOOKED && r.appt_date >= today)
    .sort((a, b) => (a.appt_date + a.appt_time).localeCompare(b.appt_date + b.appt_time));
}

/* n8n:strip-start */
module.exports = { ID_ALPHABET, newAppointmentId, cleanBooking, activeRows, availableSlots, checkBooking, upcomingForPhone };
/* n8n:strip-end */
