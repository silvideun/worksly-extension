/* Cloudflare Worker для приёма обратной связи из расширения.
   Переменные окружения: BOT_TOKEN, CHAT_ID, KV: REPORT_KV */

const MAX_BODY_CHARS = 4000;
const MAX_TEXT = 1000;
const MAX_CONTACT = 120;
const MAX_SERVICE = 32;
const MAX_VERSION = 20;
const HOURLY_LIMIT = 20;
const TELEGRAM_TIMEOUT_MS = 8000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

function reply(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS }
  });
}

function clean(value, limit) {
  if (typeof value !== 'string') return '';
  let out = '';
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    out += (code < 32 && code !== 10) || code === 127 ? ' ' : ch;
  }
  return out.trim().slice(0, limit);
}

async function overLimit(env) {
  if (!env.REPORT_KV) return false;

  const key = `report-count:${new Date().toISOString().slice(0, 13)}`;
  try {
    const used = Number(await env.REPORT_KV.get(key)) || 0;
    if (used >= HOURLY_LIMIT) return true;
    await env.REPORT_KV.put(key, String(used + 1), { expirationTtl: 7200 });
    return false;
  } catch (err) {
    console.error('report: KV недоступен', err);
    return true;
  }
}

async function sendTelegram(env, text) {
  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: env.CHAT_ID,
      text,
      disable_web_page_preview: true
    }),
    signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS)
  }).catch(() => null);

  return !!res?.ok;
}

function buildMessage({ text, service, contact, version }) {
  const lines = ['Worksly: обратная связь', ''];
  lines.push(`Сервис: ${service || 'не указан'}`);
  lines.push(`Контакт: ${contact || 'не оставлен'}`);
  if (version) lines.push(`Версия: ${version}`);
  lines.push('', text);
  return lines.join('\n');
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method !== 'POST') {
      return reply(405, { error: 'method_not_allowed' });
    }
    if (!env.BOT_TOKEN || !env.CHAT_ID) {
      console.error('report: не настроены BOT_TOKEN / CHAT_ID');
      return reply(500, { error: 'not_configured' });
    }

    const declared = Number(request.headers.get('Content-Length'));
    if (declared > MAX_BODY_CHARS * 4) return reply(413, { error: 'too_large' });

    const raw = await request.text();
    if (raw.length > MAX_BODY_CHARS) return reply(413, { error: 'too_large' });

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return reply(400, { error: 'bad_json' });
    }

    const text = clean(data?.text, MAX_TEXT);
    if (!text) return reply(400, { error: 'empty_text' });

    const message = buildMessage({
      text,
      service: clean(data?.service, MAX_SERVICE),
      contact: clean(data?.contact, MAX_CONTACT),
      version: clean(data?.version, MAX_VERSION)
    });

    if (await overLimit(env)) return reply(429, { error: 'rate_limited' });

    if (!await sendTelegram(env, message)) {
      console.error('report: Telegram не принял сообщение');
      return reply(502, { error: 'send_failed' });
    }

    return reply(200, { ok: true });
  }
};
