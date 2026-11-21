// Workflow 3 — after the visit: Completed / No-show / Cancelled, payment and follow-up date.
const { N, connector, workflow } = require('./_nodes');

const opts = (list) => ({ values: list.map((o) => ({ option: o })) });

module.exports = {
  key: 'visit_update',
  file: '03-visit-update.json',
  enabled: () => true,
  build(ctx) {
    const c = ctx.config;
    const { connections, link } = connector();
    const followOptions = ['None'].concat(c.follow_up_options_days.map((d) => d + ' days'));
    const nodes = [
      N.sticky(ctx, 'About', [-260, -280], [
        '## 3 · Visit Update',
        'After the patient leaves, reception enters the Appointment ID (see Dashboard tab) and',
        'picks the outcome. Sets status, payment and follow_up_date (moved to the doctor\'s next open day).',
        'Use **Cancelled** for cancellations; to reschedule, cancel here and book again in Form 1.',
      ].join('\n'), { width: 560, height: 190 }),
      N.formTrigger(ctx, 'Visit Update Form', [-200, 0], {
        title: 'Visit Update — ' + c.client.clinic_name,
        description: 'Fill after the visit. Amount = what was collected at the counter today.',
        path: c.client.slug + '-visit',
        buttonLabel: 'Save visit',
        fields: [
          { fieldLabel: 'Appointment ID', fieldType: 'text', placeholder: 'APT-XXXXXX', requiredField: true },
          { fieldLabel: 'Status', fieldType: 'dropdown', fieldOptions: opts(['Completed', 'No-show', 'Cancelled']), requiredField: true },
          { fieldLabel: 'Amount Paid', fieldType: 'number', placeholder: '0' },
          { fieldLabel: 'Payment Mode', fieldType: 'dropdown', fieldOptions: opts(c.payment_modes.concat(['Free', 'Pending'])), requiredField: true },
          { fieldLabel: 'Follow-up After', fieldType: 'dropdown', fieldOptions: opts(followOptions), requiredField: true },
        ],
      }),
      N.sheetsReadAll(ctx, 'Read Appointments', [20, 0]),
      N.code(ctx, 'Compute Update', [240, 0], ['dates', 'schedule', 'sheet', 'visit'], `
const f = $('Visit Update Form').first().json;
const rows = cleanRows($input.all().map((i) => i.json), CONFIG);
const id = String(f['Appointment ID'] || '').trim().toUpperCase();
const row = rows.find((r) => r.appointment_id === id);
const res = computeVisitUpdate({
  appointment_id: id,
  status: f['Status'],
  amount_paid: f['Amount Paid'],
  payment_mode: f['Payment Mode'],
  follow_up_after: f['Follow-up After'],
}, row, CONFIG, new Date());
if (res.error) return [{ json: { ok: false, message: res.error } }];
return [{ json: { ok: true, update: res.update, message: res.message } }];
`),
      N.ifTrue(ctx, 'Found?', [460, 0], '={{ $json.ok }}'),
      N.code(ctx, 'Row Update', [680, -120], [], `
return [{ json: $input.first().json.update }];
`),
      N.sheetsUpdate(ctx, 'Update Sheet', [900, -120]),
      N.formEnding(ctx, 'Saved', [1120, -120], 'Saved ✅', "={{ $('Compute Update').first().json.message }}"),
      N.formEnding(ctx, 'Not Saved', [680, 120], 'Not saved ❌', "={{ $('Compute Update').first().json.message }}"),
    ];
    link('Visit Update Form', 'Read Appointments');
    link('Read Appointments', 'Compute Update');
    link('Compute Update', 'Found?');
    link('Found?', 'Row Update', 0);
    link('Found?', 'Not Saved', 1);
    link('Row Update', 'Update Sheet');
    link('Update Sheet', 'Saved');
    return workflow(ctx, c.client.short_name + ' · 3 · Visit Update', nodes, connections);
  },
};
