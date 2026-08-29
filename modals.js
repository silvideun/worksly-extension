/* Модальные окна попапа: «Сообщить об ошибке» и «Сотрудничество».
   Оболочка одна на всё расширение — заголовок подставляется, содержимое переключается
   переключением .modal-pane. Новое окно = новый pane в popup.html + строка в MODAL_TITLES.

   Файл ничего не знает о карточках и о рендере списка. Тост и открытие ссылок приходят
   параметрами в initModals(), чтобы не заводить кольцевую зависимость с popup.js. */

import { SERVICES } from './services.js';

const MODAL_TITLES = { report: 'Сообщить об ошибке', contact: 'Сотрудничество' };

// Воркер приёма жалоб, исходник - server/worker/report.js
const REPORT_URL = 'https://worksly-feedback.winterbornxd.workers.dev';
const REPORT_DRAFT_KEY = 'workslyReportDraft';
const REPORT_LAST_SENT_KEY = 'workslyReportLastSent';
const REPORT_COOLDOWN_MS = 60 * 1000;
const REPORT_TIMEOUT_MS = 10000;

const hasChromeStorage = typeof chrome !== 'undefined' && !!chrome.storage?.local;

let overlay = null;
let titleEl = null;
let panes = null;
let returnFocus = null;
let form = null;
let sending = false;

export function openModal(name){
  if(!overlay || !MODAL_TITLES[name]) return;
  titleEl.textContent = MODAL_TITLES[name];
  panes.forEach(pane => { pane.hidden = pane.dataset.pane !== name; });
  if(name === 'report') loadDraft();
  returnFocus = document.activeElement;
  overlay.hidden = false;
  overlay.querySelector('.modal-close').focus();
}

export function closeModal(){
  if(!overlay || overlay.hidden) return;
  overlay.hidden = true;
  if(returnFocus?.isConnected) returnFocus.focus();
  returnFocus = null;
}

async function copyText(text){
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.warn('Worksly: не удалось скопировать в буфер обмена', err);
    return false;
  }
}


function fillServiceSelect(){
  const selectEl = document.getElementById('report-service');
  if(!selectEl) return;
  SERVICES.forEach(service => {
    const option = document.createElement('option');
    option.value = service.id;
    option.textContent = service.name;
    selectEl.appendChild(option);
  });
}

/* Черновик жалобы переживает закрытие попапа. Попап Chrome закрывается от любого клика мимо
   него - без этого человек, отвлёкшийся на вкладку, терял бы написанный текст. */
let draftTimer;

async function loadDraft(){
  if(!hasChromeStorage || !form) return;
  try {
    const data = await chrome.storage.local.get(REPORT_DRAFT_KEY);
    const draft = data[REPORT_DRAFT_KEY];
    if(!draft) return;
    form.textEl.value = draft.text || '';
    form.contactEl.value = draft.contact || '';
    if(draft.service) form.serviceEl.value = draft.service;
  } catch (err) {
    console.warn('Worksly: не удалось прочитать черновик жалобы', err);
  }
}

function saveDraft(){
  if(!hasChromeStorage || !form) return;
  clearTimeout(draftTimer);
  draftTimer = setTimeout(async () => {
    try {
      await chrome.storage.local.set({ [REPORT_DRAFT_KEY]: {
        text: form.textEl.value,
        contact: form.contactEl.value,
        service: form.serviceEl.value
      }});
    } catch (err) {
      console.warn('Worksly: не удалось сохранить черновик жалобы', err);
    }
  }, 400);
}

async function forgetDraft(){
  clearTimeout(draftTimer);
  if(!hasChromeStorage) return;
  try {
    await chrome.storage.local.remove(REPORT_DRAFT_KEY);
  } catch (err) {
    console.warn('Worksly: не удалось очистить черновик жалобы', err);
  }
}

/* Пауза между отправками - защита от случайного повтора, а не от злого умысла: обойти её
   можно за минуту. Настоящее ограничение стоит в воркере, здесь только вежливость. */
async function tooSoon(){
  if(!hasChromeStorage) return false;
  try {
    const data = await chrome.storage.local.get(REPORT_LAST_SENT_KEY);
    const last = data[REPORT_LAST_SENT_KEY];
    return !!last && Date.now() - last < REPORT_COOLDOWN_MS;
  } catch {
    return false;
  }
}

function extensionVersion(){
  try {
    return chrome?.runtime?.getManifest?.().version || '';
  } catch {
    return '';
  }
}

function setSending(state){
  sending = state;
  form.sendBtn.disabled = state;
  form.sendBtn.textContent = state ? 'Отправляем…' : 'Отправить';
}

async function sendReport(showToast){
  if(sending) return;

  const text = form.textEl.value.trim();
  if(!text){
    showToast('Опишите, что не так');
    form.textEl.focus();
    return;
  }
  if(await tooSoon()){
    showToast('Только что отправляли - попробуйте через минуту');
    return;
  }

  setSending(true);
  try {
    const res = await fetch(REPORT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      body: JSON.stringify({
        text,
        service: form.serviceEl.value,
        contact: form.contactEl.value.trim(),
        version: extensionVersion()
      }),
      signal: AbortSignal.timeout(REPORT_TIMEOUT_MS)
    });

    if(res.ok){
      if(hasChromeStorage){
        await chrome.storage.local.set({ [REPORT_LAST_SENT_KEY]: Date.now() });
      }
      await forgetDraft();
      form.textEl.value = '';
      form.contactEl.value = '';
      form.serviceEl.value = '';
      closeModal();
      showToast('Спасибо, сообщение отправлено');
      return;
    }

    // текст НЕ чистим и окно не закрываем: переписывать написанное заново - худшее, что можно
    // предложить человеку, который уже потратил время
    showToast(res.status === 429
      ? 'Слишком много обращений, попробуйте позже'
      : 'Не удалось отправить, попробуйте позже');
  } catch (err) {
    console.warn('Worksly: жалоба не отправилась', err);
    showToast('Не удалось отправить. Проверьте связь и попробуйте ещё раз');
  } finally {
    setSending(false);
  }
}

export function initModals({ showToast, openExternal }){
  overlay = document.getElementById('modal');
  if(!overlay) return;
  titleEl = overlay.querySelector('.modal-title');
  panes = overlay.querySelectorAll('.modal-pane');

  fillServiceSelect();

  document.querySelectorAll('[data-modal-open]').forEach(btn => {
    btn.addEventListener('click', () => openModal(btn.dataset.modalOpen));
  });

  // закрытие: крестик, клик по затемнённому фону мимо окна, Esc
  overlay.addEventListener('click', (e) => {
    if(e.target === overlay || e.target.closest('[data-modal-close]')) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if(e.key === 'Escape') closeModal();
  });

  overlay.querySelectorAll('[data-copy]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const value = btn.dataset.copy;
      const copied = await copyText(value);
      // при отказе буфера адрес всё равно называем: строку в окне можно выделить мышью
      showToast(copied ? `Почта скопирована: ${value}` : `Не удалось скопировать. Почта: ${value}`);
    });
  });

  overlay.querySelectorAll('[data-open-url]').forEach(btn => {
    btn.addEventListener('click', () => openExternal(btn.dataset.openUrl));
  });

  const sendBtn = overlay.querySelector('[data-report-send]');
  if(sendBtn){
    form = {
      sendBtn,
      serviceEl: document.getElementById('report-service'),
      textEl: document.getElementById('report-text'),
      contactEl: document.getElementById('report-contact')
    };
    sendBtn.addEventListener('click', () => sendReport(showToast));
    [form.textEl, form.contactEl, form.serviceEl].forEach(el => {
      el.addEventListener('input', saveDraft);
    });
  }
}
