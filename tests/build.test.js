// Build + config tests — run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadConfig, validateConfig, merge, DEFAULTS } = require('../scripts/config');
const { buildWorkflows, buildClient } = require('../scripts/build');
const { toApiBody, keepCredentials, stripEmptyCredentials } = require('../scripts/deploy');

const demo = () => loadConfig('demo-clinic');

test('demo client builds all 9 workflows with unique node names and valid connections', () => {
  const wfs = buildWorkflows(demo());
  assert.equal(wfs.length, 9);
  for (const { json } of wfs) {
    const names = json.nodes.map((n) => n.name);
    assert.equal(new Set(names).size, names.length, json.name + ' has duplicate node names');
    for (const [from, types] of Object.entries(json.connections)) {
      assert.ok(names.includes(from), json.name + ': unknown source ' + from);
      for (const outs of Object.values(types)) for (const out of outs) for (const c of out) assert.ok(names.includes(c.node), json.name + ': unknown target ' + c.node);
    }
    assert.equal(json.settings.timezone, 'Asia/Kolkata');
  }
});

test('feature flags add/remove workflows and nodes', () => {
  const c = demo();
  c.features = { booking_confirmation_whatsapp: false, doctor_report_whatsapp: false, razorpay_advance_fee: false, ai_whatsapp_assistant: false };
  c.reminders.same_day_hours_before = 0;
  const keys = buildWorkflows(c).map((w) => w.key);
  assert.deepEqual(keys, ['error_handler', 'book_appointment', 'reminders', 'visit_update', 'daily_report']);
  const book = buildWorkflows(c).find((w) => w.key === 'book_appointment').json;
  assert.ok(!book.nodes.some((n) => n.name === 'Send Confirmation'));
  c.whatsapp.enabled = false;
  assert.ok(!buildWorkflows(c).some((w) => w.key === 'reminders'));
});

test('generated Code nodes contain no Node-only require/module.exports and parse as JS', () => {
  for (const { json } of buildWorkflows(demo())) {
    for (const n of json.nodes.filter((x) => x.type === 'n8n-nodes-base.code')) {
      const js = n.parameters.jsCode;
      assert.ok(!/require\(|module\.exports/.test(js), n.name + ' still has require/module.exports');
      assert.doesNotThrow(() => new Function('$input', '$', 'async function f(){' + js + '}'), n.name + ' is not valid JS');
    }
  }
});

test('form dropdowns follow the config', () => {
  const book = buildWorkflows(demo()).find((w) => w.key === 'book_appointment').json;
  const form = book.nodes.find((n) => n.type === 'n8n-nodes-base.formTrigger');
  const field = (label) => form.parameters.formFields.values.find((f) => f.fieldLabel === label);
  assert.deepEqual(field('Doctor').fieldOptions.values.map((o) => o.option), ['Dr. Mehta', 'Dr. Rao']);
  assert.equal(field('Time Slot').fieldOptions.values[0].option, '10:00');
  assert.equal(form.parameters.options.path, 'demo-clinic-book');
});

test('deploy IDs are wired into errorWorkflow and AI tools', () => {
  const wfs = buildWorkflows(demo(), { error_handler: 'ERR1', booking_engine: 'ENG1' });
  assert.equal(wfs.find((w) => w.key === 'book_appointment').json.settings.errorWorkflow, 'ERR1');
  assert.equal(wfs.find((w) => w.key === 'error_handler').json.settings.errorWorkflow, undefined);
  const ai = wfs.find((w) => w.key === 'ai_receptionist').json;
  assert.equal(ai.nodes.find((n) => n.name === 'book_appointment').parameters.workflowId.value, 'ENG1');
});

test('config validation catches common mistakes', () => {
  const c = demo();
  c.client.slug = 'demo-clinic';
  c.schedule.sessions = [{ start: '13:00', end: '10:00' }];
  c.doctors = ['Dr. A', 'dr. a'];
  c.notifications.admin_email = 'nope';
  c.whatsapp.templates.appointment_reminder.params = ['patient_name', 'diagnosis'];
  c.schedules.report_cron = '0 21 * *';
  const errs = validateConfig(c, 'demo-clinic').join('\n');
  assert.match(errs, /start must be before end/);
  assert.match(errs, /duplicate names/);
  assert.match(errs, /admin_email/);
  assert.match(errs, /unknown param "diagnosis"/);
  assert.match(errs, /5-field cron/);
});

test('template config refuses to build until placeholders are filled', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'clients', '_template', 'client.config.json'), 'utf8'));
  raw.client.slug = 'x-clinic';
  const errs = validateConfig(merge(DEFAULTS, raw), 'x-clinic');
  assert.match(errs.join('\n'), /Fill the placeholders/);
});

test('buildClient writes a complete setup pack', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-'));
  const r = buildClient('demo-clinic', out);
  const dir = path.join(out, 'demo-clinic');
  for (const f of ['SETUP-CHECKLIST.md', 'whatsapp-templates.md', 'manifest.json', 'sheet/Appointments-header.csv']) assert.ok(fs.existsSync(path.join(dir, f)), f);
  assert.equal(fs.readdirSync(path.join(dir, 'workflows')).length, r.count);
  assert.match(fs.readFileSync(path.join(dir, 'whatsapp-templates.md'), 'utf8'), /appointment_reminder_v1/);
  fs.rmSync(out, { recursive: true, force: true });
});

test('committed dist/demo-clinic is up to date with src/', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-'));
  buildClient('demo-clinic', out);
  const fresh = path.join(out, 'demo-clinic', 'workflows');
  const committed = path.join(__dirname, '..', 'dist', 'demo-clinic', 'workflows');
  for (const f of fs.readdirSync(fresh)) {
    assert.equal(fs.readFileSync(path.join(committed, f), 'utf8'), fs.readFileSync(path.join(fresh, f), 'utf8'), f + ' is stale — run: npm run build -- demo-clinic');
  }
  fs.rmSync(out, { recursive: true, force: true });
});

test('deploy helpers: API body whitelist and credential handling', () => {
  const wf = buildWorkflows(demo()).find((w) => w.key === 'daily_report').json;
  const body = toApiBody(wf);
  assert.deepEqual(Object.keys(body), ['name', 'nodes', 'connections', 'settings']);
  assert.ok(!('saveManualExecutions' in body.settings) || body.settings.saveManualExecutions === true);
  const existing = { nodes: [{ name: 'Email Report', credentials: { gmailOAuth2: { id: 'G1', name: 'x' } } }] };
  const kept = keepCredentials(JSON.parse(JSON.stringify(wf)), existing);
  assert.equal(kept.nodes.find((n) => n.name === 'Email Report').credentials.gmailOAuth2.id, 'G1');
  const stripped = stripEmptyCredentials(JSON.parse(JSON.stringify(wf)));
  assert.ok(!stripped.nodes.find((n) => n.name === 'Read Appointments').credentials);
});
