# Google Sheet setup

One spreadsheet per clinic, **owned by the clinic's Google account**. Two tabs.

## Tab 1 — `Appointments` (n8n reads/writes this)

Row 1 must be exactly these 15 headers (copy from `Appointments-header.csv`):

```
appointment_id,patient_name,phone,doctor,appt_date,appt_time,visit_type,status,payment_status,amount_paid,payment_mode,follow_up_date,whatsapp_consent,last_reminder_date,booked_on
```

| Col | Header | Values | Written by |
|---|---|---|---|
| A | appointment_id | `APT-K7M2QX` (no 0/O/1/I, easy to read on phone) | 1 Booking / 8 AI engine |
| B | patient_name | text | 1 / 8 |
| C | phone | `919876543210` — country code, no `+`/spaces | 1 / 8 |
| D | doctor | exactly as in config | 1 / 8 |
| E | appt_date | `YYYY-MM-DD` (plain text) | 1 / 8 |
| F | appt_time | `HH:MM` 24h (plain text) | 1 / 8 |
| G | visit_type | New / Follow-up | 1 / 8 |
| H | status | Booked / Completed / No-show / Cancelled | 1, 3, 8 |
| I | payment_status | Pending / Paid / Free | 1, 3, 6 |
| J | amount_paid | number | 3, 6 |
| K | payment_mode | Cash / UPI / Card / Free / Pending / Online (…) | 3, 6 |
| L | follow_up_date | `YYYY-MM-DD` or blank | 3 |
| M | whatsapp_consent | Yes / No | 1 / 8 |
| N | last_reminder_date | `YYYY-MM-DD` | 2 |
| O | booked_on | `YYYY-MM-DD` | 1 / 8 |

**Select columns E, F, L, N, O → Format → Number → Plain text** before the first booking.
The workflows also write with `RAW` cell format and can read `DD/MM/YYYY` if someone types by hand,
but plain text keeps the Dashboard formulas correct.

**Never add** diagnosis, symptoms, prescriptions, reports, Aadhaar/ID or any medical column.

## Tab 2 — `Dashboard` (formulas only, n8n never touches it)

| Cell label | Formula |
|---|---|
| Today's appointments | `=COUNTIFS(Appointments!E2:E,TEXT(TODAY(),"yyyy-mm-dd"),Appointments!H2:H,"<>Cancelled")` |
| Tomorrow's appointments | `=COUNTIFS(Appointments!E2:E,TEXT(TODAY()+1,"yyyy-mm-dd"),Appointments!H2:H,"Booked")` |
| Today's collection | `=SUMIFS(Appointments!J2:J,Appointments!E2:E,TEXT(TODAY(),"yyyy-mm-dd"),Appointments!I2:I,"Paid")` |
| No-shows this month | `=COUNTIFS(Appointments!H2:H,"No-show",Appointments!E2:E,TEXT(TODAY(),"yyyy-mm")&"*")` |
| Pending payments | `=COUNTIFS(Appointments!H2:H,"Completed",Appointments!I2:I,"Pending")` |
| Not updated (old Booked) | `=COUNTIFS(Appointments!H2:H,"Booked",Appointments!E2:E,"<"&TEXT(TODAY(),"yyyy-mm-dd"))` |

**Today's list for reception** (put in A10; shows ID, name, doctor, time so they can copy the ID into the Visit Update form):

```
=SORT(FILTER({Appointments!A2:A,Appointments!B2:B,Appointments!D2:D,Appointments!F2:F,Appointments!H2:H}, Appointments!E2:E=TEXT(TODAY(),"yyyy-mm-dd")), 4, TRUE)
```

> The "Not updated" formula compares text dates; it works because `YYYY-MM-DD` sorts alphabetically in date order.
> Set the spreadsheet's time zone (File → Settings) to the clinic's time zone so `TODAY()` matches n8n.

## Housekeeping

- Keep one sheet per clinic. When it passes ~20,000 rows (years of data), copy old years to an `Archive` file and delete them here — every workflow reads the whole tab.
- Sharing: clinic owner + reception only. Remove ex-staff immediately.
