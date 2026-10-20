// ============================================================================
// RTO 인허가 대시보드 - Google Apps Script 연동 헬퍼
// - 읽기: JSONP (Apps Script는 CORS 헤더를 주지 않아 script 태그로 우회)
// - 쓰기: no-cors POST (수신 확인 불가, fire-and-forget)
// ============================================================================
import { APPS_SCRIPT_URL } from './sheets-config.js';

let jsonpSeq = 0;

export function loadAppData() {
  return new Promise((resolve, reject) => {
    const cbName = '__rto_cb_' + (++jsonpSeq) + '_' + Date.now();
    const script = document.createElement('script');
    script.id = cbName;

    const timer = setTimeout(() => {
      delete window[cbName];
      script.remove();
      reject(new Error('Apps Script 응답 시간 초과'));
    }, 20000);

    const cleanup = () => {
      clearTimeout(timer);
      delete window[cbName];
      script.remove();
    };

    window[cbName] = (data) => {
      cleanup();
      if (data && data.ok) resolve(data);
      else reject(new Error((data && data.error) || 'Apps Script 오류'));
    };

    script.onerror = () => {
      cleanup();
      reject(new Error('Apps Script를 불러오지 못했습니다.'));
    };
    script.src = `${APPS_SCRIPT_URL}?callback=${cbName}&t=${Date.now()}`;
    document.head.appendChild(script);
  });
}

// no-cors POST: 응답을 읽을 수 없으므로 성공 여부는 이후 loadAppData 로 확인합니다.
export function postData(action, payload = {}) {
  return fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, ...payload }),
  });
}
