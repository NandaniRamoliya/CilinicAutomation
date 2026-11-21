// Unit tests for src/lib — run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');

const dates = require('../src/lib/dates');
const { normalizePhone, isValidPhone, maskPhone } = require('../src/lib/phone');
const schedule = require('../src/lib/schedule');
const { cleanRows, normalizeRow, APPOINTMENT_COLUMNS } = require('../src/lib/sheet');
const booking = require('../src/lib/booking');
const { selectReminders } = require('../src/lib/reminders');
const { computeVisitUpdate, parseFollowUpDays } = require('../src/lib/visit');
const { buildDailyReport } = require('../src/lib/report');
const wa = require('../src/lib/whatsapp');
const { parsePaymentLinkPaid, safeEqualHex } = require('../src/lib/razorpay');
const { runEngine, parseIncomingWhatsApp } = require('../src/lib/engine');
const { loadConfig } = require('../scripts/config');

const CONFIG = loadConfig('demo-clinic');
// Wed 18 Nov 2026, 15:00 IST
const NOW = new Date('2026-11-18T09:30:00Z');
const seq = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };

function row(p) {
  return normalizeRow(Object.assign({
    appointment_id: 'APT-AAAAAA', patient_name: 'Test Patient', phone: '919000000001', doctor: 'Dr. Mehta',
    appt_date: '2026-11-19', appt_time: '10:30', visit_type: 'New', status: 'Booked', payment_status: 'Pending',
    amount_paid: '', payment_mode: '', follow_up_date: '', whatsapp_consent: 'Yes', last_reminder_date: '', booked_on: '2026-11-17',
  }, p), CONFIG);
}

test('dates: timezone-aware today/time and helpers', () => {
  assert.equal(dates.todayIn('Asia/Kolkata', new Date('2026-11-18T19:00:00Z')), '2026-11-19'); // 00:30 IST next day
  assert.equal(dates.timeIn('Asia/Kolkata', NOW), '15:00');
  assert.equal(dates.addDays('2026-11-30', 7), '2026-12-07');
  assert.equal(dates.addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(dates.weekdayName('2026-11-22'), 'Sunday');
  assert.equal(dates.displayDate('2026-11-18'), '18 Nov 2026');
  assert.equal(dates.displayTime('17:30'), '5:30 PM');
  assert.equal(dates.displayTime('00:15'), '12:15 AM');
});

test('dates: normalise messy sheet values', () => {
  assert.equal(dates.normalizeDate('18/11/2026'), '2026-11-18');
  assert.equal(dates.normalizeDate('11/18/2026', 'MDY'), '2026-11-18');
  assert.equal(dates.normalizeDate('2026-11-18T00:00:00.000Z'), '2026-11-18');
  assert.equal(dates.normalizeDate(46344), '2026-11-18'); // Sheets serial
  assert.equal(dates.normalizeDate('31/02/2026'), '');
  assert.equal(dates.normalizeTime('5:30 pm'), '17:30');
  assert.equal(dates.normalizeTime('9:5'), '09:05');
  assert.equal(dates.normalizeTime('17:30:00'), '17:30');
  assert.equal(dates.normalizeTime(0.729166667), '17:30');
  assert.equal(dates.normalizeTime('25:00'), '');
});

test('phone: normalise and validate', () => {
  assert.equal(normalizePhone('+91 98765-43210'), '919876543210');
  assert.equal(normalizePhone('098765 43210'), '919876543210');
  assert.equal(normalizePhone('9876543210'), '919876543210');
  assert.equal(normalizePhone('00919876543210'), '919876543210');
  assert.ok(isValidPhone('919876543210', '91', 10));
  assert.ok(!isValidPhone('91987654321', '91', 10));
  assert.ok(!isValidPhone('12345', '91', 10));
  assert.ok(isValidPhone('447911123456', '91', 10)); // foreign number OK
  assert.equal(maskPhone('919876543210'), '98xxxxx210');
});

test('schedule: doctor-specific sessions and closed days', () => {
  assert.equal(schedule.slotsForDoctor(CONFIG, 'Dr. Mehta').length, 24); // 2 sessions x 12 slots
  assert.deepEqual(schedule.slotsForDoctor(CONFIG, 'dr. rao').slice(0, 2), ['17:00', '17:15']);
  assert.equal(schedule.isOpenDay(CONFIG, 'Dr. Rao', '2026-11-19').open, false); // Thursday
  assert.equal(schedule.isOpenDay(CONFIG, 'Dr. Mehta', '2026-11-19').open, true);
  assert.equal(schedule.isOpenDay(CONFIG, 'Dr. Mehta', '2026-12-25').open, false); // holiday
  assert.equal(schedule.nextOpenDay(CONFIG, 'Dr. Mehta', '2026-11-22'), '2026-11-23'); // Sun -> Mon
  assert.equal(schedule.allSlots(CONFIG)[0], '10:00');
});

test('booking: clean + validate form input', () => {
  const ok = booking.cleanBooking({ patient_name: '  rohit  kumar ', phone: '98765 43210', doctor: 'dr. mehta', appt_date: '2026-11-19', appt_time: '10:30', visit_type: 'new', whatsapp_consent: 'Yes' }, CONFIG, NOW);
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.booking.patient_name, 'rohit kumar');
  assert.equal(ok.booking.doctor, 'Dr. Mehta');
  assert.equal(ok.booking.phone, '919876543210');
  assert.equal(ok.booking.visit_type, 'New');
  assert.equal(ok.booking.booked_on, '2026-11-18');
  assert.deepEqual(Object.keys(ok.booking), APPOINTMENT_COLUMNS);

  const bad = booking.cleanBooking({ patient_name: 'A', phone: '123', doctor: 'Dr. Who', appt_date: '2026-11-17', appt_time: '10:30', whatsapp_consent: 'No' }, CONFIG, NOW);
  assert.equal(bad.errors.length, 4);

  const closed = booking.cleanBooking({ patient_name: 'Asha', phone: '9876543210', doctor: 'Dr. Rao', appt_date: '2026-11-19', appt_time: '10:00' }, CONFIG, NOW);
  assert.match(closed.errors.join(' '), /not available on Thursdays/);
  assert.match(closed.errors.join(' '), /does not have a 10:00 AM slot/);
});

test('booking: double booking blocked with suggestions; duplicate patient blocked', () => {
  const rows = [row({ appointment_id: 'APT-BBBBBB', appt_time: '10:30', phone: '919111111111' })];
  const { booking: b } = booking.cleanBooking({ patient_name: 'Rohit', phone: '9876543210', doctor: 'Dr. Mehta', appt_date: '2026-11-19', appt_time: '10:30', whatsapp_consent: 'Yes' }, CONFIG, NOW);
  const clash = booking.checkBooking(b, rows, CONFIG, NOW);
  assert.equal(clash.ok, false);
  assert.match(clash.errors[0], /already has 1 booking/);
  assert.deepEqual(clash.suggestions, ['10:15', '10:45', '11:00']);

  const cancelled = [row({ appt_time: '10:30', status: 'Cancelled' })];
  assert.equal(booking.checkBooking(b, cancelled, CONFIG, NOW).ok, true);

  const dup = [row({ appt_time: '12:00', phone: '919876543210' })];
  const d = booking.checkBooking(b, dup, CONFIG, NOW);
  assert.equal(d.ok, false);
  assert.match(d.errors[0], /already has appointment APT-AAAAAA/);
});

test('booking: unique readable IDs', () => {
  const id = booking.newAppointmentId(new Set(), () => 0);
  assert.equal(id, 'APT-AAAAAA');
  const next = booking.newAppointmentId(new Set(['APT-AAAAAA']), seq([0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]));
  assert.notEqual(next, 'APT-AAAAAA');
  assert.match(next, /^APT-[A-HJ-NP-Z2-9]{6}$/);
});

test('availability: hides full and past slots', () => {
  const rows = [row({ appt_date: '2026-11-18', appt_time: '17:00' })];
  const free = booking.availableSlots(CONFIG, rows, 'Dr. Mehta', '2026-11-18', NOW); // now = 15:00
  assert.equal(free[0], '17:15');
  assert.ok(!free.includes('10:00'));
  assert.deepEqual(booking.availableSlots(CONFIG, rows, 'Dr. Rao', '2026-11-19', NOW), []); // Thursday off
});

test('reminders: evening run picks tomorrow + follow-ups, respects consent and dedupe', () => {
  const rows = [
    row({ appointment_id: 'APT-TMR001' }),                                                      // tomorrow -> remind
    row({ appointment_id: 'APT-NOCONS', whatsapp_consent: 'No' }),                              // no consent
    row({ appointment_id: 'APT-DONE01', last_reminder_date: '2026-11-18' }),                    // already sent today
    row({ appointment_id: 'APT-CANCEL', status: 'Cancelled' }),                                 // cancelled
    row({ appointment_id: 'APT-FUP001', phone: '919000000009', status: 'Completed', appt_date: '2026-11-05', follow_up_date: '2026-11-19' }),
    row({ appointment_id: 'APT-FUP002', phone: '919000000008', status: 'Completed', appt_date: '2026-11-05', follow_up_date: '2026-11-19' }),
    row({ appointment_id: 'APT-REBOOK', phone: '919000000008', appt_date: '2026-11-25' }),      // FUP002 already re-booked
  ];
  const r = selectReminders(rows, CONFIG, NOW, 'evening');
  assert.deepEqual(r.map((x) => x.appointment_id + ':' + x.reminder_type), ['APT-TMR001:appointment_reminder', 'APT-FUP001:follow_up_reminder']);
  const p = r[0].wa_payload;
  assert.equal(p.template.name, 'appointment_reminder_v1');
  assert.deepEqual(p.template.components[0].parameters.map((x) => x.text), ['Test Patient', 'Dr. Mehta', '19 Nov 2026', '10:30 AM']);
});

test('reminders: same-day window', () => {
  const rows = [
    row({ appointment_id: 'APT-SOON01', appt_date: '2026-11-18', appt_time: '17:00' }), // in 2h -> yes
    row({ appointment_id: 'APT-LATE01', appt_date: '2026-11-18', appt_time: '19:00' }), // in 4h -> no
    row({ appointment_id: 'APT-PAST01', appt_date: '2026-11-18', appt_time: '12:00' }), // past -> no
    row({ appointment_id: 'APT-DAYB01', appt_date: '2026-11-18', appt_time: '16:00', last_reminder_date: '2026-11-17' }), // reminded yesterday -> yes again today
  ];
  assert.deepEqual(selectReminders(rows, CONFIG, NOW, 'same_day').map((x) => x.appointment_id), ['APT-SOON01', 'APT-DAYB01']);
});

test('visit update: completed with payment and follow-up moved off closed days', () => {
  const r = row({ appt_date: '2026-11-18' });
  const res = computeVisitUpdate({ appointment_id: 'apt-aaaaaa', status: 'Completed', amount_paid: '500', payment_mode: 'UPI', follow_up_after: '4 days' }, r, CONFIG, NOW);
  assert.equal(res.update.payment_status, 'Paid');
  assert.equal(res.update.amount_paid, 500);
  assert.equal(res.update.follow_up_date, '2026-11-23'); // 22nd is Sunday -> Monday
  const free = computeVisitUpdate({ status: 'Completed', amount_paid: '', payment_mode: 'Free', follow_up_after: 'None' }, r, CONFIG, NOW);
  assert.equal(free.update.payment_status, 'Free');
  assert.equal(free.update.follow_up_date, '');
  const pending = computeVisitUpdate({ status: 'Completed', amount_paid: '0', payment_mode: 'Pending' }, r, CONFIG, NOW);
  assert.equal(pending.update.payment_status, 'Pending');
  const advance = computeVisitUpdate({ status: 'Completed', amount_paid: '300', payment_mode: 'Cash' }, row({ appt_date: '2026-11-18', payment_mode: 'Online (upi)', amount_paid: '200', payment_status: 'Paid' }), CONFIG, NOW);
  assert.equal(advance.update.amount_paid, 500);
  assert.equal(advance.update.payment_mode, 'Online+Cash');
});

test('visit update: errors for unknown ID and future visits', () => {
  assert.match(computeVisitUpdate({ appointment_id: 'APT-NOPE00', status: 'Completed' }, undefined, CONFIG, NOW).error, /not found/);
  assert.match(computeVisitUpdate({ status: 'Completed' }, row({ appt_date: '2026-11-20' }), CONFIG, NOW).error, /future/);
  assert.equal(computeVisitUpdate({ status: 'Cancelled' }, row({ appt_date: '2026-11-20' }), CONFIG, NOW).update.status, 'Cancelled');
  assert.equal(parseFollowUpDays('2 weeks'), 14);
});

test('daily report: counts, money, doctor-wise, no patient names', () => {
  const rows = cleanRows([
    { appointment_id: 'APT-000001', patient_name: 'Secret Name', phone: '919000000001', doctor: 'Dr. Mehta', appt_date: '2026-11-18', appt_time: '10:00', status: 'Completed', payment_status: 'Paid', amount_paid: '500', booked_on: '2026-11-10' },
    { appointment_id: 'APT-000002', patient_name: 'B', phone: '919000000002', doctor: 'Dr. Rao', appt_date: '2026-11-18', appt_time: '17:00', status: 'Completed', payment_status: 'Pending', amount_paid: '', booked_on: '2026-11-18' },
    { appointment_id: 'APT-000003', patient_name: 'C', phone: '919000000003', doctor: 'Dr. Mehta', appt_date: '2026-11-18', appt_time: '10:15', status: 'No-show', booked_on: '2026-11-10' },
    { appointment_id: 'APT-000004', patient_name: 'D', phone: '919000000004', doctor: 'Dr. Mehta', appt_date: '2026-11-18', appt_time: '10:30', status: 'Booked', booked_on: '2026-11-10' },
    { appointment_id: 'APT-000005', patient_name: 'E', phone: '919000000005', doctor: 'Dr. Mehta', appt_date: '2026-11-19', appt_time: '11:00', status: 'Booked', booked_on: '2026-11-18' },
    { appointment_id: 'APT-000006', patient_name: 'F', phone: '919000000006', doctor: 'Dr. Mehta', appt_date: '2026-11-10', appt_time: '11:00', status: 'Booked', booked_on: '2026-11-01' },
    { appointment_id: 'APT-000007', patient_name: 'G', phone: '919000000007', doctor: 'Dr. Mehta', appt_date: '2026-11-18', appt_time: '12:00', status: 'Cancelled', booked_on: '2026-11-01' },
    {},
  ], CONFIG);
  const r = buildDailyReport(rows, CONFIG, NOW);
  assert.equal(r.total, 4);
  assert.equal(r.completed, 2);
  assert.equal(r.no_show, 1);
  assert.equal(r.not_updated, 1);
  assert.equal(r.cancelled, 1);
  assert.equal(r.collection, 500);
  assert.equal(r.pending, 1);
  assert.equal(r.stale, 1);
  assert.equal(r.tomorrow, 1);
  assert.equal(r.new_bookings, 2);
  assert.equal(r.by_doctor.length, 2);
  assert.ok(!r.text.includes('Secret Name'));
  assert.ok(r.html.includes('<b>TODAY</b>'));
});

test('whatsapp: payload building and result parsing', () => {
  const p = wa.buildTemplatePayload('919000000001', { name: 't', language: 'hi', params: ['patient_name'] }, { patient_name: 'A\nB    C' });
  assert.equal(p.template.language.code, 'hi');
  assert.equal(p.template.components[0].parameters[0].text, 'A B C');
  assert.throws(() => wa.buildTemplatePayload('1', { name: 't', params: ['diagnosis'] }, {}), /unknown field/);
  assert.equal(wa.parseSendResult({ messages: [{ id: 'wamid.1' }] }).ok, true);
  assert.equal(wa.parseSendResult({ error: { message: 'Recipient not on WhatsApp' } }).error, 'Recipient not on WhatsApp');
  assert.equal(wa.parseSendResult({ error: 'timeout' }).ok, false);
});

test('razorpay: parse payment_link.paid and compare signatures', () => {
  const body = { event: 'payment_link.paid', payload: { payment_link: { entity: { reference_id: 'apt-k7m2qx', amount: 20000 } }, payment: { entity: { id: 'pay_1', amount: 20000, method: 'upi' } } } };
  assert.deepEqual(parsePaymentLinkPaid(body), { relevant: true, appointment_id: 'APT-K7M2QX', amount: 200, method: 'upi', payment_id: 'pay_1' });
  assert.equal(parsePaymentLinkPaid({ event: 'payment.failed' }).relevant, false);
  assert.ok(safeEqualHex('abcd', 'abcd'));
  assert.ok(!safeEqualHex('abcd', 'abce'));
  assert.ok(!safeEqualHex('', ''));
});

test('AI engine: availability, book, list, cancel — scoped to the sender', () => {
  const rows = [row({ appointment_id: 'APT-OTHER1', phone: '919111111111', appt_time: '10:00' })];
  const av = runEngine({ action: 'availability', doctor: 'Dr. Mehta', date: '2026-11-19', phone: '9876543210' }, rows, CONFIG, NOW);
  assert.match(av.response, /Dr\. Mehta on 19 Nov 2026 \(2026-11-19\): 10:15 AM/);
  const rao = runEngine({ action: 'availability', doctor: 'Dr. Rao', date: '2026-11-19', phone: '9876543210' }, rows, CONFIG, NOW);
  assert.match(rao.response, /not available/);

  const full = runEngine({ action: 'book', doctor: 'Dr. Mehta', date: '2026-11-19', time: '10:00', patient_name: 'Rohit', phone: '9876543210' }, rows, CONFIG, NOW);
  assert.equal(full.write, 'none');
  assert.match(full.response, /NOT BOOKED/);

  const ok = runEngine({ action: 'book', doctor: 'Dr. Mehta', date: '2026-11-19', time: '10:15', patient_name: 'Rohit', visit_type: 'New', phone: '9876543210' }, rows, CONFIG, NOW, () => 0);
  assert.equal(ok.write, 'append');
  assert.equal(ok.row.whatsapp_consent, 'Yes');
  assert.match(ok.response, /^BOOKED\. Appointment ID APT-AAAAAA/);

  const mine = runEngine({ action: 'my_appointments', phone: '919876543210' }, rows.concat([ok.row]), CONFIG, NOW);
  assert.match(mine.response, /APT-AAAAAA/);
  assert.doesNotMatch(mine.response, /APT-OTHER1/);

  const steal = runEngine({ action: 'cancel', appointment_id: 'APT-OTHER1', phone: '919876543210' }, rows, CONFIG, NOW);
  assert.match(steal.response, /NOT CANCELLED/);
  const cancel = runEngine({ action: 'cancel', appointment_id: 'apt-aaaaaa', phone: '919876543210' }, rows.concat([ok.row]), CONFIG, NOW);
  assert.equal(cancel.write, 'update');
  assert.deepEqual(cancel.row, { appointment_id: 'APT-AAAAAA', status: 'Cancelled' });
});

test('AI engine: parse Meta webhook payloads', () => {
  const body = { entry: [{ changes: [{ value: { metadata: { phone_number_id: '123' }, contacts: [{ wa_id: '919876543210', profile: { name: 'Rohit' } }], messages: [{ id: 'wamid.X', from: '919876543210', type: 'text', text: { body: 'kal appointment chahiye' } }] } }] }] };
  assert.deepEqual(parseIncomingWhatsApp(body)[0], { message_id: 'wamid.X', from: '919876543210', profile_name: 'Rohit', type: 'text', text: 'kal appointment chahiye', phone_number_id: '123' });
  assert.deepEqual(parseIncomingWhatsApp({ entry: [{ changes: [{ value: { statuses: [{ status: 'read' }] } }] }] }), []);
});
