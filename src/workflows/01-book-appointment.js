// Workflow 1 — Reception booking form -> validation -> slot check -> Sheet
// (+ optional WhatsApp booking confirmation). The receptionist sees the result
// (booked ID, or why not + free slots) right on the form's ending page.
const { N, connector, workflow } = require('./_nodes');
const { allSlots, doctorNames } = require('../lib/schedule');

const opts = (list) => ({ values: list.map((o) => ({ option: o })) });

module.exports = {
  key: 'book_appointment',
  file: '01-book-appointment.json',
  enabled: () => true,
  build(ctx) {
    const c = ctx.config;
    const confirm = c.features.booking_confirmation_whatsapp && c.whatsapp.enabled;
    const { connections, link } = connector();

    const nodes = [
      N.sticky(ctx, 'About', [-260, -260], [
        '## 1 · Book Appointment',
        'Reception fills the form (phone / walk-in). n8n validates it, checks the doctor\'s slot',
        'is free, saves the row and shows the result on screen.',
        '',
        '**Form URL:** open *Booking Form* → Production URL → bookmark it at reception.',
        'Rules come from `client.config.json` (doctors, sessions, holidays, patients per slot).',
      ].join('\n'), { width: 520, height: 200 }),
      N.formTrigger(ctx, 'Booking Form', [-200, 0], {
        title: 'Book Appointment — ' + c.client.clinic_name,
        description: 'Reception use. Phone = patient\'s WhatsApp number. Do not enter symptoms or medical details.',
        path: c.client.slug + '-book',
        buttonLabel: 'Book appointment',
        fields: [
          { fieldLabel: 'Patient Name', fieldType: 'text', requiredField: true },
          { fieldLabel: 'Phone', fieldType: 'text', placeholder: '10-digit mobile number', requiredField: true },
          { fieldLabel: 'Doctor', fieldType: 'dropdown', fieldOptions: opts(doctorNames(c)), requiredField: true },
          { fieldLabel: 'Appointment Date', fieldType: 'date', requiredField: true },
          { fieldLabel: 'Time Slot', fieldType: 'dropdown', fieldOptions: opts(allSlots(c)), requiredField: true },
          { fieldLabel: 'Visit Type', fieldType: 'dropdown', fieldOptions: opts(c.visit_types), requiredField: true },
          { fieldLabel: 'WhatsApp Updates', fieldType: 'dropdown', fieldOptions: opts(['Yes', 'No']), requiredField: true },
        ],
      }),
      N.code(ctx, 'Clean Booking', [20, 0], ['dates', 'phone', 'schedule', 'sheet', 'booking'], `
const f = $input.first().json;
const res = cleanBooking({
  patient_name: f['Patient Name'],
  phone: f['Phone'],
  doctor: f['Doctor'],
  appt_date: f['Appointment Date'],
  appt_time: f['Time Slot'],
  visit_type: f['Visit Type'],
  whatsapp_consent: f['WhatsApp Updates'],
}, CONFIG, new Date());
return [{ json: { booking: res.booking, errors: res.errors } }];
`),
      N.sheetsReadAll(ctx, 'Read Appointments', [240, 0]),
      N.code(ctx, 'Slot Check', [460, 0], ['dates', 'phone', 'schedule', 'sheet', 'booking', 'whatsapp'], `
const req = $('Clean Booking').first().json;
const rows = cleanRows($input.all().map((i) => i.json), CONFIG);
if (req.errors.length) {
  return [{ json: { ok: false, message: req.errors.join(' ') } }];
}
const res = checkBooking(req.booking, rows, CONFIG, new Date());
if (!res.ok) {
  let message = res.errors.join(' ');
  if (res.suggestions.length) message += ' Free slots that day: ' + res.suggestions.map(displayTime).join(', ') + '.';
  return [{ json: { ok: false, message } }];
}
const b = res.booking;
const tpl = CONFIG.whatsapp.templates.booking_confirmation;
const send_confirmation = ${confirm ? 'true' : 'false'} && b.whatsapp_consent === 'Yes' && !!(tpl && tpl.name);
return [{ json: {
  ok: true,
  row: b,
  send_confirmation,
  wa_payload: send_confirmation ? buildTemplatePayload(b.phone, tpl, templateFields(b, CONFIG)) : null,
  message: b.appointment_id + ' booked: ' + b.patient_name + ' with ' + b.doctor + ' on ' +
    displayDate(b.appt_date) + ' at ' + displayTime(b.appt_time) + '. Give this ID to the patient.',
} }];
`),
      N.ifTrue(ctx, 'Can Book?', [680, 0], '={{ $json.ok }}'),
      N.code(ctx, 'Row To Save', [900, -120], [], `
return [{ json: $input.first().json.row }];
`),
      N.sheetsAppend(ctx, 'Save Appointment', [1120, -120]),
      N.formEnding(ctx, 'Booked', [1780, -120], 'Appointment booked ✅', "={{ $('Slot Check').first().json.message }}"),
      N.formEnding(ctx, 'Not Booked', [900, 120], 'Not booked ❌', "={{ $('Slot Check').first().json.message }}"),
    ];

    link('Booking Form', 'Clean Booking');
    link('Clean Booking', 'Read Appointments');
    link('Read Appointments', 'Slot Check');
    link('Slot Check', 'Can Book?');
    link('Can Book?', 'Row To Save', 0);
    link('Can Book?', 'Not Booked', 1);
    link('Row To Save', 'Save Appointment');

    if (confirm) {
      const send = N.whatsappSend(ctx, 'Send Confirmation', [1560, -240]);
      send.parameters.jsonBody = "={{ JSON.stringify($('Slot Check').first().json.wa_payload) }}";
      nodes.push(N.ifTrue(ctx, 'Send Confirmation?', [1340, -120], "={{ $('Slot Check').first().json.send_confirmation }}"), send);
      link('Save Appointment', 'Send Confirmation?');
      link('Send Confirmation?', 'Send Confirmation', 0);
      link('Send Confirmation?', 'Booked', 1);
      link('Send Confirmation', 'Booked');
    } else {
      link('Save Appointment', 'Booked');
    }

    return workflow(ctx, c.client.short_name + ' · 1 · Book Appointment', nodes, connections);
  },
};
