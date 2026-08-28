import { SERVICES } from './services.js';
import { hasWebRequest, describeNetworkError, pingDomain, getCachedPing, setCachedPing } from './client-ping.js';

// Статус читаем через Cloudflare Worker (HTTPS-прокси над сервером)
const STATUS_URL = 'https://worksly-status.winterbornxd.workers.dev';
const FAVORITES_STORAGE_KEY = 'workslyFavorites';
const LIVE_STATUS_STORAGE_KEY = 'workslyLiveStatus';
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
const verifiedItemTemplate = document.getElementById('verified-item-template');

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

function createVerifiedItem(item){
  const clone = verifiedItemTemplate.content.cloneNode(true);
  const el = clone.querySelector('.verified-item');
  el.querySelector('.verified-item-name').textContent = item.name;
  el.querySelector('.verified-item-desc').textContent = item.desc || item.note || '';

  const badgeEl = el.querySelector('.verified-item-badge');
  const isPartner = !!(item.isPartner || item.badge === 'Партнёр' || item.badge === 'ПАРТНЁР');
  badgeEl.hidden = !isPartner;
  if(item.badge && item.badge !== 'Проверенный сервис') {
    badgeEl.textContent = item.badge;
  }

  el.addEventListener('click', (e) => {
    e.stopPropagation();
    if(item.url && item.url.trim()){
      const targetUrl = item.url.trim();
      if(typeof chrome !== 'undefined' && chrome.tabs?.create){
        chrome.tabs.create({ url: targetUrl });
      } else {
        window.open(targetUrl, '_blank', 'noopener,noreferrer');
      }
    } else {
      showToast(`Откроется ${item.name} в новой вкладке (в прототипе — без перехода)`);
    }
  });

  return el;
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
  const accessBox = cardEl.querySelector('.status-box--access');
  if(accessBox){
    const accessMeta = {
      open:    { theme: 'theme-good',  title: 'Доступ — сайт открывается', note: 'Работает у всех провайдеров РФ' },
      partial: { theme: 'theme-mixed', title: 'Доступ — частично',          note: 'Работает у части провайдеров' },
      vpn:     { theme: 'theme-bad',   title: 'Доступ — нужен VPN',        note: 'Не работает ни у одного провайдера' }
    }[service.access] || { theme: 'theme-good', title: 'Доступ — сайт открывается', note: 'Работает у всех провайдеров РФ' };

    accessBox.className = `status-box status-box--access ${accessMeta.theme}`;
    accessBox.querySelector('.status-box-title').textContent = accessMeta.title;
    accessBox.querySelector('.access-note').textContent = service.accessBoxNote || accessMeta.note;
  }

  const payBox = cardEl.querySelector('.status-box--pay');
  if(payBox){
    const payMeta = {
      ok:  { theme: 'theme-good', title: 'Оплата — карта РФ работает', note: 'Можно оплатить напрямую' },
      mid: { theme: 'theme-warn', title: 'Оплата — нужен посредник',   note: 'Карты РФ не проходят' }
    }[service.pay] || { theme: 'theme-warn', title: 'Оплата — нужен посредник', note: 'Карты РФ не проходят' };

    payBox.className = `status-box status-box--pay ${payMeta.theme}`;
    payBox.querySelector('.status-box-title').textContent = payMeta.title;
    payBox.querySelector('.pay-note').textContent = service.payBoxNote || payMeta.note;
  }

  const descEl = cardEl.querySelector('.card-desc');
  if(descEl){
    const descText = service.desc || (service.accessNote ? `${service.accessNote} ${service.payNote}` : '');
    descEl.textContent = descText;
    descEl.hidden = !descText;
  }

  const accessMap = {
    open:    { cls:'ok',  label:'Доступ есть' },
    partial: { cls:'mid', label:'Частично' },
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

  const diagIdle = cardEl.querySelector('.diag-idle');
  const diagResult = cardEl.querySelector('.diag-result');
  const diagServerFooter = cardEl.querySelector('.diag-server-footer');

  if(ping && ping.status !== 'checking' && ping.checkedAt){
    if(diagIdle) diagIdle.hidden = true;
    if(diagResult){
      diagResult.hidden = false;
      const isOk = ping.status === 'ok';
      diagResult.className = `diag-result ${isOk ? 'is-ok' : 'is-bad'}`;

      const titleEl = diagResult.querySelector('.diag-result-title');
      const noteEl = diagResult.querySelector('.diag-result-note');
      const stampEl = diagResult.querySelector('.diag-result-stamp');

      if(isOk){
        titleEl.textContent = 'Сайт открывается с вашего подключения';
        noteEl.textContent = 'Оплата и полноценная работа аккаунта из РФ по-прежнему ограничены — понадобится посредник.';
      } else {
        titleEl.textContent = 'Сайт не открылся с вашего подключения';
        if(service.access === 'open'){
          // Для сервиса, который открывается из РФ без VPN, совет включить VPN был бы враньём:
          // недоступность здесь означает сбой, а не блокировку (docs/client-ping.md, п.11)
          noteEl.textContent = 'Обычно он работает из РФ без VPN — похоже, временный сбой на стороне сервиса или в вашей сети. VPN здесь скорее всего не поможет, попробуйте позже.';
        } else if(service.access === 'partial'){
          noteEl.textContent = 'Ограничение ставит ваш оператор связи. У другого провайдера или мобильной сети сервис может работать — иначе понадобится VPN.';
        } else {
          noteEl.textContent = 'Понадобится VPN. Проверка идёт только до сайта и не учитывает работу приложения.';
        }
      }

      stampEl.textContent = `проверено с вашего устройства · ${formatExact(ping.checkedAt)}`;
    }
    if(diagServerFooter){
      diagServerFooter.hidden = false;
      const serverFooterTimeEl = diagServerFooter.querySelector('.diag-server-footer-time');
      if(serverFooterTimeEl){
        serverFooterTimeEl.textContent = live?.checkedAt ? formatExact(live.checkedAt) : 'недавно';
      }
    }
  } else {
    if(diagResult) diagResult.hidden = true;
    if(diagServerFooter) diagServerFooter.hidden = true;
    if(diagIdle){
      diagIdle.hidden = false;
      const serverTimeEl = diagIdle.querySelector('.diag-server-time');
      if(serverTimeEl){
        serverTimeEl.textContent = live?.checkedAt ? formatExact(live.checkedAt) : 'недавно';
      }
      const clientStatusEl = diagIdle.querySelector('.diag-client-status');
      const clientLine = diagIdle.querySelector('.diag-line--client');
      const diagBtn = diagIdle.querySelector('[data-diag-ping]');
      if(ping?.status === 'checking'){
        if(clientLine) clientLine.className = 'diag-line diag-line--client is-checking';
        if(clientStatusEl) clientStatusEl.textContent = 'проверяем…';
        if(diagBtn){
          diagBtn.textContent = 'проверяем…';
          diagBtn.disabled = true;
        }
      } else {
        if(clientLine) clientLine.className = 'diag-line diag-line--client';
        if(clientStatusEl) clientStatusEl.textContent = 'пока не проверяли';
        if(diagBtn){
          diagBtn.textContent = 'проверить сейчас';
          diagBtn.disabled = false;
        }
      }
    }
  }

  const verifiedSection = cardEl.querySelector('.verified-section');
  if(verifiedSection){
    const vpnListEl = verifiedSection.querySelector('.vpn-list');
    const payListEl = verifiedSection.querySelector('.pay-list');
    const vpnGroupEl = verifiedSection.querySelector('.verified-group--vpn');
    const payGroupEl = verifiedSection.querySelector('.verified-group--pay');
    const countEl = verifiedSection.querySelector('.verified-count');
    const disclaimerEl = verifiedSection.querySelector('.verified-disclaimer');

    vpnListEl.innerHTML = '';
    payListEl.innerHTML = '';

    const rawVpn = service.vpnPartners || (service.vpnPartner ? [service.vpnPartner] : []);
    const vpnItems = (Array.isArray(rawVpn) ? rawVpn : [rawVpn]).filter(Boolean);

    const rawPay = service.payPartners || (service.payPartner ? [service.payPartner] : []);
    const payItems = (Array.isArray(rawPay) ? rawPay : [rawPay]).filter(Boolean);

    const sortPartners = (items) => [...items].sort((a, b) => {
      const aPart = (a.isPartner || a.badge === 'Партнёр' || a.badge === 'ПАРТНЁР') ? 1 : 0;
      const bPart = (b.isPartner || b.badge === 'Партнёр' || b.badge === 'ПАРТНЁР') ? 1 : 0;
      return bPart - aPart;
    });

    const sortedVpn = sortPartners(vpnItems);
    const sortedPay = sortPartners(payItems);

    sortedVpn.forEach(item => vpnListEl.appendChild(createVerifiedItem(item)));
    sortedPay.forEach(item => payListEl.appendChild(createVerifiedItem(item)));

    const totalCount = sortedVpn.length + sortedPay.length;
    if(totalCount > 0){
      verifiedSection.hidden = false;
      vpnGroupEl.hidden = sortedVpn.length === 0;
      payGroupEl.hidden = sortedPay.length === 0;
      countEl.textContent = totalCount;

      const hasAnyPartner = [...sortedVpn, ...sortedPay].some(p => p.isPartner || p.badge === 'Партнёр' || p.badge === 'ПАРТНЁР');
      if(hasAnyPartner){
        disclaimerEl.textContent = 'Сервисы, которыми пользуемся сами. Часть ссылок партнёрские — они отмечены. Условия и цены — на стороне сервиса.';
      } else {
        disclaimerEl.textContent = 'Сервисы, которыми пользуемся сами. Мы не берём за это денег и не отвечаем за их условия и цены.';
      }
    } else {
      verifiedSection.hidden = true;
    }
  }
}

function attachCardEvents(cardEl, service){
  cardEl.querySelector('[data-toggle]').addEventListener('click', (e) => {
    if(e.target.closest('[data-heart]') || e.target.closest('[data-ping]') || e.target.closest('[data-diag-ping]') || e.target.closest('[data-verified-item]') || e.target.closest('[data-collapse]')) return;
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

  cardEl.querySelectorAll('[data-diag-ping]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      runClientPing(service);
    });
  });

  const collapseBtn = cardEl.querySelector('[data-collapse]');
  if(collapseBtn){
    collapseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      cardEl.classList.remove('open');
      openIds.delete(service.id);
    });
  }
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

/* Прошлый ответ сервера хранится локально, чтобы плашка "Проверено N назад" была на месте
   уже в первом кадре. Иначе она появляется вместе с ответом из сети и раздвигает карточки. */
async function hydrateLiveStatusFromCache(){
  if(!hasChromeStorage) return;
  try {
    const data = await chrome.storage.local.get(LIVE_STATUS_STORAGE_KEY);
    const saved = data[LIVE_STATUS_STORAGE_KEY];
    if(saved && typeof saved === 'object') liveStatus = saved;
  } catch (err) {
    console.warn('Worksly: не удалось прочитать кэш статуса', err);
  }
}

async function saveLiveStatus(){
  if(!hasChromeStorage) return;
  try {
    await chrome.storage.local.set({ [LIVE_STATUS_STORAGE_KEY]: liveStatus });
  } catch (err) {
    console.warn('Worksly: не удалось сохранить кэш статуса', err);
  }
}

async function fetchLiveStatus(){
  try {
    const res = await fetch(STATUS_URL, { signal: AbortSignal.timeout(5000) });
    if(!res.ok) return;
    const data = await res.json();
    liveStatus = data.services || {};
    updateAllCards();
    saveLiveStatus();
  } catch (err) {
    // сервер недоступен — показываем прошлый снимок из кэша, он честно датирован checkedAt
  }
}

const EDITORIAL_FIELDS = ['access', 'pay', 'accessNote', 'payNote', 'accessBoxNote', 'payBoxNote', 'desc', 'sub', 'payPartner', 'vpnPartner', 'payPartners', 'vpnPartners'];
const VALID_ACCESS = ['open', 'partial', 'vpn'];
const VALID_PAY = ['ok', 'mid'];

function sanitizePartner(partner){
  if(!partner || typeof partner !== 'object') return null;
  if(!partner.name) return null;
  const result = {
    name: String(partner.name).trim(),
    desc: String(partner.desc || partner.note || '').trim()
  };
  if(partner.badge) result.badge = String(partner.badge).trim();
  if(partner.url) result.url = String(partner.url).trim();
  if(typeof partner.isPartner === 'boolean') result.isPartner = partner.isPartner;
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
      if(field === 'payPartners' || field === 'vpnPartners'){
        if(Array.isArray(value)){
          service[field] = value.map(sanitizePartner).filter(Boolean);
        } else if(value === null){
          service[field] = [];
        }
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
    hydrateClientPingFromCache(),
    hydrateLiveStatusFromCache()
  ]);
  render();

  fetchEditorial();
  fetchLiveStatus();
}

init();
