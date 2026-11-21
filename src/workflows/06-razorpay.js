// Workflow 6 (optional) — Razorpay Payment Link paid -> mark appointment Paid.
// Payment Links must be created with reference_id = appointment_id.
// The webhook signature (x-razorpay-signature) is verified before touching the sheet.
const { N, connector, workflow, stableId } = require('./_nodes');

module.exports = {
  key: 'razorpay',
  file: '06-razorpay-advance-fee.json',
  enabled: (c) => c.features.razorpay_advance_fee,
  build(ctx) {
    const c = ctx.config;
    const { connections, link } = connector();
    const nodes = [
      N.sticky(ctx, 'About', [-260, -300], [
        '## 6 · Razorpay advance fee (optional)',
        '1. Razorpay Dashboard → Webhooks → URL = this workflow\'s **Production URL**, event `payment_link.paid`, set a secret.',
        '2. Paste the SAME secret into the **HMAC Signature** node (Secret field).',
        '3. Create each Payment Link with `reference_id` = the appointment ID.',
        'Test in Razorpay **test mode** first. Unsigned / wrong-signature calls are ignored.',
      ].join('\n'), { width: 600, height: 210 }),
      N.node(ctx, 'Razorpay Webhook', 'n8n-nodes-base.webhook', 2, [-200, 0], {
        httpMethod: 'POST',
        path: c.client.slug + '-razorpay',
        options: { rawBody: true },
      }, { webhookId: stableId(c.client.slug, ctx.workflowKey, 'Razorpay Webhook', 'webhook') }),
      N.code(ctx, 'Raw Body', [20, 0], [], `
const item = $input.first();
const buf = await this.helpers.getBinaryDataBuffer(0, 'data');
return [{ json: {
  raw: buf.toString('utf8'),
  signature: String((item.json.headers || {})['x-razorpay-signature'] || ''),
  body: item.json.body,
} }];
`),
      N.node(ctx, 'HMAC Signature', 'n8n-nodes-base.crypto', 1, [240, 0], {
        action: 'hmac',
        type: 'SHA256',
        value: '={{ $json.raw }}',
        dataPropertyName: 'computed_signature',
        secret: 'PASTE_RAZORPAY_WEBHOOK_SECRET',
        encoding: 'hex',
      }),
      N.code(ctx, 'Verify & Parse', [460, 0], ['razorpay'], `
const j = $input.first().json;
if (!safeEqualHex(j.computed_signature, j.signature)) {
  return [{ json: { ok: false, reason: 'Bad or missing Razorpay signature — ignored.' } }];
}
const p = parsePaymentLinkPaid(j.body);
if (!p.relevant) return [{ json: { ok: false, reason: p.reason } }];
return [{ json: { ok: true, update: {
  appointment_id: p.appointment_id,
  payment_status: 'Paid',
  amount_paid: p.amount,
  payment_mode: 'Online (' + p.method + ')',
} } }];
`),
      N.ifTrue(ctx, 'Valid Payment?', [680, 0], '={{ $json.ok }}'),
      N.code(ctx, 'Row Update', [900, -80], [], `
return [{ json: $input.first().json.update }];
`),
      N.sheetsUpdate(ctx, 'Mark Paid', [1120, -80]),
    ];
    link('Razorpay Webhook', 'Raw Body');
    link('Raw Body', 'HMAC Signature');
    link('HMAC Signature', 'Verify & Parse');
    link('Verify & Parse', 'Valid Payment?');
    link('Valid Payment?', 'Row Update', 0);
    link('Row Update', 'Mark Paid');
    return workflow(ctx, c.client.short_name + ' · 6 · Razorpay Advance Fee', nodes, connections);
  },
};
