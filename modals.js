/* Модальные окна попапа: «Сообщить об ошибке» и «Сотрудничество».
   Оболочка одна на всё расширение — заголовок подставляется, содержимое переключается
   переключением .modal-pane. Новое окно = новый pane в popup.html + строка в MODAL_TITLES.

   Файл ничего не знает о карточках и о рендере списка. Тост и открытие ссылок приходят
   параметрами в initModals(), чтобы не заводить кольцевую зависимость с popup.js. */

import { SERVICES } from './services.js';

const MODAL_TITLES = { report: 'Сообщить об ошибке', contact: 'Сотрудничество' };

let overlay = null;
let titleEl = null;
let panes = null;
let returnFocus = null;

export function openModal(name){
  if(!overlay || !MODAL_TITLES[name]) return;
  titleEl.textContent = MODAL_TITLES[name];
  panes.forEach(pane => { pane.hidden = pane.dataset.pane !== name; });
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

  // Форма жалобы пока только показывается: воркер, который принимает текст, ещё не написан.
  // Удалить когда станет неактуально - заменить на реальную отправку.
  const sendBtn = overlay.querySelector('[data-report-send]');
  if(sendBtn){
    sendBtn.addEventListener('click', () => showToast('Отправка ещё не подключена'));
  }
}
