import { SERVICES } from './services.js';
import { hasWebRequest, describeNetworkError, pingDomain, getCachedPing, setCachedPing } from './client-ping.js';

// Статус читаем через Cloudflare Worker (HTTPS-прокси над сервером)
const STATUS_URL = 'https://worksly-status.winterbornxd.workers.dev';
const FAVORITES_STORAGE_KEY = 'workslyFavorites';
const hasChromeStorage = typeof chrome !== 'undefined' && !!chrome.storage?.local;

const favorites = new Set();
const openIds = new Set();
let activeTab = 'all';
let liveStatus = {};
let clientPing = {};

const list = document.getElementById('list');
const search = document.getElementById('search');
const toast = document.getElementById('toast');
const favCountEl = document.getElementById('fav-count');
const footerCountEl = document.getElementById('footer-count');
const tabs = document.querySelectorAll('.tab');

const cardTemplate = document.getElementById('card-template');
const partnerTemplate = document.getElementById('partner-box-template');

const ICONS = {
  vpn: '<path d="M12 2 4 6v6c0 5 3.5 8 8 10 4.5-2 8-5 8-10V6l-8-4Z"/>',
  check: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  check2: '<path d="M20 6 9 17l-5-5"/>'
};

function pluralize(n, one, few, many){
  const mod10 = n % 10, mod100 = n % 100;
  if(mod10 === 1 && mod100 !== 11) return one;
  if([2,3,4].includes(mod10) && ![12,13,14].includes(mod100)) return few;
  return many;
}

function formatRelative(iso){
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if(diffMin < 60) return diffMin <= 1 ? 'только что' : `${diffMin} ${pluralize(diffMin,'минуту','минуты','минут')} назад`;
  const diffH = Math.floor(diffMin / 60);
  if(diffH < 24) return `${diffH} ${pluralize(diffH,'час','часа','часов')} назад`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD} ${pluralize(diffD,'день','дня','дней')} назад`;
}

function formatExact(iso){
  const d = new Date(iso);
  const date = d.toLocaleDateString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric' });
  const time = d.toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' });
  return `${date}, ${time}`;
}

function pingResultText(service, ping){
  const isOpen = service.access === 'open';
  if(ping.status === 'ok'){
    return isOpen
      ? '✓ Сайт открывается с вашего текущего подключения.'
      : '✓ Сайт открывается с вашего текущего подключения. Обратите внимание: для полной работы аккаунта и оплаты по-прежнему могут действовать ограничения для РФ.';
  }
  return isOpen
    ? 'Сайт сейчас не отвечает. Обычно из РФ он работает — похоже, временный сбой.'
    : 'С вашего подключения сайт сейчас не открывается. Если вы в РФ — включите VPN. Если VPN уже работает — попробуйте сменить страну или сервер.';
}

function createPartnerBox(kind, iconKey, label, partner){
  const clone = partnerTemplate.content.cloneNode(true);
  const box = clone.querySelector('.partner-box');
  box.classList.add(kind);
  box.querySelector('.partner-icon').innerHTML = ICONS[iconKey];
  box.querySelector('.partner-label-text').textContent = label;
  box.querySelector('.partner-name').textContent = partner.name;
  box.querySelector('.partner-note').textContent = partner.note;
  const btn = box.querySelector('.partner-btn');
  btn.dataset.partner = partner.name;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if(partner.url && partner.url.trim()){
      const targetUrl = partner.url.trim();
      if(typeof chrome !== 'undefined' && chrome.tabs?.create){
        chrome.tabs.create({ url: targetUrl });
      } else {
        window.open(targetUrl, '_blank', 'noopener,noreferrer');
      }
    } else {
      showToast(`Демо-переход на ${partner.name} (заглушка)`);
    }
  });
  return box;
}

function populateCard(cardEl, service){
  const isFav = favorites.has(service.id);
  const live = liveStatus[service.id];
  const ping = clientPing[service.id];

  cardEl.dataset.id = service.id;
  cardEl.classList.toggle('open', openIds.has(service.id));

  const img = cardEl.querySelector('.icon-img');
  img.src = service.icon;
  img.alt = service.name;

  cardEl.querySelector('.card-name').textContent = service.name;
  cardEl.querySelector('.card-sub').textContent = service.sub;
  cardEl.querySelector('.access-note').textContent = service.accessNote;
  cardEl.querySelector('.pay-note').textContent = service.payNote;

  const accessMap = {
    open:    { cls:'ok',  label:'Доступ есть' },
    partial: { cls:'mid', label:'Частично / Сбой' },
    vpn:     { cls:'bad', label:'Нужен VPN' }
  };
  const accessInfo = accessMap[service.access] || accessMap.open;
  const accessBadge = cardEl.querySelector('.badge-access');
  accessBadge.className = `badge badge-access ${accessInfo.cls}`;
  cardEl.querySelector('.badge-access .badge-text').textContent = accessInfo.label;

  const payMap = {
    ok:  { cls:'ok',  label:'Оплата РФ' },
    mid: { cls:'mid', label:'Нужен посредник' }
  };
  const payInfo = payMap[service.pay] || payMap.mid;
  const payBadge = cardEl.querySelector('.badge-pay');
  payBadge.className = `badge badge-pay ${payInfo.cls}`;
  cardEl.querySelector('.badge-pay .badge-text').textContent = payInfo.label;

  const statusLine = cardEl.querySelector('.card-status-line');
  if(statusLine){
    statusLine.innerHTML = '';
    if(ping){
      const isChecking = ping.status === 'checking';
      const when = ping.checkedAt ? formatRelative(ping.checkedAt) : '';
      if(isChecking){
        statusLine.className = 'card-status-line checked-at checked-at--inline checked-at--client is-checking';
        statusLine.textContent = 'Проверка...';
      } else if(ping.status === 'ok'){
        statusLine.className = 'card-status-line checked-at checked-at--inline checked-at--client is-ok';
        statusLine.textContent = when ? `У вас: доступен (${when})` : 'У вас: доступен';
      } else {
        statusLine.className = 'card-status-line checked-at checked-at--inline checked-at--client is-bad';
        statusLine.textContent = when ? `У вас: недоступен (${when})` : 'У вас: недоступен';
      }
    } else if(live?.checkedAt){
      statusLine.className = 'card-status-line checked-at checked-at--inline';
      statusLine.textContent = `Проверено ${formatRelative(live.checkedAt)}`;
    } else {
      statusLine.className = 'card-status-line';
    }
  }

  const pingBtn = cardEl.querySelector('.ping-btn');
  const isChecking = ping?.status === 'checking';
  pingBtn.classList.toggle('checking', isChecking);
  pingBtn.disabled = isChecking;
  pingBtn.title = isChecking ? 'Проверка...' : 'Проверить у себя';

  const heart = cardEl.querySelector('.heart');
  heart.classList.toggle('filled', isFav);

  const diagBox = cardEl.querySelector('.diagnostics-box');
  if(ping && ping.status !== 'checking' && ping.checkedAt){
    diagBox.hidden = false;
    diagBox.classList.toggle('is-bad', ping.status === 'blocked');
    diagBox.querySelector('.diagnostics-text').textContent = pingResultText(service, ping);
  } else {
    diagBox.hidden = true;
  }

  const exactBlock = cardEl.querySelector('.checked-at--block');
  if(live?.checkedAt){
    exactBlock.hidden = false;
    exactBlock.textContent = `Данные проверены автоматически: ${formatExact(live.checkedAt)}`;
  } else {
    exactBlock.hidden = true;
  }

  const partnersContainer = cardEl.querySelector('.partners-container');
  partnersContainer.innerHTML = '';
  if(service.access !== 'open' && service.vpnPartner){
    const b = service.vpnPartner.badge || 'Проверенный сервис';
    const label = b.includes('·') ? b : `${b} · VPN`;
    partnersContainer.appendChild(createPartnerBox('vpn', 'vpn', label, service.vpnPartner));
  }
  if(service.pay !== 'ok' && service.payPartner){
    const b = service.payPartner.badge || 'Проверенный сервис';
    const label = b.includes('·') ? b : `${b} · оплата`;
    partnersContainer.appendChild(createPartnerBox('pay', 'check', label, service.payPartner));
  }
}

function attachCardEvents(cardEl, service){
  cardEl.querySelector('[data-toggle]').addEventListener('click', (e) => {
    if(e.target.closest('[data-heart]') || e.target.closest('[data-ping]')) return;
    const wasOpen = cardEl.classList.contains('open');
    cardEl.classList.toggle('open', !wasOpen);
    if(wasOpen) openIds.delete(service.id); else openIds.add(service.id);
  });

  cardEl.querySelector('[data-heart]').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFav(service);
  });

  cardEl.querySelector('[data-ping]').addEventListener('click', (e) => {
    e.stopPropagation();
    runClientPing(service);
  });
}

function createCardElement(service){
  const clone = cardTemplate.content.cloneNode(true);
  const cardEl = clone.querySelector('.card');
  populateCard(cardEl, service);
  attachCardEvents(cardEl, service);
  return cardEl;
}

function updateSingleCard(serviceId){
  const service = SERVICES.find(s => s.id === serviceId);
  if(!service) return;
  const existingCard = list.querySelector(`.card[data-id="${serviceId}"]`);
  if(!existingCard) return;
  populateCard(existingCard, service);
}

function updateAllCards(){
  SERVICES.forEach(s => updateSingleCard(s.id));
}

async function runClientPing(service){
  if(clientPing[service.id]?.status === 'checking') return;

  if(!hasWebRequest){
    showToast('Проверка доступна только в установленном расширении');
    return;
  }

  clientPing[service.id] = { status:'checking' };
  updateSingleCard(service.id);

  try {
    const result = await pingDomain(service.domain);
    if(result.status === 'blocked'){
      const detail = result.reason === 'service'
        ? `HTTP ${result.httpStatus}`
        : `${result.networkError} — ${describeNetworkError(result.networkError)}`;
      console.log(`Worksly: ${service.domain} — ${detail}`);
    }
    const data = { ...result, checkedAt: new Date().toISOString() };

    clientPing[service.id] = data;
    await setCachedPing(service.id, data);
  } catch (err) {
    console.error('Worksly: ошибка при пинге', err);
    clientPing[service.id] = { status:'blocked', reason:'network', networkError:'CLIENT_TIMEOUT', checkedAt: new Date().toISOString() };
  } finally {
    updateSingleCard(service.id);
  }
}

function updateFavCount(){
  favCountEl.textContent = favorites.size ? `(${favorites.size})` : '';
}

function renderEmptyState(){
  return activeTab === 'fav'
    ? `<div class="empty">
         <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.5-1.5 3-3.4 3-5.5A5.5 5.5 0 0 0 12 5a5.5 5.5 0 0 0-10 3.5c0 5.5 10 11.5 10 11.5s2.5-1.5 5-3.7"/></svg><br>
         Пока пусто.<br>Нажмите сердечко на нужном сервисе.
       </div>`
    : `<div class="empty">Ничего не нашлось.<br>Попробуйте другой запрос.</div>`;
}

function render(){
  const q = search.value.trim().toLowerCase();
  let items = SERVICES.filter(s => s.name.toLowerCase().includes(q));
  if(activeTab === 'fav') items = items.filter(s => favorites.has(s.id));

  footerCountEl.textContent = activeTab === 'fav'
    ? `${favorites.size} в избранном`
    : `${SERVICES.length} ${pluralize(SERVICES.length,'сервис','сервиса','сервисов')} · обновлено сегодня`;

  list.innerHTML = '';

  if(items.length === 0){
    list.innerHTML = renderEmptyState();
    return;
  }

  items.forEach(s => list.appendChild(createCardElement(s)));
}

async function loadFavorites(){
  if(!hasChromeStorage) return;
  try {
    const data = await chrome.storage.local.get(FAVORITES_STORAGE_KEY);
    const saved = data[FAVORITES_STORAGE_KEY];
    if(Array.isArray(saved)){
      favorites.clear();
      saved.forEach(id => favorites.add(id));
      updateFavCount();
    }
  } catch (err) {
    console.warn('Worksly: не удалось загрузить избранное', err);
  }
}

async function saveFavorites(){
  if(!hasChromeStorage) return;
  try {
    await chrome.storage.local.set({ [FAVORITES_STORAGE_KEY]: Array.from(favorites) });
  } catch (err) {
    console.warn('Worksly: не удалось сохранить избранное', err);
  }
}

function toggleFav(s){
  if(favorites.has(s.id)){
    favorites.delete(s.id);
    showToast(`«${s.name}» убран из избранного`);
  } else {
    favorites.add(s.id);
    showToast(`«${s.name}» добавлен в избранное`);
  }
  updateFavCount();
  saveFavorites();
  if(activeTab === 'fav'){
    render();
  } else {
    updateSingleCard(s.id);
  }
}

let toastTimer;

function showToast(msg){
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 1700);
}

async function fetchLiveStatus(){
  try {
    const res = await fetch(STATUS_URL, { signal: AbortSignal.timeout(5000) });
    if(!res.ok) return;
    const data = await res.json();
    liveStatus = data.services || {};
    updateAllCards();
  } catch (err) {
    // сервер недоступен — плашки "проверено" останутся скрыты
  }
}

const EDITORIAL_FIELDS = ['access', 'pay', 'accessNote', 'payNote', 'sub', 'payPartner', 'vpnPartner'];
const VALID_ACCESS = ['open', 'partial', 'vpn'];
const VALID_PAY = ['ok', 'mid'];

function sanitizePartner(partner){
  if(!partner || typeof partner !== 'object') return null;
  if(!partner.name || !partner.note) return null;
  const result = { name: String(partner.name).trim(), note: String(partner.note).trim() };
  if(partner.badge) result.badge = String(partner.badge).trim();
  if(partner.url) result.url = String(partner.url).trim();
  return result;
}

function applyEditorial(remote){
  for(const service of SERVICES){
    const patch = remote[service.id];
    if(!patch || typeof patch !== 'object') continue;

    for(const field of EDITORIAL_FIELDS){
      const value = patch[field];
      if(value === undefined) continue;

      if(field === 'access' && !VALID_ACCESS.includes(value)) continue;
      if(field === 'pay' && !VALID_PAY.includes(value)) continue;

      if(field === 'payPartner' || field === 'vpnPartner'){
        service[field] = value === null ? null : sanitizePartner(value);
        continue;
      }
      if(typeof value !== 'string' || !value.trim()) continue;
      service[field] = value.trim();
    }
  }
}

async function fetchEditorial(){
  try {
    const res = await fetch(`${STATUS_URL}/editorial`, { signal: AbortSignal.timeout(5000) });
    if(!res.ok) return;
    const data = await res.json();
    if(!data?.services) return;
    applyEditorial(data.services);
    updateAllCards();
  } catch (err) {
    // сервер недоступен — работаем на локальных данных services.js
  }
}

async function hydrateClientPingFromCache(){
  const entries = await Promise.all(
    SERVICES.map(async s => [s.id, await getCachedPing(s.id)])
  );
  for(const [id, data] of entries){
    if(data) clientPing[id] = data;
  }
}

tabs.forEach(t => {
  t.addEventListener('click', () => {
    tabs.forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    activeTab = t.dataset.tab;
    render();
  });
});

search.addEventListener('input', render);

async function init(){
  await Promise.all([
    loadFavorites(),
    hydrateClientPingFromCache()
  ]);
  render();

  fetchEditorial();
  fetchLiveStatus();
}

init();
