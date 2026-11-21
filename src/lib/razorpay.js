// ---------------------------------------------------------------------------
// razorpay.js — optional online advance fee via Razorpay Payment Links.
// Create each Payment Link with reference_id = appointment_id. When Razorpay
// sends "payment_link.paid", we mark that row Paid. The signature itself is
// verified with n8n's Crypto node (HMAC-SHA256 of the raw body).
// ---------------------------------------------------------------------------

function parsePaymentLinkPaid(body) {
  const b = body || {};
  if (b.event !== 'payment_link.paid') return { relevant: false, reason: 'Ignored event ' + (b.event || '(none)') };
  const p = b.payload || {};
  const link = (p.payment_link && p.payment_link.entity) || {};
  const pay = (p.payment && p.payment.entity) || {};
  const ref = String(link.reference_id || '').trim().toUpperCase();
  if (!ref) return { relevant: false, reason: 'Payment link has no reference_id' };
  const paise = Number(pay.amount || link.amount_paid || link.amount || 0);
  return {
    relevant: true,
    appointment_id: ref,
    amount: Math.round(paise) / 100,
    method: pay.method || 'online',
    payment_id: pay.id || '',
  };
}

/** Constant-time-ish comparison of two hex strings. */
function safeEqualHex(a, b) {
  const x = String(a || '');
  const y = String(b || '');
  if (!x || x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

/* n8n:strip-start */
module.exports = { parsePaymentLinkPaid, safeEqualHex };
/* n8n:strip-end */
