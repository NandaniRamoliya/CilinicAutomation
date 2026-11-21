# 7 · Troubleshooting

| Problem | Likely cause | Fix |
|---|---|---|
| Error email: *"Sheet with name … not found"* | Tab renamed | Rename back to `Appointments` (or change `google.appointments_tab` and redeploy) |
| Error email about Google auth / `invalid_grant` | OAuth token expired (Google Cloud app in Testing mode = 7-day tokens) | Reconnect the credential; publish the Google Cloud app |
| Reminder failure email: *"(#131030) Recipient phone number not in allowed list"* | Still using Meta's test number | Move to the clinic's real number with a permanent token |
| *"(#132000) Number of parameters does not match"* / *"invalid parameter"* | Template variables ≠ `params` in config | Make `whatsapp.templates.<key>.params` match the approved template's `{{1}}…{{n}}` order, deploy |
| *"(#132001) Template name does not exist in the translation"* | Wrong template name or language code | Check name + language (`en`, `hi`, `en_US`…) in WhatsApp Manager |
| 401 from graph.facebook.com | Token expired/revoked | New permanent system-user token in the `WhatsApp Cloud API` credential |
| Reminders not sent at all | Workflow inactive, consent `No`, or reminder already sent today | Activate; check `whatsapp_consent` and `last_reminder_date` |
| Form says doctor/slot invalid but it looks right | Config changed but not redeployed | `npm run deploy -- <slug>` |
| Reception sees `/form-test/…` "waiting" page | Using the Test URL | Use `/form/<slug>-book` (Production URL) and keep the workflow active |
| Dashboard numbers wrong | Date columns not plain text / sheet time zone different | Format E, F, L, N, O as Plain text; File → Settings → time zone |
| Daily report "Not updated" keeps growing | Visit Update form not used | Retrain reception; the number is working as intended |
| `deploy`: *"request/body must NOT have additional properties"* | Older/newer n8n API schema | Report it; meanwhile import the JSON files manually |
| `deploy`: *"This client was deployed to …"* | Deploying to a different instance | Delete `clients/<slug>/.deployed.json` only if you really want a fresh copy there |
| AI replies but never books | Tool nodes not linked to workflow 8 | `npm run deploy` (links automatically) or select "8 · Booking Engine" in the 4 tool nodes |
| AI not replying at all | Webhook not subscribed / workflow inactive | Meta app → WhatsApp → Configuration: callback = Production URL, subscribe `messages`; activate workflow 7 |

Where to look: n8n → **Executions** (filter by workflow, open the failed run, the red node shows the exact error).
