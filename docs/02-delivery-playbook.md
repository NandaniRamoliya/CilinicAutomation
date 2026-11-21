# 2 · Delivery playbook — from "yes" to handover

Typical timeline: **5–10 working days**, most of it waiting for Meta business verification and template approval.
Start the Meta steps on day 1.

## Day 0 · Discovery call (30 min) — fill the config as you talk

| Ask | Goes into `client.config.json` |
|---|---|
| Clinic name, short name, city, front-desk phone, address | `client.*` |
| Doctors, their days and timings (morning/evening), weekly off per doctor | `doctors`, `schedule.sessions`, `schedule.closed_weekdays` |
| Slot length; how many patients per slot | `schedule.slot_minutes`, `patients_per_slot` (can be per doctor) |
| Holidays already known | `schedule.holidays` |
| How far ahead do they book? | `schedule.max_days_ahead` |
| Visit types they use | `visit_types` |
| Typical follow-up intervals | `follow_up_options_days` |
| Payment modes | `payment_modes` (Free/Pending are added automatically) |
| Who gets the daily report (email / WhatsApp)? At what time do they close? | `notifications.report_emails`, `report_whatsapp_numbers`, `schedules.report_cron` |
| Reminder time; same-day reminder wanted? | `schedules.reminder_cron`, `reminders.same_day_hours_before` |
| Language for patient messages (English / Hinglish) | `whatsapp.templates.*.language` + template text |
| Add-ons: booking confirmation, online advance fee, AI WhatsApp receptionist | `features.*` |
| Appointments per day (for n8n plan sizing) | — see `docs/01-architecture.md` execution budget |

Also agree in writing: **which data is NOT stored** (no medical details), who owns the accounts (the clinic), support period.

## Day 1 · Accounts (in the clinic's name) — see `03-accounts-and-credentials.md`

1. Clinic Google account → create the spreadsheet from `sheet-template/` (headers, plain-text columns, Dashboard tab). Put its ID in `google.sheet_id`.
2. n8n: Cloud trial/Starter or self-hosted. Set the instance timezone. Create an API key (Settings → n8n API) if you'll use `deploy`.
3. Meta Business + WhatsApp Business Platform: dedicated number, business verification, **permanent system-user token**, note the **Phone number ID** → `whatsapp.phone_number_id`.
4. Submit the WhatsApp templates (`dist/<slug>/whatsapp-templates.md`, category Utility). Approval can take hours to days.

## Day 1–2 · Configure and build

```bash
npm run new-client -- <slug> "Clinic Name"
# edit clients/<slug>/client.config.json
npm run build -- <slug>
```
The build refuses to run while any `REPLACE_` value, bad time, unknown weekday, bad email or unknown template
parameter remains — fix what it lists.

## Day 2 · Credentials and deploy

In the client's n8n, create credentials with **exactly** these names (or change the names in config):

| Name | Type |
|---|---|
| `Google Sheets (clinic)` | Google Sheets OAuth2 |
| `Gmail (alerts)` | Gmail OAuth2 |
| `WhatsApp Cloud API` | Header Auth — Name `Authorization`, Value `Bearer <permanent token>` |
| `OpenAI account` / `Anthropic account` | only for the AI add-on |

```bash
N8N_URL=https://<instance> N8N_API_KEY=<key> npm run deploy -- <slug>
```
Fix any "credentials not found" lines it prints, run it again with `--activate`.

**Manual alternative:** import `dist/<slug>/workflows/00-error-handler.json` first, then the rest; pick the
credential on every node with a warning; set *Settings → Error workflow* on each; for the AI add-on select
"8 · Booking Engine" in the four tool nodes (or paste the IDs into `n8n.workflow_ids` and rebuild).

## Day 3 · Test on a copy (never on real patients)

Point a *copy* of the sheet + your own phone numbers, run `docs/04-testing-checklist.md` end to end. Then switch
`google.sheet_id` to the real sheet and redeploy.

## Day 3–4 · Go live + train reception (30 min)

- Bookmark both form URLs on the reception computer (`/form/<slug>-book`, `/form/<slug>-visit`).
- Walk through `docs/06-reception-handover.md` with them: book, clash, visit update, Dashboard list.
- Enter already-booked future appointments from the register (same columns, same formats).

## Week 1 · Watch

Check executions daily for a week, read the first reports with the doctor, watch "Not updated" in the report
(it tells you whether reception is filling the Visit Update form).

## Maintenance (monthly retainer work)

| Change | How |
|---|---|
| New doctor / new timings / weekly off | Edit `doctors` / `schedule` → `npm run deploy -- <slug>` |
| Holiday | Add to `schedule.holidays` → deploy |
| New template wording | Get it approved in Meta → update `whatsapp.templates` → deploy |
| Turn on an add-on | `features.*` → build → deploy (`--activate`) |
| Kit improvement for all clients | Change `src/`, `npm test`, then `npm run build:all` and deploy each client |

Re-deploys update the same workflows and keep credentials that were picked in the UI.
Keep `clients/<slug>/` in a **private** place (it is git-ignored here on purpose).
