// Workflows 7 + 8 (optional add-on) — WhatsApp AI receptionist.
//   7 · WhatsApp AI Receptionist : Meta webhook -> AI agent -> WhatsApp reply
//   8 · Booking Engine (AI tools): deterministic availability/book/cancel on the SAME sheet,
//                                  using the SAME rules as the reception form.
// The AI only talks; every read/write goes through workflow 8.
const { N, connector, workflow, stableId } = require('./_nodes');
const { doctorSchedule, doctorNames } = require('../lib/schedule');

const ENGINE_INPUTS = ['action', 'doctor', 'date', 'time', 'patient_name', 'visit_type', 'appointment_id', 'phone'];

function systemPrompt(c) {
  const tz = c.locale.timezone;
  const doctors = doctorNames(c).map((name) => {
    const s = doctorSchedule(c, name);
    const closed = s.closed_weekdays.length ? '; not available on ' + s.closed_weekdays.join(', ') : '';
    return '- ' + name + ': ' + s.sessions.map((x) => x.start + '-' + x.end).join(' and ') + closed;
  }).join('\n');
  const a = c.ai_assistant;
  return '=' + [
    'You are the WhatsApp appointment assistant of ' + c.client.clinic_name + (c.client.city ? ', ' + c.client.city : '') + '.',
    'You are an automated assistant, not a human. Say so in your first reply of a conversation.',
    'Today is {{ $now.setZone(\'' + tz + '\').toFormat(\'cccc, d LLLL yyyy\') }} (ISO {{ $now.setZone(\'' + tz + '\').toFormat(\'yyyy-MM-dd\') }}), time now {{ $now.setZone(\'' + tz + '\').toFormat(\'HH:mm\') }}.',
    '',
    'CLINIC',
    'Address: ' + (c.client.clinic_address || 'ask the clinic'),
    'Phone (human staff): ' + (c.client.clinic_phone || 'ask the clinic'),
    'Doctors and timings:',
    doctors,
    'Visit types: ' + c.visit_types.join(', ') + '. Bookings open up to ' + c.schedule.max_days_ahead + ' days ahead.',
    a.extra_clinic_info ? 'Other info: ' + a.extra_clinic_info : '',
    '',
    'WHAT YOU DO: book, show, cancel or reschedule appointments. Nothing else.',
    '1. To book you need: patient name, doctor, date, time, visit type (New / Follow-up). Ask only for what is missing.',
    '2. ALWAYS call check_availability before suggesting times. Never invent or guess free slots.',
    '3. Repeat the chosen doctor, date and time and get a clear "yes" before calling book_appointment.',
    '4. Tool inputs: dates as YYYY-MM-DD, times as HH:MM 24-hour, doctor names exactly as listed above.',
    '5. After booking, give the appointment ID. If the tool says NOT BOOKED, explain and offer the free slots it returned.',
    '6. Reschedule = book the new slot first, then cancel the old ID (confirm both with the patient).',
    '7. The booking is always linked to this WhatsApp number. A patient can book for a family member by giving that person\'s name.',
    '',
    'SAFETY',
    '- Never diagnose, suggest medicines, interpret reports or give medical advice. Say the doctor will help at the visit.',
    '- Do NOT ask about symptoms or illness. Do not store or repeat medical details.',
    '- Emergency signs (chest pain, breathing trouble, heavy bleeding, unconsciousness, etc.): tell them to call ' + (a.emergency_number || '112') + ' or go to the nearest hospital immediately, and give the clinic phone.',
    '- If the patient asks for a human, is upset, or asks something you cannot do: give the clinic phone number ' + (c.client.clinic_phone || '') + '.',
    '',
    'STYLE: short WhatsApp-style messages, no markdown tables. Reply in the patient\'s language (' + (a.languages || 'English, Hindi, Hinglish') + ').',
  ].filter((l) => l !== '').join('\n');
}

function engineTool(ctx, name, position, action, description, aiFields) {
  const value = { action };
  const schema = [];
  for (const k of ENGINE_INPUTS) {
    if (k === 'action') value.action = action;
    else if (k === 'phone') value.phone = "={{ $('Parse Message').first().json.from }}";
    else if (aiFields[k]) value[k] = "={{ $fromAI('" + k + "', `" + aiFields[k] + "`, 'string') }}";
    else value[k] = '';
    schema.push({ id: k, displayName: k, required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string', removed: false });
  }
  return N.node(ctx, name, '@n8n/n8n-nodes-langchain.toolWorkflow', 2.1, position, {
    name,
    description,
    workflowId: { __rl: true, value: ctx.engineWorkflowId || '', mode: 'id' },
    workflowInputs: { mappingMode: 'defineBelow', value, matchingColumns: [], schema, attemptToConvertTypes: false, convertFieldsToString: false },
  });
}

function chatModel(ctx, position) {
  const a = ctx.config.ai_assistant;
  if (a.provider === 'anthropic') {
    return N.node(ctx, 'Chat Model', '@n8n/n8n-nodes-langchain.lmChatAnthropic', 1.3, position, {
      model: { __rl: true, mode: 'id', value: a.model },
      options: { temperature: 0.2, maxTokensToSample: 800 },
    }, { credentials: { anthropicApi: { id: '', name: 'Anthropic account' } } });
  }
  return N.node(ctx, 'Chat Model', '@n8n/n8n-nodes-langchain.lmChatOpenAi', 1.2, position, {
    model: { __rl: true, mode: 'id', value: a.model },
    options: { temperature: 0.2, maxTokens: 800 },
  }, { credentials: { openAiApi: { id: '', name: 'OpenAI account' } } });
}

const receptionist = {
  key: 'ai_receptionist',
  file: '07-whatsapp-ai-receptionist.json',
  enabled: (c) => c.features.ai_whatsapp_assistant && c.whatsapp.enabled,
  dependsOn: 'booking_engine',
  build(ctx) {
    const c = ctx.config;
    const a = c.ai_assistant;
    const { connections, link } = connector();
    const path = c.client.slug + '-whatsapp';
    const nodes = [
      N.sticky(ctx, 'About', [-300, -420], [
        '## 7 · WhatsApp AI Receptionist (add-on)',
        'Meta App → WhatsApp → Configuration → Callback URL = **Production URL** of *Meta Webhook (POST)*,',
        'Verify token = `' + a.verify_token + '`, subscribe to **messages**.',
        'Tools call workflow **8 · Booking Engine** — select it in the 4 tool nodes if not set by `npm run deploy`.',
        'Memory is per WhatsApp number (last ' + a.memory_messages + ' messages).',
      ].join('\n'), { width: 640, height: 200 }),
      N.node(ctx, 'Meta Verify (GET)', 'n8n-nodes-base.webhook', 2, [-240, -120], {
        httpMethod: 'GET', path, responseMode: 'responseNode', options: {},
      }, { webhookId: stableId(c.client.slug, ctx.workflowKey, 'verify', 'webhook') }),
      N.code(ctx, 'Check Token', [-20, -120], [], `
const q = $input.first().json.query || {};
const ok = q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === ${JSON.stringify(a.verify_token)};
return [{ json: { ok, challenge: ok ? String(q['hub.challenge'] || '') : 'forbidden' } }];
`),
      N.node(ctx, 'Reply Challenge', 'n8n-nodes-base.respondToWebhook', 1.1, [200, -120], {
        respondWith: 'text',
        responseBody: '={{ $json.challenge }}',
        options: { responseCode: '={{ $json.ok ? 200 : 403 }}' },
      }),
      N.node(ctx, 'Meta Webhook (POST)', 'n8n-nodes-base.webhook', 2, [-240, 140], {
        httpMethod: 'POST', path, options: {},
      }, { webhookId: stableId(c.client.slug, ctx.workflowKey, 'incoming', 'webhook') }),
      N.code(ctx, 'Parse Message', [-20, 140], ['engine'], `
// One message per run (WhatsApp sends one per webhook in practice). Status updates are ignored.
const msgs = parseIncomingWhatsApp($input.first().json.body);
if (!msgs.length) return [];
return [{ json: msgs[0] }];
`),
      N.ifTrue(ctx, 'Is Text?', [200, 140], "={{ !!$json.text }}"),
      N.node(ctx, 'AI Receptionist', '@n8n/n8n-nodes-langchain.agent', 1.7, [460, 60], {
        promptType: 'define',
        text: '={{ $json.text }}',
        options: { systemMessage: systemPrompt(c), maxIterations: 8 },
      }),
      chatModel(ctx, [300, 340]),
      N.node(ctx, 'Memory', '@n8n/n8n-nodes-langchain.memoryBufferWindow', 1.3, [440, 340], {
        sessionIdType: 'customKey',
        sessionKey: "={{ $('Parse Message').first().json.from }}",
        contextWindowLength: a.memory_messages,
      }),
      engineTool(ctx, 'check_availability', [580, 340], 'availability',
        'Free appointment slots. Give doctor (optional, exact name) and date (optional, YYYY-MM-DD). Without a date it returns the next open days.',
        { doctor: 'Exact doctor name from the list, or empty for all doctors', date: 'Date YYYY-MM-DD, or empty for the next available days' }),
      engineTool(ctx, 'book_appointment', [720, 340], 'book',
        'Book ONE appointment after the patient confirmed doctor, date and time. Returns BOOKED with the ID, or NOT BOOKED with the reason.',
        { doctor: 'Exact doctor name', date: 'Date YYYY-MM-DD', time: 'Time HH:MM 24-hour, must be a slot returned by check_availability', patient_name: 'Full name of the patient', visit_type: 'New or Follow-up' }),
      engineTool(ctx, 'my_appointments', [860, 340], 'my_appointments',
        'List this WhatsApp number\'s upcoming appointments with their IDs.', {}),
      engineTool(ctx, 'cancel_appointment', [1000, 340], 'cancel',
        'Cancel one of this number\'s upcoming appointments by ID (APT-XXXXXX), only after the patient confirms.',
        { appointment_id: 'Appointment ID like APT-ABC123' }),
      N.code(ctx, 'Build Reply', [820, 60], ['whatsapp'], `
const to = $('Parse Message').first().json.from;
const text = String($input.first().json.output || '').trim() ||
  'Sorry, something went wrong. Please call ' + CONFIG.client.clinic_phone + '.';
return [{ json: { wa_payload: buildTextPayload(to, text) } }];
`),
      N.code(ctx, 'Unsupported Reply', [460, 240], ['whatsapp'], `
const m = $('Parse Message').first().json;
return [{ json: { wa_payload: buildTextPayload(m.from,
  'Sorry, I can only read text messages. Please type your request (e.g. "appointment with ' +
  ${JSON.stringify(doctorNames(c)[0] || 'the doctor')} + ' tomorrow"), or call ' + CONFIG.client.clinic_phone + '.') } }];
`),
      N.whatsappSend(ctx, 'Send Reply', [1040, 140]),
    ];
    link('Meta Verify (GET)', 'Check Token');
    link('Check Token', 'Reply Challenge');
    link('Meta Webhook (POST)', 'Parse Message');
    link('Parse Message', 'Is Text?');
    link('Is Text?', 'AI Receptionist', 0);
    link('Is Text?', 'Unsupported Reply', 1);
    link('AI Receptionist', 'Build Reply');
    link('Build Reply', 'Send Reply');
    link('Unsupported Reply', 'Send Reply');
    link('Chat Model', 'AI Receptionist', 0, 'ai_languageModel');
    link('Memory', 'AI Receptionist', 0, 'ai_memory');
    for (const t of ['check_availability', 'book_appointment', 'my_appointments', 'cancel_appointment']) {
      link(t, 'AI Receptionist', 0, 'ai_tool');
    }
    return workflow(ctx, c.client.short_name + ' · 7 · WhatsApp AI Receptionist', nodes, connections);
  },
};

const engine = {
  key: 'booking_engine',
  file: '08-booking-engine-ai-tools.json',
  enabled: (c) => c.features.ai_whatsapp_assistant && c.whatsapp.enabled,
  build(ctx) {
    const c = ctx.config;
    const { connections, link } = connector();
    const nodes = [
      N.sticky(ctx, 'About', [-260, -300], [
        '## 8 · Booking Engine (called by the AI)',
        'Do not activate or trigger manually — workflow 7 calls it.',
        'Actions: availability · book · my_appointments · cancel. Same validation + double-booking',
        'rules as the reception form. `phone` always comes from the WhatsApp sender.',
      ].join('\n'), { width: 560, height: 180 }),
      N.node(ctx, 'When Called By AI', 'n8n-nodes-base.executeWorkflowTrigger', 1.1, [-200, 0], {
        inputSource: 'workflowInputs',
        workflowInputs: { values: ENGINE_INPUTS.map((name) => ({ name, type: 'string' })) },
      }),
      N.sheetsReadAll(ctx, 'Read Appointments', [20, 0]),
      N.code(ctx, 'Engine', [240, 0], ['dates', 'phone', 'schedule', 'sheet', 'booking', 'engine'], `
const args = $('When Called By AI').first().json;
const rows = cleanRows($input.all().map((i) => i.json), CONFIG);
return [{ json: runEngine(args, rows, CONFIG, new Date()) }];
`),
      N.switchOn(ctx, 'Write?', [460, 0], '={{ $json.write }}', ['append', 'update', 'none']),
      N.code(ctx, 'New Row', [680, -160], [], 'return [{ json: $input.first().json.row }];'),
      N.sheetsAppend(ctx, 'Append Booking', [900, -160]),
      N.code(ctx, 'Changed Row', [680, 0], [], 'return [{ json: $input.first().json.row }];'),
      N.sheetsUpdate(ctx, 'Update Booking', [900, 0]),
      N.code(ctx, 'Reply To AI', [1140, 0], [], `
return [{ json: { response: $('Engine').first().json.response } }];
`),
    ];
    link('When Called By AI', 'Read Appointments');
    link('Read Appointments', 'Engine');
    link('Engine', 'Write?');
    link('Write?', 'New Row', 0);
    link('Write?', 'Changed Row', 1);
    link('Write?', 'Reply To AI', 2);
    link('New Row', 'Append Booking');
    link('Changed Row', 'Update Booking');
    link('Append Booking', 'Reply To AI');
    link('Update Booking', 'Reply To AI');
    return workflow(ctx, c.client.short_name + ' · 8 · Booking Engine (AI tools)', nodes, connections);
  },
};

module.exports = [engine, receptionist];
module.exports.systemPrompt = systemPrompt;
