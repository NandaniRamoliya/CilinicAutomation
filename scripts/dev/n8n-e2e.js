#!/usr/bin/env node
// End-to-end test: run the GENERATED workflows inside a real local n8n, with every
// external service (Google Sheets, WhatsApp, Gmail, triggers) replaced by fixture
// Code nodes that keep the same node names. Our real Code nodes, IF/Switch routing,
// expressions, Crypto HMAC and binary handling all run for real.
//
//   N8N_NODE=/path/to/node24 N8N_MODULES=/path/to/node_modules node scripts/dev/n8n-e2e.js
// (n8n 2.x needs Node >= 24; N8N_MODULES must contain the `n8n` package)
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { loadConfig } = require('../config');
const { buildWorkflows } = require('../build');
const { todayIn, addDays } = require('../../src/lib/dates');
const { nextOpenDay } = require('../../src/lib/schedule');

const NODE = process.env.N8N_NODE || process.execPath;
const MODULES = process.env.N8N_MODULES;
if (!MODULES || !fs.existsSync(path.join(MODULES, 'n8n'))) {
  console.error('Set N8N_MODULES to a node_modules folder containing n8n (and N8N_NODE to a Node 24 binary).');
  process.exit(2);
}
const N8N = path.join(MODULES, 'n8n', 'bin', 'n8n');
const HOME = process.env.E2E_HOME || fs.mkdtempSync(path.join(os.tmpdir(), "n8n-e2e-"));
const ENV = Object.assign({}, process.env, {
  N8N_USER_FOLDER: HOME, N8N_DIAGNOSTICS_ENABLED: 'false', N8N_RUNNERS_ENABLED: 'true',
  DB_SQLITE_POOL_SIZE: '1', N8N_BLOCK_ENV_ACCESS_IN_NODE: 'true',
  // the 'vm' engine needs the isolated-vm native addon built for this Node version; 'legacy' does not
  N8N_EXPRESSION_ENGINE: process.env.N8N_EXPRESSION_ENGINE || 'legacy',
});

const config = loadConfig('demo-clinic');
const built = Object.fromEntries(buildWorkflows(config, { error_handler: 'e2eErrorHandler1', booking_engine: 'e2eEngine0000001' }).map((b) => [b.key, b.json]));
const TZ = config.locale.timezone;
const TODAY = todayIn(TZ);
const TOMORROW = addDays(TODAY, 1);
const MEHTA_DAY = nextOpenDay(config, 'Dr. Mehta', addDays(TODAY, 2));

// ---------- helpers to turn a real workflow into a testable one ----------
const code = (name, position, js) => ({ id: crypto.randomUUID(), name, type: 'n8n-nodes-base.code', typeVersion: 2, position, parameters: { jsCode: js } });
const fixture = (items) => 'return ' + JSON.stringify(items.map((j) => ({ json: j }))) + ';';
const exprToJs = (expr) => String(expr).replace(/^=\{\{\s*/, '').replace(/\s*\}\}$/, '');

/**
 * entry: name of the trigger node to start from; triggerItems: what it should output
 * sheetRows: rows the Google Sheets "read" returns
 */
function mock(wf, { entry, triggerItems, triggerBinary, sheetRows }) {
  const w = JSON.parse(JSON.stringify(wf));
  w.nodes = w.nodes.filter((n) => n.type !== 'n8n-nodes-base.stickyNote').map((n) => {
    const t = n.type;
    if (n.name === entry) {
      const node = code(n.name, n.position, triggerBinary
        ? 'return [{ json: ' + JSON.stringify(triggerItems[0]) + ', binary: { data: { data: ' + JSON.stringify(triggerBinary) + ', mimeType: "application/json" } } }];'
        : fixture(triggerItems));
      return node;
    }
    if (/Trigger$|\.webhook$/.test(t) || t === 'n8n-nodes-base.formTrigger') return code(n.name, n.position, 'return [];');
    if (t === 'n8n-nodes-base.googleSheets') {
      const op = n.parameters.operation;
      if (op === 'read') {
        const rows = (sheetRows && sheetRows.length ? sheetRows : [{}]).map((r, i) => (Object.keys(r).length ? Object.assign({ row_number: i + 2 }, r) : r));
        return code(n.name, n.position, fixture(rows));
      }
      return code(n.name, n.position, 'return $input.all().map((i) => ({ json: Object.assign({ __sheet_' + op + ': true }, i.json) }));');
    }
    if (t === 'n8n-nodes-base.httpRequest') {
      return code(n.name, n.position, `
return $input.all().map((i, idx) => {
  const body = ${exprToJs(n.parameters.jsonBody).replace('$json', 'i.json')};
  const p = JSON.parse(body);
  if (String(p.to).endsWith('0000')) return { json: { error: { message: 'Recipient phone number not in allowed list' } } };
  return { json: { messaging_product: 'whatsapp', contacts: [{ wa_id: p.to }], messages: [{ id: 'wamid.TEST' + idx }], __sent: p } };
});`);
    }
    if (t === 'n8n-nodes-base.gmail') {
      return code(n.name, n.position, 'return $input.all().map((i) => ({ json: { __email_to: ' + JSON.stringify(n.parameters.sendTo) + ', subject: i.json.subject, html: i.json.html } }));');
    }
    if (t === 'n8n-nodes-base.form') {
      return code(n.name, n.position, 'return [{ json: { __ending: ' + JSON.stringify(n.name) + ', title: ' + JSON.stringify(n.parameters.completionTitle) + ', message: ' + exprToJs(n.parameters.completionMessage) + ' } }];');
    }
    if (t === 'n8n-nodes-base.respondToWebhook') {
      return code(n.name, n.position, 'return [{ json: { __respond: $json.challenge, code: $json.ok ? 200 : 403 } }];');
    }
    return n;
  });
  // drop AI sub-nodes + agent paths when not under test (they need LLM credentials)
  w.nodes = w.nodes.filter((n) => !n.type.startsWith('@n8n/n8n-nodes-langchain'));
  const names = new Set(w.nodes.map((n) => n.name));
  for (const from of Object.keys(w.connections)) {
    if (!names.has(from)) { delete w.connections[from]; continue; }
    for (const type of Object.keys(w.connections[from])) {
      if (type !== 'main') { delete w.connections[from][type]; continue; }
      w.connections[from][type] = w.connections[from][type].map((out) => out.filter((c) => names.has(c.node)));
    }
  }
  w.nodes.push({ id: crypto.randomUUID(), name: 'Start', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [-600, 0], parameters: {} });
  w.connections.Start = { main: [[{ node: entry, type: 'main', index: 0 }]] };
  delete w.settings.errorWorkflow;
  return w;
}

// ---------- fixtures ----------
const R = (p) => Object.assign({
  appointment_id: 'APT-AAAAAA', patient_name: 'Test Patient', phone: '919000000001', doctor: 'Dr. Mehta',
  appt_date: TOMORROW, appt_time: '10:30', visit_type: 'New', status: 'Booked', payment_status: 'Pending',
  amount_paid: '', payment_mode: '', follow_up_date: '', whatsapp_consent: 'Yes', last_reminder_date: '', booked_on: TODAY,
}, p);
const form = (p) => Object.assign({
  'Patient Name': '  rohit  kumar ', Phone: '98765 43210', Doctor: 'Dr. Mehta', 'Appointment Date': MEHTA_DAY,
  'Time Slot': '10:30', 'Visit Type': 'New', 'WhatsApp Updates': 'Yes', submittedAt: new Date().toISOString(), formMode: 'production',
}, p);
const RZP_SECRET = 'PASTE_RAZORPAY_WEBHOOK_SECRET';
const rzpBody = { event: 'payment_link.paid', payload: { payment_link: { entity: { reference_id: 'apt-k7m2qx', amount: 20000 } }, payment: { entity: { id: 'pay_1', amount: 20000, method: 'upi' } } } };
const rzpRaw = JSON.stringify(rzpBody);
const rzpSig = crypto.createHmac('sha256', RZP_SECRET).update(rzpRaw).digest('hex');

const SCENARIOS = [
  { name: 'booking: success + WhatsApp confirmation', wf: 'book_appointment', entry: 'Booking Form', trigger: [form()],
    rows: [R({ appointment_id: 'APT-BBBBBB', appt_date: MEHTA_DAY, appt_time: '10:00', phone: '919111111111' })],
    check: (o) => {
      ok(o('Save Appointment')[0].appointment_id.startsWith('APT-'), 'row appended with ID');
      eq(o('Save Appointment')[0].patient_name, 'rohit kumar', 'name cleaned');
      eq(o('Save Appointment')[0].phone, '919876543210', 'phone normalised');
      eq(o('Send Confirmation')[0].__sent.template.name, 'booking_confirmation_v1', 'confirmation template sent');
      ok(/booked/.test(o('Booked')[0].message), 'Booked ending shown: ' + o('Booked')[0].message);
    } },
  { name: 'booking: first booking on an EMPTY sheet', wf: 'book_appointment', entry: 'Booking Form', trigger: [form({ 'WhatsApp Updates': 'No' })], rows: [],
    check: (o) => {
      ok(o('Save Appointment').length === 1, 'appended');
      ok(!o('Send Confirmation'), 'no confirmation without consent');
      ok(o('Booked'), 'Booked ending');
    } },
  { name: 'booking: double booking blocked', wf: 'book_appointment', entry: 'Booking Form', trigger: [form()],
    rows: [R({ appointment_id: 'APT-BBBBBB', appt_date: MEHTA_DAY, appt_time: '10:30', phone: '919111111111' })],
    check: (o) => {
      ok(!o('Save Appointment'), 'nothing appended');
      ok(/already has 1 booking/.test(o('Not Booked')[0].message) && /Free slots/.test(o('Not Booked')[0].message), o('Not Booked')[0].message);
    } },
  { name: 'booking: invalid input blocked', wf: 'book_appointment', entry: 'Booking Form', trigger: [form({ Phone: '12345', 'Appointment Date': '2020-01-01' })], rows: [],
    check: (o) => ok(/not valid/.test(o('Not Booked')[0].message) && /past/.test(o('Not Booked')[0].message), o('Not Booked')[0].message) },
  { name: 'reminders: sends, marks sent, emails failures', wf: 'reminders', entry: 'Schedule', trigger: [{}],
    rows: [
      R({ appointment_id: 'APT-TMR001' }),
      R({ appointment_id: 'APT-BADNUM', phone: '919000000000' }),
      R({ appointment_id: 'APT-NOCONS', whatsapp_consent: 'No' }),
      R({ appointment_id: 'APT-FUP001', phone: '919000000005', status: 'Completed', appt_date: addDays(TODAY, -10), follow_up_date: TOMORROW }),
    ],
    check: (o) => {
      eq(o('Send WhatsApp').length, 3, '3 messages attempted');
      eq(o('Update Sheet').map((x) => x.appointment_id).sort().join(','), 'APT-FUP001,APT-TMR001', 'only successes marked');
      eq(o('Update Sheet')[0].last_reminder_date, TODAY, 'last_reminder_date = today');
      ok(/1 WhatsApp reminder\(s\) failed/.test(o('Alert Admin')[0].subject), 'admin alerted');
    } },
  { name: 'reminders: nothing due -> stops quietly', wf: 'reminders', entry: 'Schedule', trigger: [{}], rows: [R({ appt_date: addDays(TODAY, 5) })],
    check: (o) => { ok(!o('Send WhatsApp'), 'no send'); ok(!o('Alert Admin'), 'no alert'); } },
  { name: 'visit update: completed + follow-up', wf: 'visit_update', entry: 'Visit Update Form',
    trigger: [{ 'Appointment ID': ' apt-aaaaaa ', Status: 'Completed', 'Amount Paid': 500, 'Payment Mode': 'UPI', 'Follow-up After': '7 days' }],
    rows: [R({ appt_date: TODAY })],
    check: (o) => {
      const u = o('Update Sheet')[0];
      eq(u.appointment_id, 'APT-AAAAAA', 'matched'); eq(u.status, 'Completed', 'status'); eq(u.payment_status, 'Paid', 'paid');
      ok(u.follow_up_date >= addDays(TODAY, 7), 'follow-up date set: ' + u.follow_up_date);
      ok(/Saved/.test(o('Saved')[0].title), 'Saved ending');
    } },
  { name: 'visit update: unknown ID', wf: 'visit_update', entry: 'Visit Update Form',
    trigger: [{ 'Appointment ID': 'APT-ZZZZZZ', Status: 'Completed', 'Amount Paid': 0, 'Payment Mode': 'Cash', 'Follow-up After': 'None' }], rows: [R({})],
    check: (o) => { ok(!o('Update Sheet'), 'no update'); ok(/not found/.test(o('Not Saved')[0].message), 'error shown'); } },
  { name: 'daily report: email + doctor WhatsApp', wf: 'daily_report', entry: 'Schedule', trigger: [{}],
    rows: [R({ appt_date: TODAY, status: 'Completed', payment_status: 'Paid', amount_paid: '700' }), R({ appointment_id: 'APT-CCCCCC', appt_date: TOMORROW })],
    check: (o) => {
      ok(/1 visits, Rs 700/.test(o('Email Report')[0].subject), o('Email Report')[0].subject);
      eq(o('Send Report WhatsApp')[0].__sent.template.name, 'doctor_report_v1', 'doctor whatsapp');
    } },
  { name: 'error handler: alert email', wf: 'error_handler', entry: 'Error Trigger',
    trigger: [{ execution: { id: '1', url: 'https://n8n.example/execution/1', error: { message: 'Sheet not found' }, lastNodeExecuted: 'Read Appointments' }, workflow: { id: 'x', name: 'Sunrise · 1 · Book Appointment' } }],
    check: (o) => ok(/Sheet not found/.test(o('Email Admin')[0].html), 'error in email') },
  { name: 'razorpay: valid signature marks Paid', wf: 'razorpay', entry: 'Razorpay Webhook',
    trigger: [{ headers: { 'x-razorpay-signature': rzpSig }, body: rzpBody }], binary: Buffer.from(rzpRaw).toString('base64'),
    check: (o) => {
      const u = o('Mark Paid')[0];
      eq(u.appointment_id, 'APT-K7M2QX', 'ref id'); eq(u.payment_status, 'Paid', 'paid'); eq(u.amount_paid, 200, 'rupees');
    } },
  { name: 'razorpay: forged signature ignored', wf: 'razorpay', entry: 'Razorpay Webhook',
    trigger: [{ headers: { 'x-razorpay-signature': 'deadbeef' }, body: rzpBody }], binary: Buffer.from(rzpRaw).toString('base64'),
    check: (o) => { ok(!o('Mark Paid'), 'not updated'); ok(/signature/.test(o('Verify & Parse')[0].reason), 'reason'); } },
  { name: 'AI engine: book via tool', wf: 'booking_engine', entry: 'When Called By AI',
    trigger: [{ action: 'book', doctor: 'Dr. Mehta', date: MEHTA_DAY, time: '11:00', patient_name: 'Asha', visit_type: 'New', appointment_id: '', phone: '919876543210' }], rows: [R({ appt_date: MEHTA_DAY })],
    check: (o) => {
      eq(o('Append Booking')[0].whatsapp_consent, 'Yes', 'appended');
      ok(/^BOOKED/.test(o('Reply To AI')[0].response), o('Reply To AI')[0].response);
    } },
  { name: 'AI engine: availability (read-only)', wf: 'booking_engine', entry: 'When Called By AI',
    trigger: [{ action: 'availability', doctor: 'Dr. Mehta', date: MEHTA_DAY, time: '', patient_name: '', visit_type: '', appointment_id: '', phone: '919876543210' }], rows: [R({ appt_date: MEHTA_DAY })],
    check: (o) => { ok(!o('Append Booking') && !o('Update Booking'), 'no writes'); ok(/Dr\. Mehta on/.test(o('Reply To AI')[0].response), o('Reply To AI')[0].response); } },
  { name: 'AI receptionist: Meta webhook verification', wf: 'ai_receptionist', entry: 'Meta Verify (GET)',
    trigger: [{ query: { 'hub.mode': 'subscribe', 'hub.verify_token': config.ai_assistant.verify_token, 'hub.challenge': '12345' } }],
    check: (o) => { eq(o('Reply Challenge')[0].__respond, '12345', 'challenge echoed'); eq(o('Reply Challenge')[0].code, 200, '200'); } },
  { name: 'AI receptionist: voice note gets a polite text reply', wf: 'ai_receptionist', entry: 'Meta Webhook (POST)',
    trigger: [{ body: { entry: [{ changes: [{ value: { contacts: [{ wa_id: '919876543210' }], messages: [{ id: 'w1', from: '919876543210', type: 'audio' }] } }] }] } }],
    check: (o) => ok(/only read text/.test(o('Send Reply')[0].__sent.text.body), 'unsupported reply sent') },
];

// ---------- run ----------
let failures = 0;
const results = [];
function ok(cond, msg) { if (!cond) throw new Error(msg); }
function eq(a, b, msg) { if (a !== b) throw new Error(msg + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }

const wfs = SCENARIOS.map((s, i) => {
  const w = mock(built[s.wf], { entry: s.entry, triggerItems: s.trigger, triggerBinary: s.binary, sheetRows: s.rows });
  w.id = ('e2e' + String(i).padStart(13, '0')).slice(0, 16);
  w.name = 'E2E ' + i + ' ' + s.name;
  w.active = false;
  return w;
});
const importFile = path.join(HOME, 'import.json');
fs.writeFileSync(importFile, JSON.stringify(wfs));
const run = (args) => execFileSync(NODE, [N8N].concat(args), { env: ENV, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
console.log('Importing ' + wfs.length + ' test workflows into a throwaway n8n (' + HOME + ')…');
run(['import:workflow', '--input=' + importFile]);

for (const [i, s] of SCENARIOS.entries()) {
  let out = '';
  try {
    out = run(['execute', '--id=' + wfs[i].id, '--rawOutput']);
    const start = out.search(/^\{/m); // JSON starts at the first line beginning with "{"
    if (start < 0) throw new Error('n8n printed no execution JSON:\n' + out.slice(-1500));
    const json = JSON.parse(out.slice(start));
    const runData = (json.data && json.data.resultData && json.data.resultData.runData) || (json.resultData && json.resultData.runData) || json.runData || json;
    const err = json.data && json.data.resultData && json.data.resultData.error;
    if (err) throw new Error('n8n error: ' + (err.message || JSON.stringify(err)));
    const o = (name) => {
      const r = runData[name];
      if (!r) return undefined;
      const items = (r[r.length - 1].data && r[r.length - 1].data.main && r[r.length - 1].data.main.flat()) || [];
      return items.length ? items.map((x) => x.json) : undefined;
    };
    s.check(o);
    console.log('  ✔ ' + s.name);
  } catch (e) {
    failures++;
    console.log('  ✖ ' + s.name + '\n      ' + String(e.message).split('\n').slice(0, 6).join('\n      '));
    if (process.env.E2E_DEBUG) console.log(out.slice(0, 4000));
  }
}
console.log(failures ? '\n' + failures + ' scenario(s) failed' : '\nAll ' + SCENARIOS.length + ' scenarios passed in real n8n ' + require(path.join(MODULES, 'n8n', 'package.json')).version);
if (!process.env.E2E_KEEP) fs.rmSync(HOME, { recursive: true, force: true });
process.exit(failures ? 1 : 0);
