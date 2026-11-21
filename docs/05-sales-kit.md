# 5 · Sales kit

> Prices below are **examples**, not promises. What you can charge depends on your city, the clinic's size, your
> demo and your track record. Never promise a specific drop in no-shows or a revenue number.

## What the doctor is buying (talk about these, not about n8n)

| Outcome | Feature |
|---|---|
| Fewer no-shows | WhatsApp reminder the evening before (+ optional 2 h before) |
| Follow-up patients come back | Automatic reminder on the follow-up date the doctor gave |
| Clean daily accounts | Report every night: visits, collection, pending payments, tomorrow's list |
| Less load on reception | No register, no reminder calls, double booking blocked automatically |
| *(add-on)* Bookings 24×7 | WhatsApp assistant books/cancels in Hindi/English while the clinic is closed |

## 10-minute demo (use `dist/demo-clinic` on your own n8n + a demo sheet)

1. Open the demo sheet (5 fake appointments, your own numbers).
2. Book from the form → row appears. Book the same slot again → "Not booked" + free slots.
3. Set one appointment to tomorrow → run Reminders → show the WhatsApp on your phone.
4. Visit Update → Completed + UPI + 15 days → show the follow-up date.
5. Show last night's report email. Ask: *"How long does this hisaab take you today?"*
6. *(If pitching the add-on)* message the demo WhatsApp number: "kal Dr. Mehta ke saath appointment chahiye".

## Packages (example)

| Package | Includes | Example setup fee | Example monthly |
|---|---|---|---|
| **Core** | Booking form + double-booking check, WhatsApp reminders + follow-ups, visit update, daily email report, error alerts, Dashboard, staff training | ₹10,000 – ₹15,000 | optional ₹1,000 – ₹2,000 maintenance |
| **Core Plus** | Core + booking confirmation on WhatsApp + same-day reminder + report on WhatsApp + Razorpay advance fee | + ₹5,000 – ₹8,000 | — |
| **AI Receptionist add-on** | WhatsApp assistant that books/checks/cancels, human handoff | + ₹15,000 – ₹25,000 | ₹2,000 – ₹4,000 (monitoring, prompt tuning) |

**Running costs are paid by the clinic directly** (n8n plan or server, WhatsApp per-message charges, AI API usage,
Razorpay fees). Example WhatsApp cost in India (2026, utility ≈ ₹0.115/msg + GST): ~750 reminders/month ≈ ₹86.
Check Meta's current rate card before quoting.

Maintenance retainer covers: new doctors/timings/holidays, template changes, monitoring error emails, small tweaks.
With this kit those are config edits + `npm run deploy`, so the retainer is mostly margin — price it on value.

## Proposal template

```
Clinic Automation — Proposal
Client: [Clinic / Doctor name]

Scope
 1. Appointment booking form for reception, saved to the clinic's Google Sheet, with automatic double-booking check
 2. WhatsApp reminder to patients the evening before their appointment (approved template)
 3. WhatsApp reminder one day before the follow-up date the doctor sets
 4. Visit update form: status, payment, follow-up date
 5. Daily report to the doctor by email: appointments, no-shows, collection, pending payments, tomorrow
 6. Failure alerts to us; Dashboard tab with today's list
 [Add-ons chosen: ...]

Not included: medical records, prescriptions, billing software, website, mobile app, anything not listed above.

Setup fee: ₹[amount], one time — 50% to start, 50% at go-live
Delivery: [X] working days after the clinic's WhatsApp Business verification and template approval
Clinic provides: WhatsApp Business verification, list of doctors & timings, a test number, staff time for 30-min training,
                 a privacy notice for patients
Running costs: paid by the clinic on its own accounts (n8n, WhatsApp messages[, AI usage])
Support: free bug fixes for [X] days after go-live; optional maintenance ₹[amount]/month
Data: all accounts and patient data stay in the clinic's name. No medical information is stored.
```

## Honest expectations (say these up front)

- Meta verification and template approval take days and are outside your control.
- The system only works if reception fills the booking and visit-update forms. The report's "Not updated" number shows if they don't.
- Results vary; show the Dashboard numbers after the first month instead of promising percentages.
- Start with 1–2 clinics, refine your process, then scale. India's DPDP Act 2023 applies to patient data — the clinic should get its privacy notice and consent wording checked by a lawyer.
