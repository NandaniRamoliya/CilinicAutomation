// Workflow 4 — end-of-day report for the doctor/owner (email, optional WhatsApp).
const { N, connector, workflow } = require('./_nodes');

module.exports = {
  key: 'daily_report',
  file: '04-daily-report.json',
  enabled: () => true,
  build(ctx) {
    const c = ctx.config;
    const waReport = c.features.doctor_report_whatsapp && c.whatsapp.enabled;
    const { connections, link } = connector();
    const nodes = [
      N.sticky(ctx, 'About', [-260, -280], [
        '## 4 · Daily Report',
        'Runs on `' + c.schedules.report_cron + '`. Counts only — no patient names leave the sheet.',
        'Today: visits, completed, no-show, not-updated, collection. Pending payments. Tomorrow\'s bookings.',
        'Doctor-wise lines are added automatically when the clinic has more than one doctor.',
      ].join('\n'), { width: 560, height: 190 }),
      N.schedule(ctx, 'Schedule', [-200, 0], c.schedules.report_cron),
      N.sheetsReadAll(ctx, 'Read Appointments', [20, 0]),
      N.code(ctx, 'Build Report', [240, 0], ['dates', 'sheet', 'report'], `
const rows = cleanRows($input.all().map((i) => i.json), CONFIG);
return [{ json: buildDailyReport(rows, CONFIG, new Date()) }];
`),
      N.gmail(ctx, 'Email Report', [480, -80], {
        to: c.notifications.report_emails.join(','),
        subject: '={{ $json.subject }}',
        html: '={{ $json.html }}',
      }),
    ];
    link('Schedule', 'Read Appointments');
    link('Read Appointments', 'Build Report');
    link('Build Report', 'Email Report');

    if (waReport) {
      nodes.push(
        N.code(ctx, 'Doctor WhatsApp', [480, 120], ['whatsapp'], `
const r = $input.first().json;
const tpl = CONFIG.whatsapp.templates.doctor_report;
const fields = Object.assign({ clinic_name: CONFIG.client.clinic_name }, {
  date: r.display_date, total: r.total, completed: r.completed, no_show: r.no_show,
  not_updated: r.not_updated, collection: r.collection, pending: r.pending, tomorrow: r.tomorrow,
});
return CONFIG.notifications.report_whatsapp_numbers.map((to) => ({ json: { wa_payload: buildTemplatePayload(to, tpl, fields) } }));
`),
        N.whatsappSend(ctx, 'Send Report WhatsApp', [700, 120]),
      );
      link('Build Report', 'Doctor WhatsApp');
      link('Doctor WhatsApp', 'Send Report WhatsApp');
    }
    return workflow(ctx, c.client.short_name + ' · 4 · Daily Report', nodes, connections);
  },
};
