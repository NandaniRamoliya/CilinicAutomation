#!/usr/bin/env node
// Validate built workflows against a REAL n8n install's node definitions:
// node type exists, typeVersion is supported, no unknown/misplaced parameters,
// no missing required parameters, credentials types match, connections are sane.
//
//   N8N_MODULES=/path/to/node_modules npm run validate:n8n -- demo-clinic
// (N8N_MODULES = a node_modules folder containing n8n, e.g. from `npm i n8n` or a global install)
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./config');

const modulesDir = process.env.N8N_MODULES;
if (!modulesDir || !fs.existsSync(path.join(modulesDir, 'n8n-workflow'))) {
  console.error('Set N8N_MODULES to a node_modules folder that contains n8n (n8n-workflow, n8n-nodes-base, @n8n/n8n-nodes-langchain).');
  process.exit(2);
}
const { NodeHelpers } = require(path.join(modulesDir, 'n8n-workflow'));

function loadPackage(pkgDir, prefix) {
  const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  const map = {};
  for (const rel of pkg.n8n.nodes) {
    try {
      const mod = require(path.join(pkgDir, rel));
      for (const Cls of Object.values(mod)) {
        if (typeof Cls !== 'function') continue;
        let inst;
        try { inst = new Cls(); } catch (e) { continue; }
        if (!inst.description) continue;
        map[prefix + '.' + inst.description.name] = inst;
      }
    } catch (e) { /* some nodes need optional deps; skip */ }
  }
  return map;
}

const TYPES = Object.assign(
  loadPackage(path.join(modulesDir, 'n8n-nodes-base'), 'n8n-nodes-base'),
  loadPackage(path.join(modulesDir, '@n8n', 'n8n-nodes-langchain'), '@n8n/n8n-nodes-langchain'),
);

function describe(type, version) {
  const inst = TYPES[type];
  if (!inst) return null;
  if (inst.nodeVersions) {
    const v = inst.nodeVersions[version];
    if (!v) return { unsupported: Object.keys(inst.nodeVersions) };
    return v.description;
  }
  const versions = [].concat(inst.description.version);
  if (!versions.includes(version)) return { unsupported: versions };
  return inst.description;
}

function validateWorkflow(wf) {
  const problems = [];
  const names = new Set(wf.nodes.map((n) => n.name));
  if (names.size !== wf.nodes.length) problems.push('duplicate node names');
  const incoming = new Set();
  for (const [from, byType] of Object.entries(wf.connections)) {
    if (!names.has(from)) problems.push('connection from unknown node "' + from + '"');
    for (const outputs of Object.values(byType)) for (const out of outputs) for (const c of out) {
      if (!names.has(c.node)) problems.push('connection to unknown node "' + c.node + '"');
      incoming.add(c.node);
    }
  }
  for (const node of wf.nodes) {
    const where = '[' + node.name + '] ';
    const desc = describe(node.type, node.typeVersion);
    if (!desc) { problems.push(where + 'unknown node type ' + node.type); continue; }
    if (desc.unsupported) { problems.push(where + node.type + ' v' + node.typeVersion + ' not supported (has ' + desc.unsupported.join(', ') + ')'); continue; }
    const isTrigger = (desc.group || []).includes('trigger') || /Trigger$/i.test(node.type) || node.type.endsWith('.webhook');
    const isSub = /langchain\.(lmChat|memory|tool)/.test(node.type);
    if (!isTrigger && !isSub && node.type !== 'n8n-nodes-base.stickyNote' && !incoming.has(node.name)) {
      problems.push(where + 'has no incoming connection');
    }
    if (isSub && !wf.connections[node.name]) problems.push(where + 'sub-node is not connected to an agent');

    // Unknown / hidden parameters: resolve like the editor does and diff the keys.
    // The AI tool's inputs are hidden until a sub-workflow is selected (deploy fills it in).
    const probe = JSON.parse(JSON.stringify(node));
    if (probe.parameters.workflowId && probe.parameters.workflowId.value === '') probe.parameters.workflowId.value = 'TO_BE_LINKED';
    const resolved = NodeHelpers.getNodeParameters(desc.properties, probe.parameters, true, false, probe, desc) || {};
    for (const k of Object.keys(node.parameters)) {
      if (!(k in resolved) && !(desc.properties.some((p) => p.name === k && p.type === 'notice'))) {
        problems.push(where + 'parameter "' + k + '" is not valid/visible for ' + node.type + ' v' + node.typeVersion);
      }
    }
    const issues = NodeHelpers.getNodeParametersIssues(desc.properties, probe, desc);
    if (issues && issues.parameters) {
      for (const [k, msgs] of Object.entries(issues.parameters)) {
        // workflowId of the AI tools is set by deploy (or picked in the UI) — not a build error
        if (k === 'workflowId') continue;
        problems.push(where + 'parameter issue "' + k + '": ' + msgs.join('; '));
      }
    }
    const allowedCreds = (desc.credentials || []).map((c) => c.name);
    for (const credType of Object.keys(node.credentials || {})) {
      if (!allowedCreds.includes(credType) && !['httpHeaderAuth'].includes(credType)) {
        problems.push(where + 'credential type ' + credType + ' not accepted (accepts ' + allowedCreds.join(', ') + ')');
      }
    }
  }
  return problems;
}

const slug = process.argv[2] || 'demo-clinic';
const dir = path.join(ROOT, 'dist', slug, 'workflows');
if (!fs.existsSync(dir)) { console.error('Build first: npm run build -- ' + slug); process.exit(2); }
let total = 0;
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
  const wf = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const problems = validateWorkflow(wf);
  total += problems.length;
  console.log((problems.length ? '✖ ' : '✔ ') + f + ' (' + wf.nodes.length + ' nodes)');
  for (const p of problems) console.log('    - ' + p);
}
console.log(total ? '\n' + total + ' problem(s)' : '\nAll workflows valid against n8n ' + require(path.join(modulesDir, 'n8n', 'package.json')).version);
process.exit(total ? 1 : 0);
