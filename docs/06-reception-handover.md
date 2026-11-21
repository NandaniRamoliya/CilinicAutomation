# 6 · Reception guide (print this for the clinic)

Replace `<…>` with the clinic's links before handing over.

## Two bookmarks on the reception computer

| Bookmark | Link | Use it when |
|---|---|---|
| **Book Appointment** | `<n8n-url>/form/<slug>-book` | A patient books (phone call, walk-in, WhatsApp) |
| **Visit Update** | `<n8n-url>/form/<slug>-visit` | A patient leaves, doesn't come, or cancels |

## Booking

1. Name, **patient's WhatsApp number** (10 digits is fine), doctor, date, time, New / Follow-up.
2. WhatsApp Updates: ask *"Can we send you reminders on WhatsApp?"* — choose Yes only if they agree.
3. Click **Book appointment**.
   - ✅ **Appointment booked** — tell the patient the **Appointment ID** (e.g. APT-K7M2QX).
   - ❌ **Not booked** — the page says why (slot taken, doctor off that day, holiday…) and shows free slots. Pick one and book again.

Never type symptoms, illness, medicines or reports anywhere.

## After the visit

1. Open the **Dashboard** tab of the sheet → today's list → copy the Appointment ID.
2. Visit Update form: ID, status (Completed / No-show / Cancelled), amount collected **today**, payment mode,
   follow-up (None / 7 days / …) as the doctor said.
3. The page confirms what was saved, including the follow-up date.

**Cancellation:** Visit Update → status Cancelled. **Reschedule:** cancel the old one, book a new one.
**Free visit:** payment mode Free.

## Good habits

- Fill Visit Update for **every** patient the same day — the doctor's night report shows "Not updated" otherwise.
- Don't edit or delete columns in the sheet, and don't change the header row.
- If a patient asks to stop WhatsApp messages, change their `whatsapp_consent` to `No` in the sheet.
- Something looks wrong? Call `<your name / number>` — we get an automatic alert for most problems.
