// ---------------------------------------------------------------------------
// schedule.js — clinic hours, doctor-wise sessions, closed days, holidays.
// Depends on: dates.js
// ---------------------------------------------------------------------------
/* n8n:strip-start */
const { toMinutes, fromMinutes, weekdayName, addDays } = require('./dates');
/* n8n:strip-end */

/**
 * Resolve one doctor's effective schedule. Each doctor in the config can be a
 * plain string ("Dr. Mehta") or an object that overrides the clinic defaults:
 * { name, sessions, closed_weekdays, patients_per_slot, slot_minutes }.
 */
function doctorSchedule(config, doctorName) {
  const s = config.schedule || {};
  const list = (config.doctors || []).map((d) => (typeof d === 'string' ? { name: d } : d));
  const doc = list.find((d) => d.name.toLowerCase() === String(doctorName || '').trim().toLowerCase());
  if (!doc) return null;
  return {
    name: doc.name,
    sessions: doc.sessions || s.sessions || [],
    closed_weekdays: doc.closed_weekdays || s.closed_weekdays || [],
    patients_per_slot: Number(doc.patients_per_slot || s.patients_per_slot || 1),
    slot_minutes: Number(doc.slot_minutes || s.slot_minutes || 15),
  };
}

function doctorNames(config) {
  return (config.doctors || []).map((d) => (typeof d === 'string' ? d : d.name));
}

/** All bookable start times for one doctor, e.g. ['10:00','10:15',...]. */
function slotsForDoctor(config, doctorName) {
  const ds = doctorSchedule(config, doctorName);
  if (!ds) return [];
  const out = [];
  for (const sess of ds.sessions) {
    const start = toMinutes(sess.start);
    const end = toMinutes(sess.end);
    for (let t = start; t + ds.slot_minutes <= end; t += ds.slot_minutes) out.push(fromMinutes(t));
  }
  return out;
}

/** Union of every doctor's slots — used for the booking form's dropdown. */
function allSlots(config) {
  const set = new Set();
  for (const name of doctorNames(config)) for (const t of slotsForDoctor(config, name)) set.add(t);
  return [...set].sort();
}

/** Is the clinic / this doctor open on that date? Returns { open, reason }. */
function isOpenDay(config, doctorName, iso) {
  const ds = doctorSchedule(config, doctorName);
  if (!ds) return { open: false, reason: 'Unknown doctor "' + doctorName + '"' };
  const holidays = (config.schedule && config.schedule.holidays) || [];
  if (holidays.includes(iso)) return { open: false, reason: iso + ' is a clinic holiday' };
  const wd = weekdayName(iso);
  const closed = ds.closed_weekdays.map((w) => String(w).toLowerCase());
  if (closed.includes(wd.toLowerCase()) || closed.includes(wd.slice(0, 3).toLowerCase())) {
    return { open: false, reason: ds.name + ' is not available on ' + wd + 's' };
  }
  return { open: true, reason: '' };
}

/** First open day for the doctor on/after iso (max 30 days ahead). */
function nextOpenDay(config, doctorName, iso) {
  let d = iso;
  for (let i = 0; i < 30; i++) {
    if (isOpenDay(config, doctorName, d).open) return d;
    d = addDays(d, 1);
  }
  return iso;
}

/* n8n:strip-start */
module.exports = { doctorSchedule, doctorNames, slotsForDoctor, allSlots, isOpenDay, nextOpenDay };
/* n8n:strip-end */
