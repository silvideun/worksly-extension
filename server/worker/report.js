/* Воркер приёма жалоб из расширения (кнопка «Сообщить об ошибке» в попапе).
   Источник правды для кода, который залит в Cloudflare как воркер `worksly-report`.

   Путь сообщения: расширение → этот воркер → Telegram, напрямую.
   Релей `worksly-relay` тут НЕ нужен: он существует потому, что VPS стоит в РФ и не может
   достучаться до api.telegram.org, а воркер и так вне РФ. Лишнее звено только добавило бы
   точку отказа.

   Отдельный воркер, а НЕ маршрут в `worksly-status`: статус читают все пользователи,
   и ошибка в приёме жалоб не должна ронять раздачу статусов. По той же причине у жалоб
   свой бот: поток жалоб не должен топить редкие алерты мониторинга, и наоборот.

   Настройка на стороне Cloudflare (всё через дашборд, wrangler не нужен):
   - `BOT_TOKEN` - токен отдельного бота под жалобы (завести у @BotFather);
   - `CHAT_ID` - тот же numeric id, что у статусного бота: в личной переписке это ваш
     собственный id. ⚠️ Новому боту надо один раз нажать Start, иначе писать вам он не сможет;
   - KV-хранилище привязать как `REPORT_KV` (без него ограничения не будет, см. overLimit);
   - ⚠️ добавление переменных создаёт НОВУЮ версию воркера, но трафик на неё сам не
     переключается: зайти в Deployments и промоутнуть версию. Та же грабля, что с релеем
     (docs/server.md). Симптом - воркер отвечает как будто настроек нет. */

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

// Управляющие символы ломают вид сообщения в Telegram. Код 10 - перевод строки, его оставляем.
function clean(value, limit) {
  if (typeof value !== 'string') return '';
  let out = '';
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    out += (code < 32 && code !== 10) || code === 127 ? ' ' : ch;
  }
  return out.trim().slice(0, limit);
}

/* Ограничение стоит на ИСХОДЯЩИХ сообщениях, а не на входящих запросах: счётчик трогаем
   только когда жалоба уже принята. Так поток мусора не тратит записи KV, а телеграм
   защищён от потока в любом случае.

   Про расход: 20 в час = максимум 480 записей в сутки. Лимит бесплатного тарифа - 1000 на
   весь аккаунт, и оттуда же пишет чекер (12 в сутки). Запас есть, но лимит общий - поэтому
   счётчик и ограничен: иначе поток жалоб мог бы съесть бюджет и сломать раздачу статуса.

   Счётчик неточный - между чтением и записью может проскочить параллельный запрос. Для
   грубого потолка это неважно, точность тут не нужна. */
async function overLimit(env) {
  if (!env.REPORT_KV) return false;   // хранилище не привязано - ограничения нет

  const key = `report-count:${new Date().toISOString().slice(0, 13)}`;
  try {
    const used = Number(await env.REPORT_KV.get(key)) || 0;
    if (used >= HOURLY_LIMIT) return true;
    await env.REPORT_KV.put(key, String(used + 1), { expirationTtl: 7200 });
    return false;
  } catch (err) {
    // при сбое хранилища лучше отказать в отправке, чем остаться совсем без ограничения
    console.error('report: KV недоступен', err);
    return true;
  }
}

/* Шлём обычным текстом, без parse_mode: в сообщении лежит текст пользователя, и любая
   разметка означала бы, что он может её сломать или подделать оформление. */
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
  const lines = ['Worksly: жалоба из расширения', ''];
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

    /* id сервиса не сверяем со списком специально: список живёт в services.js, и сверка
       здесь означала бы ЧЕТВЁРТОЕ место, где id надо держать синхронно. Хватает
       ограничения длины и чистки - мусор в сообщение не попадёт. */
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
