# 4 · Go-live testing checklist

Run on a **copy of the sheet** with **your own / your team's phone numbers**. Tick every line before switching to
the real sheet. (The automated `npm test` + `npm run test:e2e` cover the logic; this list covers the real accounts.)

## Booking form (workflow 1)
- [ ] Book a normal appointment → row appears, ending page shows `APT-…`
- [ ] Book the **same doctor + date + time** again → "Not booked", nearest free slots listed, no new row
- [ ] Book the same slot after **cancelling** the first → allowed
- [ ] Submit the same patient twice for the same doctor/day → blocked as duplicate
- [ ] Weekly off day and a holiday → blocked with the reason
- [ ] A slot outside that doctor's sessions → blocked
- [ ] Past date → blocked; phone `12345` → blocked; phone `098765 43210` → saved as `919876543210`
- [ ] First booking on an **empty** sheet works
- [ ] Booking confirmation WhatsApp arrives (if enabled) only when "WhatsApp Updates = Yes"

## Reminders (workflow 2 / 2b)
- [ ] Set a test row to tomorrow → *Execute workflow* → WhatsApp received, `last_reminder_date` = today
- [ ] Execute again → **no** second message
- [ ] Consent `No` row → no message
- [ ] Completed row with `follow_up_date` = tomorrow → follow-up message; same phone with a new future booking → no follow-up
- [ ] One row with an invalid number → others still sent, admin email lists the failure
- [ ] Same-day (if on): appointment within N hours → message once

## Visit update (workflow 3)
- [ ] Completed + UPI + 500 + 15 days → status, Paid, amount, follow-up date (moved off a weekly off) updated
- [ ] No-show and Cancelled → status updated, follow-up cleared
- [ ] Wrong ID → "Not saved" page, nothing changed
- [ ] Future appointment marked Completed → refused (catches mistyped IDs)

## Report (workflow 4)
- [ ] Execute → numbers match a hand count (today, completed, no-show, not updated, collection, pending, tomorrow)
- [ ] No patient names in the email

## Errors (workflow 0)
- [ ] Temporarily rename the sheet tab → run workflow 1 → admin email arrives → rename back

## Optional
- [ ] Razorpay test-mode payment link with `reference_id` = a test ID → row Paid; a request with a wrong signature → ignored
- [ ] AI receptionist: see `08-ai-receptionist.md` test script

## Before switching to production
- [ ] `google.sheet_id` → real sheet, `npm run deploy -- <slug> --activate`
- [ ] Every workflow **active**; reception has the **Production** form URLs (not `/form-test/`)
- [ ] Sheet shared only with clinic staff; no medical columns
- [ ] Clinic has the handover guide; support period agreed
