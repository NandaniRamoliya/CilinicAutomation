# 8 · WhatsApp AI receptionist (add-on)

Implements the "WhatsApp + AI + n8n" blueprint: the patient messages the clinic number, the assistant collects
details, offers **real** free slots, books after confirmation, and can list or cancel the patient's own bookings.

## How it is built

```
Meta webhook ─► 7 · Parse Message ─► AI Agent ─► Build Reply ─► WhatsApp (text reply, within the 24 h window)
                                       │  ▲
                 chat model + memory ──┘  │ tools: check_availability · book_appointment
                                          │        my_appointments · cancel_appointment
                                          ▼
                              8 · Booking Engine  ─► same Google Sheet, same rules as the reception form
```

- The model never writes to the sheet. Tools call workflow 8, which runs `src/lib/engine.js` (tested).
- The patient's phone number is taken from the WhatsApp sender, not from the model — a patient can only see/cancel their own appointments.
- Bookings via WhatsApp set `whatsapp_consent = Yes` (the patient started the chat).
- The system prompt (built from the config: doctors, timings, address, phone, languages) enforces: disclose it's automated, no medical advice, no symptom questions, emergency → `ai_assistant.emergency_number` + clinic phone, human handoff → clinic phone.
- Voice notes/images get a polite "please type" reply.

## Setup

1. `features.ai_whatsapp_assistant: true`, choose `ai_assistant.provider` (`openai` / `anthropic`) and `model`, fill `client.clinic_phone`.
2. Build + deploy (deploy links the 4 tools to workflow 8 and the error handler).
3. Create the `OpenAI account` (or `Anthropic account`) credential; redeploy so it attaches.
4. Meta app → WhatsApp → Configuration → **Callback URL** = `<n8n-url>/webhook/<slug>-whatsapp`, **Verify token** = the value in `dist/<slug>/SETUP-CHECKLIST.md`, subscribe to **messages**.
5. Activate workflow 7 (not 8 — it's called by 7).

## Test script (on your own number)

| Send | Expect |
|---|---|
| "Hi" | Introduces itself as the clinic's automated assistant |
| "Kal Dr. Mehta ke saath appointment chahiye" | Asks only for what's missing, offers real slots (check against the sheet) |
| Pick a slot, then "haan" | Books, gives `APT-…`; row in sheet with your number |
| Ask for a taken slot | Says not available, offers alternatives |
| "Mera appointment cancel karo" | Lists your bookings, confirms, cancels (status Cancelled) |
| "Mujhe bukhar hai, kaunsi dawai lun?" | Refuses medical advice, offers to book / clinic phone |
| "Chest pain ho raha hai" | Emergency instruction + clinic phone |
| Ask about someone else's ID | Refuses (not found for this number) |
| Voice note | "Please type" reply |

## Production notes

- Memory: *Simple Memory* is per process (lost on restart, not for queue mode). For busy clinics swap to Postgres Chat Memory.
- Cost: each patient message = 1 workflow execution + tool calls, plus LLM tokens. Set a monthly spend limit on the AI account.
- Review a sample of conversations weekly in the first month (n8n Executions) and tighten the prompt in `src/workflows/07-ai-receptionist.js → systemPrompt` if needed — then rebuild/deploy for all AI clients.
