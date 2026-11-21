# 3 · Accounts & credentials

Create every account in the **clinic's** name and add yourself as admin. Prices and limits change —
check the official pages before quoting.

## n8n

- **Cloud** (no server to manage) or **self-hosted Community Edition** (free software, you run the server, backups, updates).
- Set the timezone: Cloud → Admin panel; self-hosted → `GENERIC_TIMEZONE=Asia/Kolkata`. Workflows also carry their own timezone from the config.
- API key for `npm run deploy`: *Settings → n8n API → Create an API key*. Treat it like a password; delete it after handover if you won't maintain the system.
- Size the plan with the execution budget in `01-architecture.md`.

## Google Sheets + Gmail (OAuth2)

In n8n: *Credentials → New → Google Sheets OAuth2 API* (name `Google Sheets (clinic)`) and *Gmail OAuth2*
(name `Gmail (alerts)`). On n8n Cloud, "Sign in with Google" works out of the box. Self-hosted needs your own Google
Cloud OAuth client (enable Sheets API + Gmail API, add the n8n OAuth callback URL shown in the credential screen).
If the Google Cloud app stays in "Testing" mode, refresh tokens expire every 7 days — publish it or expect the
error handler to email you weekly.

## WhatsApp Business Platform (Cloud API)

1. Meta Business Manager → create/verify the business.
2. developers.facebook.com → create an app (type Business) → add **WhatsApp** → add the clinic's **dedicated** number (it can't stay on the WhatsApp phone app).
3. Copy the **Phone number ID** → `whatsapp.phone_number_id`.
4. Business settings → System users → create one, assign the app + WhatsApp account, generate a **permanent token** with `whatsapp_business_messaging` (+ `whatsapp_business_management`). The 24-hour test token will break reminders the next day.
5. n8n credential *Header Auth*, name `WhatsApp Cloud API`: Name `Authorization`, Value `Bearer <token>`.
6. Submit templates from `dist/<slug>/whatsapp-templates.md` as **Utility**. No offers/discounts (→ Marketing pricing), no medical words.
7. Add a payment method in WhatsApp Manager — business-initiated template messages are charged per delivered message.

Using a BSP (AiSensy, Interakt, Gupshup…) instead? Their APIs differ. Add a payload builder in
`src/lib/whatsapp.js` and adapt `whatsappSend` in `src/workflows/_nodes.js` (see the developer guide).
Avoid unofficial "WhatsApp Web" wrappers — numbers get banned and patient data passes through unknown tools.

## Razorpay (optional advance fee)

Webhook URL = Production URL of workflow 6, event `payment_link.paid`, set a secret, paste the same secret into the
*HMAC Signature* node. Create Payment Links with `reference_id = appointment_id`. Test in test mode first.

## OpenAI / Anthropic (optional AI receptionist)

Create an API key in the clinic's account with a monthly spend limit. n8n credential *OpenAI* or *Anthropic*;
set `ai_assistant.provider` and `ai_assistant.model` in the config. A small, fast model is enough — the engine does
the hard part.
