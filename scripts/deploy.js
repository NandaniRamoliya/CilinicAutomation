#!/usr/bin/env node
// Push a client's workflows straight into their n8n via the n8n Public API.
//
//   N8N_URL=https://clinic.app.n8n.cloud N8N_API_KEY=xxxx npm run deploy -- <client-slug> [--activate] [--dry-run]
//
// - First run creates the workflows; later runs UPDATE the same workflows (IDs are
//   remembered in clients/<slug>/.deployed.json, which is git-ignored).
// - Links every workflow's "Error workflow" to the Error Handler and the AI tools to
//   the Booking Engine automatically.
// - Keeps credentials you already picked in the n8n UI when re-deploying.
// - --activate turns on everything except the Booking Engine (it is only called by the AI).
// Create the API key in n8n: Settings → n8n API → Create an API key.
const fs = require('fs');
const path = require('path');
const { loadConfig, CLIENTS_DIR } = require('./config');
const { buildWorkflows } = require('./build');

const API_SETTINGS = ['saveExecutionProgress', 'saveManualExecutions', 'saveDataErrorExecution', 'saveDataSuccessExecution',
  'executionTimeout', 'errorWorkflow', 'timezone', 'executionOrder', 'callerPolicy'];

function apiClient(baseUrl, apiKey) {
  const root = baseUrl.replace(/\/+$/, '') + '/api/v1';
  return async function api(method, p, body) {
    const res = await fetch(root + p, {
      method,
      headers: { 'X-N8N-API-KEY': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { raw: text }; }
    if (!res.ok) {
      const err = new Error(method + ' ' + p + ' → ' + res.status + ': ' + (data.message || text).slice(0, 300));
      err.status = res.status;
      throw err;
    }
    return data;
  };
}

/** Public API accepts only name/nodes/connections/settings (and a limited settings set). */
function toApiBody(wf) {
  const settings = {};
  for (const k of API_SETTINGS) if (wf.settings[k] !== undefined) settings[k] = wf.settings[k];
  return { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings };
}

/** Re-use credentials already selected in the UI for nodes the config left blank. */
function keepCredentials(wf, existing) {
  if (!existing) return wf;
  const byName = Object.fromEntries((existing.nodes || []).map((n) => [n.name, n]));
  for (const node of wf.nodes) {
    const old = byName[node.name];
    if (!old || !old.credentials || !node.credentials) continue;
    for (const [type, cred] of Object.entries(node.credentials)) {
      if (!cred.id && old.credentials[type] && old.credentials[type].id) node.credentials[type] = old.credentials[type];
    }
  }
  return wf;
}

function stripEmptyCredentials(wf) {
  // n8n rejects credential references without an id; leave them for the UI instead
  for (const node of wf.nodes) {
    if (!node.credentials) continue;
    for (const [type, cred] of Object.entries(node.credentials)) if (!cred.id) delete node.credentials[type];
    if (!Object.keys(node.credentials).length) delete node.credentials;
  }
  return wf;
}

async function deploy(slug, opts) {
  const config = loadConfig(slug);
  const stateFile = path.join(CLIENTS_DIR, slug, '.deployed.json');
  const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { ids: {} };
  if (state.url && state.url !== opts.url) {
    throw new Error('This client was deployed to ' + state.url + ', not ' + opts.url + '. Delete ' + path.relative(process.cwd(), stateFile) + ' to deploy to a new instance.');
  }
  const api = opts.api || apiClient(opts.url, opts.apiKey);
  const ids = Object.assign({}, state.ids);
  const log = opts.log || console.log;
  const missingCreds = {};

  // Auto-attach credentials by name (newer n8n lets the API list credentials).
  const credIndex = {};
  const byType = {};
  try {
    const list = await api('GET', '/credentials?limit=250');
    for (const c of list.data || []) {
      credIndex[c.type + '|' + c.name] = c.id;
      byType[c.type] = (byType[c.type] || []).concat([c]);
    }
  } catch (e) { /* older n8n: no credential listing — fall back to the UI */ }
  function attachByName(wf) {
    for (const node of wf.nodes) {
      for (const [type, cred] of Object.entries(node.credentials || {})) {
        if (cred.id) continue;
        const exact = credIndex[type + '|' + cred.name];
        const only = byType[type] && byType[type].length === 1 ? byType[type][0] : null;
        if (exact) cred.id = exact;
        else if (only) node.credentials[type] = { id: only.id, name: only.name };
      }
    }
    return wf;
  }

  async function upsert(key) {
    const wf = buildWorkflows(config, ids).find((w) => w.key === key);
    if (!wf) return;
    let existing = null;
    if (ids[key]) {
      try { existing = await api('GET', '/workflows/' + ids[key]); } catch (e) { if (e.status !== 404) throw e; }
    }
    const wanted = JSON.parse(JSON.stringify(wf.json.nodes));
    // priority: credential id in config > what was picked in the UI > same name / only one of that type
    const json = stripEmptyCredentials(attachByName(keepCredentials(wf.json, existing)));
    for (const n of json.nodes) {
      const needs = (wanted.find((x) => x.name === n.name) || {}).credentials;
      for (const [type, cred] of Object.entries(needs || {})) {
        if (n.credentials && n.credentials[type]) continue;
        const label = cred.name + ' (' + type + ')';
        missingCreds[label] = (missingCreds[label] || 0) + 1;
      }
    }
    if (opts.dryRun) { log('  (dry-run) ' + (existing ? 'update ' : 'create ') + json.name); ids[key] = ids[key] || 'dry-' + key; return; }
    if (existing) {
      await api('PUT', '/workflows/' + ids[key], toApiBody(json));
      log('  ↻ updated  ' + json.name + '  (' + ids[key] + ')');
    } else {
      const created = await api('POST', '/workflows', toApiBody(json));
      ids[key] = created.id;
      log('  ＋ created  ' + json.name + '  (' + created.id + ')');
    }
  }

  log('Deploying "' + slug + '" to ' + opts.url);
  // order matters: error handler + engine first so others can reference their IDs
  const order = ['error_handler', 'booking_engine'];
  const all = buildWorkflows(config, ids).map((w) => w.key);
  for (const key of order.concat(all.filter((k) => !order.includes(k)))) await upsert(key);

  if (!opts.dryRun) {
    fs.writeFileSync(stateFile, JSON.stringify({ url: opts.url, deployed_at: new Date().toISOString(), ids }, null, 2) + '\n');
  }

  if (opts.activate && !opts.dryRun) {
    for (const key of all) {
      if (key === 'booking_engine' || key === 'error_handler') continue;
      try {
        await api('POST', '/workflows/' + ids[key] + '/activate');
        log('  ▶ activated ' + key);
      } catch (e) {
        log('  ! could not activate ' + key + ': ' + e.message + '  (usually a missing credential — open it in n8n)');
      }
    }
  }
  if (Object.keys(missingCreds).length) {
    log('\nCredentials not found in n8n yet — create them with EXACTLY these names, then run deploy again:');
    for (const [label, count] of Object.entries(missingCreds)) log('  - ' + label + ' — used by ' + count + ' node(s)');
  }
  log('\nForms: ' + opts.url.replace(/\/+$/, '') + '/form/' + slug + '-book  and  /form/' + slug + '-visit');
  return ids;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const slug = args.find((a) => !a.startsWith('-'));
  const url = process.env.N8N_URL;
  const apiKey = process.env.N8N_API_KEY;
  if (!slug || !url || !apiKey) {
    console.error('Usage: N8N_URL=https://… N8N_API_KEY=… npm run deploy -- <client-slug> [--activate] [--dry-run]');
    process.exit(1);
  }
  deploy(slug, { url, apiKey, activate: args.includes('--activate'), dryRun: args.includes('--dry-run') })
    .catch((e) => { console.error('✖ ' + e.message); process.exit(1); });
}

module.exports = { deploy, toApiBody, keepCredentials, stripEmptyCredentials, apiClient };
