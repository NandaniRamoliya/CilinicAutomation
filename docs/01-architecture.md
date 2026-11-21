# 1 · Architecture & design decisions

## Building blocks

| Piece | Role | Owned by |
|---|---|---|
| Google Sheet (`Appointments` + `Dashboard` tabs) | Database — one row per appointment, follow-up visit = new row | Clinic's Google account |
| n8n | Runs the workflows (Cloud or self-hosted) | Clinic's account (recommended) |
| WhatsApp Cloud API (Meta) | Reminders, confirmations, AI chat | Clinic's Meta Business |
| Gmail | Doctor report + admin alerts | Clinic or you |
| Razorpay *(optional)* | Online advance fee | Clinic |
| OpenAI / Anthropic *(optional)* | Language understanding for the AI receptionist | Clinic |

## The build pipeline

```
clients/<slug>/client.config.json ──┐
src/lib/*.js (tested logic) ────────┼──► scripts/build.js ──► dist/<slug>/workflows/*.json ──► n8n
src/workflows/*.js (node layout) ───┘                     └─► SETUP-CHECKLIST.md, WhatsApp texts, sheet header
```

Each Code node = the needed `src/lib` modules + the client config frozen in as `const CONFIG = {...}` + a few
lines of glue. To change behaviour for every client, change `src/lib` (and its tests) and rebuild; to change one
client, change their config and rebuild/redeploy. **Don't hand-edit Code nodes in n8n** — the next deploy overwrites them.

## Key decisions

**Sheet, not Google Calendar, is the source of truth.** The AI-workflow blueprint suggested Calendar free/busy.
Using one store keeps form bookings, AI bookings, reminders, reports and the Dashboard consistent, avoids
two-way sync bugs, and a receptionist can read/fix a sheet. Calendar sync can be added later as a one-way mirror.

**Validation in code, not in the form.** Doctor timings, weekly offs, holidays, max days ahead, patients per slot,
duplicate submits and past dates are checked in `booking.js`. The reception sees the result on the form's ending
page — no email round-trip.

**WhatsApp via HTTP Request, not the WhatsApp node.** One node sends any template; parameter order comes from the
config, so every clinic can word its approved templates differently with no workflow changes. It also makes
switching to a BSP a change in one place (`src/workflows/_nodes.js → whatsappSend`, `src/lib/whatsapp.js`).

**Reminder safety.** Consent `Yes` only; `last_reminder_date` prevents double sends on re-runs; a failing number
never blocks the rest (Continue on Fail + per-item result check); failures are emailed to you.

**The AI never writes to the sheet.** Workflow 7 (agent) can only call workflow 8 (engine) with
`availability / book / my_appointments / cancel`. The engine reuses `booking.js`, and the patient's phone
number is injected from the WhatsApp sender — the model cannot see or cancel anyone else's appointments.

**Accounts in the clinic's name.** Patient data belongs to the clinic; you get access as an admin.

## Data model

See `sheet-template/dashboard-formulas.md` for the 15 columns. Statuses: `Booked → Completed | No-show | Cancelled`.
Payment: `Pending | Paid | Free`. Dates `YYYY-MM-DD`, times `HH:MM` 24h, phone `919876543210`.

## n8n execution budget

n8n Cloud counts one execution per workflow run.

| Source | Executions / month |
|---|---|
| Booking form | 1 per booking |
| Visit update form | 1 per visit |
| Reminders (daily) + report (daily) | ~60 |
| Same-day reminders (hourly, 12 h/day) | ~360 |
| Razorpay | 1 per online payment |
| AI receptionist | 1 per patient message + 1 per tool call (sub-workflow runs may count — check the plan) |

Core formula ≈ **60 × (appointments per day) + 60**. 30/day ≈ 1,860 (fits Starter's 2,500); 40+/day → Pro or
self-hosting. Add the AI and same-day reminders on top. Re-check current plan limits on n8n's pricing page.

## Known limits

- Two bookings for the same slot submitted in the **same second** can both pass (both read the sheet before
  either writes). Rare at a reception desk; the daily "not updated"/duplicate checks catch it. A clinic that needs
  strict locking should move the store to a database (Postgres/Supabase) — swap the Sheets nodes, keep `src/lib`.
- Every workflow reads the whole `Appointments` tab. Archive old years at ~20k rows.
- The AI receptionist's memory (Simple Memory) is per n8n process; it resets on restart and does not work in queue
  mode — use Postgres/Redis chat memory there.
- Day-before reminders go out at the reminder time; bookings made *after* that time for tomorrow get no
  day-before reminder (enable the same-day reminder or the booking confirmation to cover them).
