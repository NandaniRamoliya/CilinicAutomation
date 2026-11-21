// ---------------------------------------------------------------------------
// whatsapp.js — builds WhatsApp Cloud API (Meta Graph API) request bodies.
// Template parameter ORDER comes from the client config, so every client can
// word their approved templates differently without touching code.
// Depends on: dates.js
// ---------------------------------------------------------------------------
/* n8n:strip-start */
const { displayDate, displayTime } = require('./dates');
/* n8n:strip-end */

/** Every value a template is allowed to use. Keep these free of medical info. */
function templateFields(row, config, extra) {
  const name = String(row.patient_name || '').trim();
  const f = {
    patient_name: name,
    first_name: name.split(' ')[0] || name,
    doctor: row.doctor || '',
    clinic_name: (config.client && config.client.clinic_name) || '',
    clinic_phone: (config.client && config.client.clinic_phone) || '',
    clinic_address: (config.client && config.client.clinic_address) || '',
    appointment_id: row.appointment_id || '',
    appt_date: row.appt_date || '',
    display_date: displayDate(row.appt_date),
    appt_time: row.appt_time || '',
    display_time: displayTime(row.appt_time),
    follow_up_date: row.follow_up_date || '',
    follow_up_display_date: displayDate(row.follow_up_date),
  };
  return Object.assign(f, extra || {});
}

/** Meta rejects params containing newlines, tabs or 4+ consecutive spaces. */
function cleanParam(v) {
  return String(v === undefined || v === null ? '' : v).replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim() || '-';
}

/**
 * tpl: { name, language, params: ['patient_name','doctor','display_date','display_time'] }
 */
function buildTemplatePayload(to, tpl, fields) {
  const params = (tpl.params || []).map((key) => {
    if (!(key in fields)) throw new Error('Template "' + tpl.name + '" uses unknown field "' + key + '"');
    return { type: 'text', text: cleanParam(fields[key]) };
  });
  const template = { name: tpl.name, language: { code: tpl.language || 'en' } };
  if (params.length) template.components = [{ type: 'body', parameters: params }];
  return { messaging_product: 'whatsapp', to: String(to), type: 'template', template };
}

/** Free-form text — only allowed within 24h of the patient's last message. */
function buildTextPayload(to, text) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: String(to),
    type: 'text',
    text: { preview_url: false, body: String(text).slice(0, 4000) },
  };
}

/** Interpret the HTTP Request node's output (works with "Continue on Fail"). */
function parseSendResult(json) {
  if (json && Array.isArray(json.messages) && json.messages[0] && json.messages[0].id) {
    return { ok: true, message_id: json.messages[0].id, error: '' };
  }
  let err = json && json.error;
  if (err && typeof err === 'object') err = err.message || err.description || JSON.stringify(err);
  return { ok: false, message_id: '', error: String(err || 'Unknown WhatsApp API response') };
}

/* n8n:strip-start */
module.exports = { templateFields, cleanParam, buildTemplatePayload, buildTextPayload, parseSendResult };
/* n8n:strip-end */
