# 9 · Developer guide

## Rules of the codebase

- **Logic lives in `src/lib/`**, as plain functions with unit tests. Lib files must stay n8n-safe: no imports
  except inside `/* n8n:strip-start */ … /* n8n:strip-end */` blocks (removed at build time), no Node APIs, no `$env`.
- **Workflow shape lives in `src/workflows/`**. Use the factories in `_nodes.js`; keep node names stable (other nodes
  reference them via `$('Node Name')`, and deploy matches credentials by node name).
- **Nothing client-specific in `src/`** — it all comes from `client.config.json`. New option? Add a default in
  `scripts/config.js → DEFAULTS`, validate it in `validateConfig`, document it in the template.
- After changing `src/`, rebuild the demo (`npm run build -- demo-clinic`) — a test fails if `dist/demo-clinic` is stale.

## Workflow for a change

```bash
npm test                                          # logic + build
npm run build -- demo-clinic
N8N_MODULES=/path/to/node_modules npm run validate:n8n -- demo-clinic   # node types/versions/params
N8N_MODULES=/path/to/node_modules N8N_NODE=/path/to/node24 npm run test:e2e   # run inside real n8n
```

Getting a local n8n for the last two (one-time, ~5 min):
```bash
mkdir -p ~/n8n-local && cd ~/n8n-local && npm init -y && npm install n8n
```
n8n 2.x needs Node 24 (`npm install node@24` gives a binary at `node_modules/.bin/node` if your system Node is older).
The e2e harness uses the `legacy` expression engine so it doesn't need the isolated-vm native addon.

## Adding a workflow

1. Create `src/workflows/NN-name.js` exporting `{ key, file, enabled(config), build(ctx) }` (or an array of them).
2. Register it in `scripts/build.js → DEFINITIONS` (and in deploy order if others reference it).
3. Add logic to `src/lib` + tests; add an e2e scenario in `scripts/dev/n8n-e2e.js`.

## Swapping pieces

- **Another WhatsApp provider (BSP):** add `buildXxxPayload` in `src/lib/whatsapp.js`, a `whatsapp.provider` option, and branch in `N.whatsappSend` (URL, auth, body). `parseSendResult` must understand its responses.
- **A database instead of Sheets:** replace `sheetsReadAll / sheetsAppend / sheetsUpdate` in `_nodes.js` with Postgres/Supabase nodes returning the same column names. `src/lib` doesn't change.
- **Calendar mirror:** after `Save Appointment`, add a Google Calendar "create event" node keyed to the doctor; store the event id if you also want cancellations to sync.

## Node versions

Pinned in `_nodes.js` to versions available in n8n ≥ ~1.80 (Cloud and recent self-hosted) and validated against n8n 2.48:
formTrigger 2.2 · form 1 · code 2 · googleSheets 4.5 · scheduleTrigger 1.2 · if 2.2 · switch 3.2 · httpRequest 4.2 ·
gmail 2.1 · crypto 1 · webhook 2 · respondToWebhook 1.1 · executeWorkflowTrigger 1.1 · agent 1.7 · toolWorkflow 2.1 ·
lmChatOpenAi 1.2 · lmChatAnthropic 1.3 · memoryBufferWindow 1.3.
