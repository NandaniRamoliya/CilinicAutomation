// ---------------------------------------------------------------------------
// phone.js — WhatsApp number cleanup. Output: digits only, with country code,
// no "+" or spaces (e.g. 919876543210) — the format the WhatsApp API expects.
// ---------------------------------------------------------------------------

function normalizePhone(raw, countryCode, localLength) {
  const cc = String(countryCode || '91');
  const len = Number(localLength || 10);
  let d = String(raw === undefined || raw === null ? '' : raw).replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2); // 0091... international prefix
  if (d.length === len + 1 && d.startsWith('0')) d = d.slice(1); // 09876543210 trunk prefix
  if (d.length === len) d = cc + d;
  return d;
}

/**
 * A number is valid when it is 8-15 digits (E.164) and, if it uses the clinic's
 * own country code, has exactly the local length after it.
 */
function isValidPhone(phone, countryCode, localLength) {
  const cc = String(countryCode || '91');
  const len = Number(localLength || 10);
  if (!/^\d{8,15}$/.test(phone)) return false;
  if (phone.startsWith(cc) && phone.length !== cc.length + len) return false;
  if (!phone.startsWith(cc) && phone.length <= len) return false;
  return true;
}

/** 919876543210 -> 98xxxxx210 — for alerts/emails so full numbers don't leak. */
function maskPhone(phone) {
  const s = String(phone || '');
  if (s.length < 6) return s;
  return s.slice(-10, -8) + 'xxxxx' + s.slice(-3);
}

/* n8n:strip-start */
module.exports = { normalizePhone, isValidPhone, maskPhone };
/* n8n:strip-end */
