// Публикация текстов и плашек из services.js в Cloudflare KV
//
// Использование:
//   node push-editorial.js          — проверка и предпросмотр (dry-run)
//   node push-editorial.js --push   — отправка в KV

const fs = require('fs');
const path = require('path');
const os = require('os');

const SERVICES_FILE = path.join(__dirname, '..', 'services.js');
const ENV_FILE = path.join(__dirname, '.env.local');

// Поля, доступные для удаленного обновления
const EDITORIAL_FIELDS = ['access', 'pay', 'accessNote', 'payNote', 'accessBoxNote', 'payBoxNote', 'desc', 'sub', 'payPartner', 'vpnPartner', 'payPartners', 'vpnPartners'];

const VALID_ACCESS = ['open', 'partial', 'vpn'];
const VALID_PAY = ['ok', 'mid'];

function loadEnv() {
  const env = {};
  if (!fs.existsSync(ENV_FILE)) return env;
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    env[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
  }
  return env;
}

// Импорт ES-модуля services.js через временный .mjs файл
async function loadServices() {
  const tmp = path.join(os.tmpdir(), `worksly-services-${Date.now()}.mjs`);
  fs.copyFileSync(SERVICES_FILE, tmp);
  try {
    const mod = await import(`file://${tmp.replace(/\\/g, '/')}`);
    return mod.SERVICES;
  } finally {
    fs.unlinkSync(tmp);
  }
}

// Валидация полей перед публикацией
function validate(services) {
  const problems = [];
  const seen = new Set();

  for (const s of services) {
    if (!s.id) { problems.push('есть сервис без id'); continue; }
    if (seen.has(s.id)) problems.push(`${s.id}: дубликат id`);
    seen.add(s.id);

    if (!VALID_ACCESS.includes(s.access)) {
      problems.push(`${s.id}: access = "${s.access}", допустимо ${VALID_ACCESS.join(' / ')}`);
    }
    if (!VALID_PAY.includes(s.pay)) {
      problems.push(`${s.id}: pay = "${s.pay}", допустимо ${VALID_PAY.join(' / ')}`);
    }
    if (!s.accessNote) problems.push(`${s.id}: пустой accessNote`);
    if (!s.payNote) problems.push(`${s.id}: пустой payNote`);
  }
  return problems;
}

function buildPayload(services) {
  const out = {};
  for (const s of services) {
    const entry = {};
    for (const field of EDITORIAL_FIELDS) {
      if (s[field] !== undefined) entry[field] = s[field];
    }
    out[s.id] = entry;
  }
  return { updatedAt: new Date().toISOString(), services: out };
}

async function main() {
  const env = loadEnv();
  const services = await loadServices();

  const problems = validate(services);
  if (problems.length) {
    console.error('Данные не прошли проверку, ничего не отправлено:\n');
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }

  const payload = buildPayload(services);
  const size = Buffer.byteLength(JSON.stringify(payload));

  console.log(`Сервисов: ${services.length}, размер: ${(size / 1024).toFixed(1)} КБ`);
  for (const s of services) {
    console.log(`  ${s.id.padEnd(13)} доступ: ${s.access.padEnd(8)} оплата: ${s.pay}`);
  }

  if (!process.argv.includes('--push')) {
    console.log('\nПроверка пройдена. Чтобы отправить: node push-editorial.js --push');
    return;
  }

  if (!env.WORKER_URL || !env.PUSH_SECRET) {
    console.error(`\nНет WORKER_URL или PUSH_SECRET в ${ENV_FILE}`);
    process.exit(1);
  }

  const res = await fetch(`${env.WORKER_URL}/editorial`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Push-Secret': env.PUSH_SECRET },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000)
  });

  if (!res.ok) {
    console.error(`\nОтправка не удалась: HTTP ${res.status} ${await res.text()}`);
    process.exit(1);
  }

  // Контрольная проверка: читаем данные обратно из KV и сверяем метку времени
  const check = await fetch(`${env.WORKER_URL}/editorial`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(15000)
  });
  const stored = check.ok ? await check.json().catch(() => null) : null;

  if (stored?.updatedAt !== payload.updatedAt) {
    console.error('\nСервер принял запрос, но данные НЕ обновились.');
    console.error(`  отправляли: ${payload.updatedAt}`);
    console.error(`  лежит там:  ${stored?.updatedAt ?? '(ничего)'}`);
    console.error('  Причина обычно в сети: прокси/VPN подменил ответ, запрос не дошёл.');
    process.exit(1);
  }

  console.log('\nОтправлено и проверено — данные лежат на сервере.');
  console.log('Пользователи увидят изменения при следующем открытии попапа.');
}

main().catch((err) => {
  console.error('Ошибка:', err.message);
  process.exit(1);
});
