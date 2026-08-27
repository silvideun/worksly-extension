const CLIENT_PING_TIMEOUT_MS = 7000;
const CLIENT_PING_TTL_MS = 15 * 60 * 1000;
const CLIENT_PING_STORAGE_PREFIX = 'clientPing:';

export const hasWebRequest = typeof chrome !== 'undefined' && !!chrome.webRequest;
const hasChromeStorage = typeof chrome !== 'undefined' && !!chrome.storage?.local;

export function describeNetworkError(code){
  const known = {
    'net::ERR_CONNECTION_RESET': 'соединение было разорвано',
    'net::ERR_CONNECTION_REFUSED': 'в соединении отказано',
    'net::ERR_CONNECTION_CLOSED': 'соединение закрыто',
    'net::ERR_NAME_NOT_RESOLVED': 'домен не найден',
    'net::ERR_CONNECTION_TIMED_OUT': 'домен не отвечает (таймаут)',
    'net::ERR_TIMED_OUT': 'домен не отвечает (таймаут)',
    'net::ERR_SSL_PROTOCOL_ERROR': 'ошибка защищённого соединения (SSL)',
    'net::ERR_ADDRESS_UNREACHABLE': 'адрес недоступен',
    'CLIENT_TIMEOUT': 'домен не отвечает (таймаут)'
  };
  if(known[code]) return known[code];
  console.warn('Worksly: неизвестный код сетевой ошибки', code);
  return 'не удалось установить соединение';
}

export function pingDomain(domain){
  return new Promise((resolve) => {
    if(!hasWebRequest){
      resolve({ status:'blocked', reason:'network', networkError:'NO_WEBREQUEST' });
      return;
    }

    const marker = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const url = `https://${domain}/?workslyPing=${marker}`;
    const start = performance.now();
    let settled = false;
    let requestId = null;
    let safetyTimer;

    const finish = (result) => {
      if(settled) return;
      settled = true;
      chrome.webRequest.onBeforeRequest.removeListener(onBeforeRequest);
      chrome.webRequest.onCompleted.removeListener(onCompleted);
      chrome.webRequest.onErrorOccurred.removeListener(onErrorOccurred);
      clearTimeout(safetyTimer);
      resolve(result);
    };

    function onBeforeRequest(details){
      if(details.url !== url) return;
      requestId = details.requestId;
    }
    function onCompleted(details){
      if(details.requestId !== requestId) return;
      const ms = Math.round(performance.now() - start);
      if(details.statusCode >= 200 && details.statusCode < 400){
        finish({ status:'ok', ms, httpStatus: details.statusCode });
      } else {
        finish({ status:'blocked', reason:'service', httpStatus: details.statusCode });
      }
    }
    function onErrorOccurred(details){
      if(details.requestId !== requestId) return;
      finish({ status:'blocked', reason:'network', networkError: details.error });
    }

    chrome.webRequest.onBeforeRequest.addListener(onBeforeRequest, { urls:[`https://${domain}/*`] });
    chrome.webRequest.onCompleted.addListener(onCompleted, { urls:[`https://${domain}/*`] });
    chrome.webRequest.onErrorOccurred.addListener(onErrorOccurred, { urls:[`https://${domain}/*`] });

    fetch(url, { mode:'no-cors', cache:'no-store' }).catch(() => {});

    safetyTimer = setTimeout(() => {
      finish({ status:'blocked', reason:'network', networkError:'CLIENT_TIMEOUT' });
    }, CLIENT_PING_TIMEOUT_MS);
  });
}

export async function getCachedPing(id){
  if(!hasChromeStorage) return null;
  try {
    const key = CLIENT_PING_STORAGE_PREFIX + id;
    const stored = await chrome.storage.local.get(key);
    const data = stored[key];
    if(!data?.checkedAt) return null;
    const age = Date.now() - new Date(data.checkedAt).getTime();
    if(age > CLIENT_PING_TTL_MS) return null;
    return data;
  } catch (err) {
    console.warn('Worksly: не удалось прочитать кэш пинга', err);
    return null;
  }
}

export async function setCachedPing(id, data){
  if(!hasChromeStorage) return;
  try {
    const key = CLIENT_PING_STORAGE_PREFIX + id;
    await chrome.storage.local.set({ [key]: data });
  } catch (err) {
    console.warn('Worksly: не удалось сохранить кэш пинга', err);
  }
}
