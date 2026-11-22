#!/usr/bin/env node
// Scaffold a new client folder from the template.
//   npm run new-client -- city-dental "City Dental Care"
const fs = require('fs');
const path = require('path');
const { CLIENTS_DIR } = require('./config');

const [slug, ...nameParts] = process.argv.slice(2);
if (!slug || !/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug)) {
  console.error('Usage: npm run new-client -- city-dental "City Dental Care"   (short name: lowercase letters, digits, dashes — no < > brackets)');
  process.exit(1);
}
const dir = path.join(CLIENTS_DIR, slug);
if (fs.existsSync(dir)) {
  console.error('clients/' + slug + ' already exists — edit clients/' + slug + '/client.config.json');
  process.exit(1);
}
const tpl = JSON.parse(fs.readFileSync(path.join(CLIENTS_DIR, '_template', 'client.config.json'), 'utf8'));
tpl.client.slug = slug;
if (nameParts.length) {
  const name = nameParts.join(' ');
  tpl.client.clinic_name = name;
  tpl.client.short_name = name.split(/\s+/)[0];
}
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'client.config.json'), JSON.stringify(tpl, null, 2) + '\n');
console.log('Created clients/' + slug + '/client.config.json');
console.log('Next: fill every REPLACE_ value (see docs/02-delivery-playbook.md), then: npm run build -- ' + slug);
console.log('Note: clients/' + slug + '/ is git-ignored on purpose — patient-facing client data stays out of the repo.');
