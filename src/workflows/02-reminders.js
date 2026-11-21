// Workflow 2 — WhatsApp reminders.
//   evening run : tomorrow's appointments + tomorrow's follow-ups
//   same-day run: (optional) N hours before today's appointments
// Each successful send writes last_reminder_date, so re-running never double-sends.
// Failed sends (bad number, template issue) are emailed to the admin.
const { N, connector, workflow } = require('./_nodes');

function buildReminderWorkflow(ctx, { mode, cron, title, about }) {
  const c = ctx.config;
  const { connections, link } = connector();
  const nodes = [
    N.sticky(ctx, 'About', [-260, -300], about, { width: 560, height: 220 }),
    N.schedule(ctx, 'Schedule', [-200, 0], cron),
    N.sheetsReadAll(ctx, 'Read Appointments', [20, 0]),
    N.code(ctx, 'Pick Reminders', [240, 0], ['dates', 'phone', 'sheet', 'booking', 'whatsapp', 'reminders'], `
const rows = cleanRows($input.all().map((i) => i.json), CONFIG);
const picked = selectReminders(rows, CONFIG, new Date(), '${mode}');
return picked.map((p) => ({ json: p }));
`),
    N.whatsappSend(ctx, 'Send WhatsApp', [460, 0]),
    N.code(ctx, 'Mark Sent', [700, -100], ['dates', 'whatsapp'], `
const sent = $('Pick Reminders').all();
const today = todayIn(CONFIG.locale.timezone, new Date());
const out = [];
$input.all().forEach((item, i) => {
  if (parseSendResult(item.json).ok && sent[i]) {
    out.push({ json: { appointment_id: sent[i].json.appointment_id, last_reminder_date: today } });
  }
});
return out;
`),
    N.sheetsUpdate(ctx, 'Update Sheet', [920, -100]),
    N.code(ctx, 'Collect Failures', [700, 120], ['phone', 'whatsapp', 'report'], `
const sent = $('Pick Reminders').all();
const failed = [];
$input.all().forEach((item, i) => {
  const r = parseSendResult(item.json);
  if (!r.ok && sent[i]) failed.push(sent[i].json.appointment_id + ' (' + sent[i].json.reminder_type + ', ' + maskPhone(sent[i].json.phone) + '): ' + r.error);
});
if (!failed.length) return [];
return [{ json: {
  subject: CONFIG.client.clinic_name + ': ' + failed.length + ' WhatsApp reminder(s) failed',
  html: '<p>These reminders were NOT delivered. Fix the number/template; they will be retried on the next run if still due.</p><ul>' +
    failed.map((f) => '<li>' + escapeHtml(f) + '</li>').join('') + '</ul>',
} }];
`),
    N.gmail(ctx, 'Alert Admin', [920, 120], {
      to: c.notifications.admin_email,
      subject: '={{ $json.subject }}',
      html: '={{ $json.html }}',
    }),
  ];
  link('Schedule', 'Read Appointments');
  link('Read Appointments', 'Pick Reminders');
  link('Pick Reminders', 'Send WhatsApp');
  link('Send WhatsApp', 'Mark Sent');
  link('Send WhatsApp', 'Collect Failures');
  link('Mark Sent', 'Update Sheet');
  link('Collect Failures', 'Alert Admin');
  return workflow(ctx, c.client.short_name + ' · ' + title, nodes, connections);
}

const evening = {
  key: 'reminders',
  file: '02-reminders.json',
  enabled: (c) => c.whatsapp.enabled,
  build(ctx) {
    return buildReminderWorkflow(ctx, {
      mode: 'evening',
      cron: ctx.config.schedules.reminder_cron,
      title: '2 · WhatsApp Reminders',
      about: [
        '## 2 · WhatsApp Reminders (daily)',
        'Runs on `' + ctx.config.schedules.reminder_cron + '` (' + ctx.config.locale.timezone + ').',
        '- Appointment reminder for **tomorrow\'s** bookings',
        '- Follow-up reminder when **follow_up_date = tomorrow** (skipped if the patient already re-booked)',
        'Only `whatsapp_consent = Yes`. One message per row per day. Failures → admin email.',
      ].join('\n'),
    });
  },
};

const sameDay = {
  key: 'same_day_reminders',
  file: '02b-same-day-reminders.json',
  enabled: (c) => c.whatsapp.enabled && Number(c.reminders.same_day_hours_before) > 0,
  build(ctx) {
    const h = ctx.config.reminders.same_day_hours_before;
    return buildReminderWorkflow(ctx, {
      mode: 'same_day',
      cron: ctx.config.schedules.same_day_reminder_cron,
      title: '2b · Same-day Reminders',
      about: [
        '## 2b · Same-day reminder (optional)',
        'Runs hourly in clinic hours (`' + ctx.config.schedules.same_day_reminder_cron + '`) and reminds',
        'patients whose appointment is within the next **' + h + ' hour(s)** today.',
        'Costs ~1 execution per hour — check the client\'s n8n plan.',
      ].join('\n'),
    });
  },
};

module.exports = [evening, sameDay];
