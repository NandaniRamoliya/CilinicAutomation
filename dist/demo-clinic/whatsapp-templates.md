# WhatsApp templates — Sunrise Family Clinic

Create these in **Meta WhatsApp Manager → Message templates** (category **Utility**), wait for approval,
then keep the names exactly as below. The `{{n}}` order must match `params` in client.config.json.

## appointment_reminder_v1  (`appointment_reminder`, language `en`)

Parameters in order: {{1}} = `patient_name`, {{2}} = `doctor`, {{3}} = `display_date`, {{4}} = `display_time`

Suggested body:

```
Hello {{1}}, this is a reminder of your appointment with {{2}} on {{3}} at {{4}}. If you cannot come, please call the clinic to reschedule. Thank you!
```

Sample values for Meta review: Rohit | Dr. Mehta | 18 Nov 2026 | 10:30 AM

## follow_up_reminder_v1  (`follow_up_reminder`, language `en`)

Parameters in order: {{1}} = `patient_name`, {{2}} = `doctor`, {{3}} = `display_date`

Suggested body:

```
Hello {{1}}, {{2}} had asked you to come for a follow-up on {{3}}. Please call the clinic or reply here to book a time. Thank you!
```

Sample values for Meta review: Neha | Dr. Mehta | 2 Dec 2026

## booking_confirmation_v1  (`booking_confirmation`, language `en`)

Parameters in order: {{1}} = `patient_name`, {{2}} = `doctor`, {{3}} = `display_date`, {{4}} = `display_time`, {{5}} = `appointment_id`

Suggested body:

```
Hello {{1}}, your appointment with {{2}} is confirmed for {{3}} at {{4}}. Appointment ID: {{5}}. To cancel or reschedule, please call the clinic.
```

Sample values for Meta review: Rohit | Dr. Mehta | 18 Nov 2026 | 10:30 AM | APT-K7M2QX

## doctor_report_v1  (`doctor_report`, language `en`)

Parameters in order: {{1}} = `date`, {{2}} = `total`, {{3}} = `completed`, {{4}} = `no_show`, {{5}} = `collection`, {{6}} = `pending`, {{7}} = `tomorrow`

Suggested body:

```
Clinic report {{1}}: Appointments {{2}}, Completed {{3}}, No-show {{4}}, Collection Rs {{5}}, Pending payments {{6}}, Tomorrow's appointments {{7}}.
```

Sample values for Meta review: 18 Nov 2026 | 24 | 19 | 3 | 9500 | 2 | 21

