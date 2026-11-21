// ---------------------------------------------------------------------------
// report.js — the doctor's end-of-day summary (counts + money, no patient names).
// Depends on: dates.js, sheet.js
// ---------------------------------------------------------------------------
/* n8n:strip-start */
const { todayIn, addDays, displayDate, displayTime } = require('./dates');
const { STATUS } = require('./sheet');
/* n8n:strip-end */

function sumPaid(rows) {
  return rows.reduce((s, r) => s + (r.payment_status === 'Paid' ? Number(r.amount_paid) || 0 : 0), 0);
}

function buildDailyReport(rows, config, now) {
  const tz = config.locale.timezone;
  const cur = config.locale.currency || 'Rs';
  const today = todayIn(tz, now);
  const tomorrow = addDays(today, 1);

  const todays = rows.filter((r) => r.appt_date === today && r.status !== STATUS.CANCELLED);
  const done = todays.filter((r) => r.status === STATUS.COMPLETED);
  const noShow = todays.filter((r) => r.status === STATUS.NO_SHOW);
  const open = todays.filter((r) => r.status === STATUS.BOOKED);
  const cancelledToday = rows.filter((r) => r.appt_date === today && r.status === STATUS.CANCELLED);
  const collection = sumPaid(done);
  const pending = rows.filter((r) => r.status === STATUS.COMPLETED && r.payment_status === 'Pending');
  const stale = rows.filter((r) => r.status === STATUS.BOOKED && r.appt_date < today);
  const tmr = rows
    .filter((r) => r.appt_date === tomorrow && r.status === STATUS.BOOKED)
    .sort((a, b) => a.appt_time.localeCompare(b.appt_time));
  const newBookings = rows.filter((r) => r.booked_on === today);
  const followUpsTomorrow = rows.filter((r) => r.status === STATUS.COMPLETED && r.follow_up_date === tomorrow);

  const doctors = [...new Set(todays.concat(tmr).map((r) => r.doctor))].sort();
  const byDoctor = doctors.map((d) => ({
    doctor: d,
    total: todays.filter((r) => r.doctor === d).length,
    completed: done.filter((r) => r.doctor === d).length,
    no_show: noShow.filter((r) => r.doctor === d).length,
    collection: sumPaid(done.filter((r) => r.doctor === d)),
    tomorrow: tmr.filter((r) => r.doctor === d).length,
  }));

  const clinic = (config.client && config.client.clinic_name) || 'Clinic';
  const lines = [
    clinic + ' — report for ' + displayDate(today),
    '',
    'TODAY',
    'Appointments: ' + todays.length + '  (Completed ' + done.length + ' | No-show ' + noShow.length + ' | Not updated ' + open.length + ')',
    'Cancelled: ' + cancelledToday.length + '   New bookings taken today: ' + newBookings.length,
    'Collection: ' + cur + ' ' + collection,
    '',
    'PENDING',
    'Completed visits with payment pending: ' + pending.length,
    'Old bookings never updated (before today): ' + stale.length,
    '',
    'TOMORROW (' + displayDate(tomorrow) + ')',
    'Booked: ' + tmr.length + (tmr.length ? '  (first at ' + displayTime(tmr[0].appt_time) + ')' : ''),
    'Follow-ups due: ' + followUpsTomorrow.length,
  ];
  if (byDoctor.length > 1) {
    lines.push('', 'BY DOCTOR');
    for (const d of byDoctor) {
      lines.push(d.doctor + ': today ' + d.total + ' (done ' + d.completed + ', no-show ' + d.no_show + '), ' + cur + ' ' + d.collection + ', tomorrow ' + d.tomorrow);
    }
  }
  if (open.length) lines.push('', 'Note: ' + open.length + ' of today\'s visits are still "Booked" — reception should fill the Visit Update form.');

  const text = lines.join('\n');
  const html = '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">'
    + text.split('\n').map((l) => (/^(TODAY|PENDING|TOMORROW|BY DOCTOR)/.test(l)
      ? '<b>' + escapeHtml(l) + '</b>' : escapeHtml(l))).join('<br>')
    + '</div>';

  return {
    date: today,
    display_date: displayDate(today),
    total: todays.length,
    completed: done.length,
    no_show: noShow.length,
    not_updated: open.length,
    cancelled: cancelledToday.length,
    new_bookings: newBookings.length,
    collection,
    pending: pending.length,
    stale: stale.length,
    tomorrow: tmr.length,
    follow_ups_tomorrow: followUpsTomorrow.length,
    by_doctor: byDoctor,
    subject: clinic + ' report ' + displayDate(today) + ': ' + todays.length + ' visits, ' + cur + ' ' + collection,
    text,
    html,
  };
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* n8n:strip-start */
module.exports = { buildDailyReport, escapeHtml };
/* n8n:strip-end */
