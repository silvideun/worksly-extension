const fs = require('fs');
const path = require('path');

const DOMAINS_FILE = path.join(__dirname, 'domains.json');
const STATUS_FILE = path.join(__dirname, 'status.json');
const ENV_FILE = path.join(__dirname, '.env');
const TIMEOUT_MS = 8000;
const RETRY_DELAY_MS = 2000;
const DIGEST_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000;

function loadEnv() {
  const env = {};
  if (fs.existsSync(ENV_FILE)) {
    for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      env[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
    }
  }
  return env;
}

async function attempt(domain) {
  const url = `https://${domain}/`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': 'Mozilla/5.0 (WorkslyChecker/1.0)' }
    });
    return { reachable: true, httpStatus: res.status };
  } catch (err) {
    return { reachable: false, error: err.code || err.name || String(err) };
  }
}

// Повторная попытка для упавшего домена отсекает случайные микросбои сети
async function checkDomain(domain) {
  const first = await attempt(domain);
  if (first.reachable) return first;

  await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
  const second = await attempt(domain);
  if (second.reachable) {
    console.log(`  ${domain}: первая попытка не прошла (${first.error}), вторая успешна`);
  }
  return second;
}

// Уровни: open (200-399), refused (403/429 от сервиса), silent (таймаут/сеть)
function levelOf(data) {
  if (!data.reachable) return 'silent';
  return data.httpStatus >= 200 && data.httpStatus < 400 ? 'open' : 'refused';
}

function describeLevel(data) {
  const level = levelOf(data);
  if (level === 'silent') return 'нет ответа';
  if (level === 'open') return `сайт открывается (${data.httpStatus})`;
  return `сервер отказывает (${data.httpStatus})`;
}

// Человеческое описание уровня для истории изменений
function describePastLevel(level) {
  if (level === 'silent') return 'ответа не было';
  if (level === 'open') return 'сайт открывался';
  return 'сервер отказывал';
}

// Отправка алерта в Telegram через Cloudflare Worker-релей при подтвержденной смене статуса
async function notifyChanges(env, changes) {
  if (!changes.length || !env.RELAY_URL || !env.RELAY_SECRET) return;

  const lines = changes.map(c => `${c.id}: ${c.from} → ${c.to}`);

  // Особое предупреждение, если сервис снова открылся для РФ
  const opened = changes.filter(c => c.opened).map(c => c.id);
  if (opened.length) {
    lines.push('');
    lines.push(`Похоже, для РФ открылся: ${opened.join(', ')}. Проверьте руками и обновите данные.`);
  }

  try {
    await fetch(env.RELAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Relay-Secret': env.RELAY_SECRET },
      body: JSON.stringify({ text: `Worksly: изменения доступности\n${lines.join('\n')}` }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch (err) {
    console.error('notify failed:', err);
  }
}

// Регулярная сводка статусов раз в 3 дня
async function sendDigest(env, services, digestLevels) {
  if (!env.RELAY_URL || !env.RELAY_SECRET) return false;

  const lines = Object.entries(services).map(([id, data]) => {
    const level = levelOf(data);
    const before = digestLevels[id];
    const changed = before && before !== level;
    return `${id}: ${describeLevel(data)}${changed ? '  ← изменилось' : ''}`;
  });

  try {
    const res = await fetch(env.RELAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Relay-Secret': env.RELAY_SECRET },
      body: JSON.stringify({ text: `Worksly: сводка\n\n${lines.join('\n')}` }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!res.ok) {
      console.error('digest failed: HTTP', res.status);
      return false;
    }
    return true;
  } catch (err) {
    console.error('digest failed:', err);
    return false;
  }
}

// Сигнал жизни сервера для мониторинга Cronitor (Dead man's switch)
async function pingCronitor(env, state) {
  if (!env.CRONITOR_URL) return;
  try {
    await fetch(`${env.CRONITOR_URL}?state=${state}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    console.error('cronitor ping failed:', err);
  }
}

// Публикация status.json в Cloudflare Worker (HTTPS-прокси для расширений)
async function pushStatus(env, status) {
  if (!env.PUSH_URL || !env.PUSH_SECRET) return;
  try {
    const res = await fetch(env.PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Push-Secret': env.PUSH_SECRET },
      body: JSON.stringify(status),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!res.ok) console.error('push failed: HTTP', res.status);
  } catch (err) {
    console.error('push failed:', err);
  }
}

async function main() {
  const env = loadEnv();
  await pingCronitor(env, 'run');

  const domains = JSON.parse(fs.readFileSync(DOMAINS_FILE, 'utf8'));
  const now = new Date().toISOString();

  let prevStatus = {};
  if (fs.existsSync(STATUS_FILE)) {
    try { prevStatus = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8')); } catch {}
  }
  const previous = prevStatus.services || {};

  const results = await Promise.all(
    domains.map(async (d) => {
      const result = await checkDomain(d.domain);
      return [d.id, { ...result, domain: d.domain, checkedAt: now }];
    })
  );

  const services = Object.fromEntries(results);

  // Антидребезг: алерт уходит, только если новое состояние подтвердилось 2 прогона подряд
  const changes = [];
  for (const [id, data] of Object.entries(services)) {
    const before = previous[id];
    const level = levelOf(data);

    // Первый запуск для сервиса: запоминаем как есть, не уведомляем
    if (!before) {
      data.notifiedLevel = level;
      continue;
    }

    const lastNotified = before.notifiedLevel ?? levelOf(before);
    const stable = levelOf(before) === level;

    if (!stable || level === lastNotified) {
      data.notifiedLevel = lastNotified;
      continue;
    }

    changes.push({
      id,
      from: describePastLevel(lastNotified),
      to: describeLevel(data),
      opened: lastNotified === 'refused' && level === 'open'
    });
    data.notifiedLevel = level;
  }

  // Уровни на момент прошлой сводки
  const digestLevels = {};
  for (const [id, data] of Object.entries(services)) {
    digestLevels[id] = previous[id]?.digestLevel ?? levelOf(data);
  }

  const lastDigestAt = prevStatus.lastDigestAt;
  const digestDue = lastDigestAt
    ? Date.parse(now) - Date.parse(lastDigestAt) >= DIGEST_INTERVAL_MS
    : false;

  const status = { generatedAt: now, lastDigestAt: lastDigestAt ?? now, services };
  console.log(`[${now}] checked ${domains.length} domains${changes.length ? `, ${changes.length} changed` : ''}`);

  await pushStatus(env, status);
  await notifyChanges(env, changes);

  if (digestDue && await sendDigest(env, services, digestLevels)) {
    status.lastDigestAt = now;
    for (const [id, data] of Object.entries(services)) data.digestLevel = levelOf(data);
    console.log(`  сводка отправлена`);
  } else {
    for (const [id, data] of Object.entries(services)) data.digestLevel = digestLevels[id];
  }

  fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2));
  await pingCronitor(env, 'complete');
}

main().catch(async (err) => {
  console.error('checker failed:', err);
  await pingCronitor(loadEnv(), 'fail');
  process.exit(1);
});
