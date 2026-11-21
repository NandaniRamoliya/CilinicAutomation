// Workflow 5 — Error handler. Every other workflow points here (Settings → Error workflow),
// so any failure (expired Google token, sheet renamed, WhatsApp down) emails the admin.
const { N, connector, workflow } = require('./_nodes');

module.exports = {
  key: 'error_handler',
  file: '00-error-handler.json',
  enabled: () => true,
  build(ctx) {
    const c = ctx.config;
    const { connections, link } = connector();
    const nodes = [
      N.sticky(ctx, 'About', [-260, -240], [
        '## 0 · Error Handler',
        'Import/deploy this FIRST. Then in every other workflow: **Settings → Error workflow → this one**',
        '(`npm run deploy` does it automatically).',
      ].join('\n'), { width: 520, height: 150 }),
      N.node(ctx, 'Error Trigger', 'n8n-nodes-base.errorTrigger', 1, [-200, 0], {}),
      N.code(ctx, 'Format Alert', [20, 0], ['report'], `
const e = $input.first().json;
const ex = e.execution || {};
const err = ex.error || (e.trigger && e.trigger.error) || {};
const wf = (e.workflow && e.workflow.name) || 'Unknown workflow';
const html = [
  '<p><b>' + escapeHtml(wf) + '</b> failed for <b>' + escapeHtml(CONFIG.client.clinic_name) + '</b>.</p>',
  '<p><b>Error:</b> ' + escapeHtml(err.message || 'unknown') + '</p>',
  '<p><b>Node:</b> ' + escapeHtml(ex.lastNodeExecuted || (err.node && err.node.name) || '-') + '</p>',
  ex.url ? '<p><a href="' + ex.url + '">Open the failed execution</a></p>' : '',
  '<p>Common fixes: reconnect the Google credential, check the sheet/tab name, check WhatsApp token expiry.</p>',
].join('');
return [{ json: { subject: '[n8n] ' + CONFIG.client.clinic_name + ' — ' + wf + ' failed', html } }];
`),
      N.gmail(ctx, 'Email Admin', [240, 0], {
        to: c.notifications.admin_email,
        subject: '={{ $json.subject }}',
        html: '={{ $json.html }}',
      }),
    ];
    link('Error Trigger', 'Format Alert');
    link('Format Alert', 'Email Admin');
    return workflow(ctx, c.client.short_name + ' · 0 · Error Handler', nodes, connections);
  },
};
