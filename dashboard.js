// ============================================================================
// RTO 디스플레이 대시보드
// - 항시 표시용 전체화면 대시보드
// - Google Apps Script(구글 시트)에서 데이터 로드, 주기적 자동 갱신
// - 만료일 기반 상태 자동 계산 (미만료=초록 / 갱신중=노랑 / 만료=빨강 / 해당없음=흰색)
// - PPTX(PowerPoint) 파일 내보내기
// ============================================================================
import { loadAppData, postData } from './sheets.js';
import {
  formatDate, fullDesc, escapeHtml,
} from './common.js';

const CATEGORY_ORDER = ['Mandated Licenses/Permits', 'Localized Licenses/Permits'];

// 인덱스 화면 표시용 상태: 기간 미도래=초록, 갱신중=노랑, 기간 경과=빨강, 해당 없음(만료일 없음)=흰색
const DISPLAY_META = {
  ok: { kor: '유효' },
  review: { kor: '갱신중' },
  expired: { kor: '만료' },
  none: { kor: '해당 없음' },
};

let permits = [];
let settings = {};
let alertDays = 60;

const tableBody = document.getElementById('table-body');
const connEl = document.getElementById('conn-status');
const contactEl = document.getElementById('contact-name');
const contactEditor = document.getElementById('contact-name').parentElement;
const btnEditContact = document.getElementById('btn-edit-contact');

// ---------- 데이터 로드 ----------
async function loadData() {
  const data = await loadAppData();
  settings = data.settings || {};
  permits = data.permits || [];
  alertDays = parseInt(settings.alert_days ?? '60', 10) || 60;

  const site = settings.site_name || 'Pyungtek';
  document.getElementById('site-name').textContent = site ? `(${site})` : '';
  document.getElementById('site-title').textContent = settings.title || 'Right To Operate Permits and Licenses';
  setContactName(settings.contact || 'Inhee Park');
  render();
}

function sortedPermits() {
  return [...permits]
    .filter((p) => p.active !== false)
    .sort((a, b) => {
      const ao = Number(a.sort_order ?? 0);
      const bo = Number(b.sort_order ?? 0);
      if (ao !== bo) return ao - bo;
      const ca = CATEGORY_ORDER.indexOf(a.category);
      const cb = CATEGORY_ORDER.indexOf(b.category);
      if (ca !== cb) return (ca < 0 ? 99 : ca) - (cb < 0 ? 99 : cb);
      return String(a.description || '').localeCompare(String(b.description || ''));
    });
}

// ---------- 렌더링 ----------
function render() {
  const list = sortedPermits();
  if (!list.length) {
    tableBody.innerHTML = '<tr><td colspan="7" class="loading">등록된 인허가가 없습니다.</td></tr>';
    return;
  }

  const rows = [];
  for (const p of list) {
    const st = displayStatus(p);
    const meta = DISPLAY_META[st];
    rows.push({ p, st, meta, cat: p.category });
  }

  // 카테고리 rowspan 계산 (연속된 같은 카테고리 블록 단위로 계산)
  for (let i = 0; i < rows.length; i++) {
    let run = 1;
    while (i + run < rows.length && rows[i + run].cat === rows[i].cat) run++;
    rows[i].catCell = `<td class="cat-cell" rowspan="${run}">${escapeHtml(rows[i].cat)}</td>`;
    for (let k = 1; k < run; k++) rows[i + k].catCell = '';
    i += run - 1;
  }

  tableBody.innerHTML = rows.map((r) => {
    const days = r.p.due_date ? daysUntilLocal(r.p.due_date) : null;
    const dueText = r.p.due_date ? formatDate(r.p.due_date) : 'N/A';
    const dueExtra = days !== null && days < 0 ? ` (D+${-days})` : '';
    const rowClass = r.st === 'expired' ? 'row-expired' : r.st === 'review' ? 'row-review' : '';
    return `<tr class="${rowClass}" draggable="true" data-id="${escapeHtml(r.p.id)}">
      ${r.catCell}
      <td>${escapeHtml(fullDesc(r.p))}</td>
      <td>${escapeHtml(r.p.issuing_agency || 'N/A')}</td>
      <td class="col-date">${formatDate(r.p.issue_date)}</td>
      <td class="col-date">${dueText}${dueExtra}</td>
      <td><span class="status-badge ${r.st} status-edit" data-status-id="${escapeHtml(r.p.id)}">${r.meta.kor}</span></td>
      <td class="col-move"><span class="drag-handle" title="드래그하여 이동">⠿</span></td>
    </tr>`;
  }).join('');

  tableBody.querySelectorAll('[data-status-id]').forEach((el) => {
    el.addEventListener('click', () => openStatusEditor(el.dataset.statusId));
  });
  tableBody.querySelectorAll('tr[draggable]').forEach((tr) => {
    tr.addEventListener('dragstart', onDragStart);
    tr.addEventListener('dragover', onDragOver);
    tr.addEventListener('dragleave', onDragLeave);
    tr.addEventListener('drop', onDrop);
    tr.addEventListener('dragend', onDragEnd);
  });

  fitToScreen();
}

function daysUntilLocal(dateStr) {
  const d = new Date(dateStr.length === 10 ? dateStr + 'T00:00:00' : dateStr);
  if (isNaN(d.getTime())) return null;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.floor((d - now) / 86400000);
}

function displayStatus(p) {
  if (p.status_override === 'ok' || p.status_override === 'review' || p.status_override === 'expired' || p.status_override === 'none') {
    return p.status_override;
  }
  if (!p.due_date) return 'none';
  const days = daysUntilLocal(p.due_date);
  if (days === null) return 'none';
  if (days < 0) return 'expired';
  if (days <= alertDays) return 'review';
  return 'ok';
}

// ---------- 상태 색상 임의 수정 (인라인) ----------
function openStatusEditor(id) {
  const p = permits.find((x) => x.id === id);
  if (!p) return;
  const badge = tableBody.querySelector(`[data-status-id="${id}"]`);
  if (!badge) return;

  const select = document.createElement('select');
  select.className = 'status-editor';
  const options = [
    ['', '자동 계산(만료일 기준)'],
    ['ok', '유효 · 초록'],
    ['review', '갱신중 · 노랑'],
    ['expired', '만료 · 빨강'],
    ['none', '해당 없음 · 흰색'],
  ];
  select.innerHTML = options.map(([v, t]) =>
    `<option value="${v}" ${(p.status_override || '') === v ? 'selected' : ''}>${t}</option>`
  ).join('');

  badge.replaceWith(select);
  select.focus();

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    select.remove();
    render();
  };

  select.addEventListener('change', () => {
    p.status_override = select.value;
    postData('save_permits', { permits });
    finish();
  });
  select.addEventListener('blur', finish);
  select.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') finish();
  });
}

// ---------- 드래그로 순서 이동 ----------
let dragId = null;

function onDragStart(e) {
  dragId = e.currentTarget.dataset.id;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragId);
  e.currentTarget.classList.add('dragging');
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  if (e.currentTarget.dataset.id !== dragId) e.currentTarget.classList.add('drag-over');
}

function onDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}

function onDrop(e) {
  e.preventDefault();
  const targetId = e.currentTarget.dataset.id;
  if (dragId && targetId && dragId !== targetId) reorderPermits(dragId, targetId);
}

function onDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  tableBody.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
  dragId = null;
}

function reorderPermits(dragId, targetId) {
  const list = sortedPermits();
  const from = list.findIndex((p) => p.id === dragId);
  const to = list.findIndex((p) => p.id === targetId);
  if (from < 0 || to < 0 || from === to) return;

  const moved = list.splice(from, 1)[0];
  const insertAt = from < to ? to - 1 : to;
  list.splice(insertAt, 0, moved);

  // 표시 순서 기준으로 sort_order 재부여
  list.forEach((p, i) => { p.sort_order = i * 10; });

  postData('save_permits', { permits });
  render();
}

// ---------- 연결 상태 ----------
function setConn(on) {
  connEl.textContent = on ? '● 연결됨' : '○ 연결 끊김';
  connEl.className = 'conn ' + (on ? 'on' : 'off');
}

// ---------- PPTX 내보내기 ----------
function loadPptxGenJS() {
  if (window.PptxGenJS) return Promise.resolve(window.PptxGenJS);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js';
    s.onload = () => resolve(window.PptxGenJS);
    s.onerror = () => reject(new Error('pptxgenjs 로드 실패'));
    document.head.appendChild(s);
  });
}

async function exportPptx() {
  const btn = document.getElementById('btn-pptx');
  btn.textContent = '저장 중…';
  btn.disabled = true;
  try {
    const PptxGenJS = await loadPptxGenJS();
    const pptx = new PptxGenJS();
    pptx.defineLayout({ name: 'RTO_WIDE', width: 13.33, height: 7.5 });
    pptx.layout = 'RTO_WIDE';

    const list = sortedPermits();
    const site = settings.site_name || 'Pyungtek';
    const title = settings.title || 'Right To Operate Permits and Licenses';
    const company = settings.company || 'EATON';
    const contact = settings.contact || 'Inhee Park';
    const CHUNK = 16;
    const chunks = [];
    for (let i = 0; i < list.length; i += CHUNK) chunks.push(list.slice(i, i + CHUNK));
    if (!chunks.length) chunks.push([]);

    const headerCells = (t) => ({ text: t, options: { bold: true, color: 'FFFFFF', fill: '003087', align: 'center', valign: 'middle', fontSize: 11 } });

    chunks.forEach((part, idx) => {
      const slide = pptx.addSlide();

      // Eaton 헤더
      slide.addText(
        [
          { text: company, options: { fontSize: 26, bold: true, color: 'FFFFFF' } },
          { text: 'Powering Business Worldwide', options: { fontSize: 11, color: 'FFFFFF' } },
        ],
        { x: 0.25, y: 0.2, w: 3.4, h: 0.85, fill: { color: '003087' }, align: 'center', valign: 'middle', margin: 0.05 }
      );
      slide.addText(`${title} (${site})`, {
        x: 3.85, y: 0.2, w: 9.2, h: 0.85, align: 'left', valign: 'middle',
        fontSize: 20, bold: true, color: '003087',
      });
      slide.addText(`(${idx + 1}/${chunks.length})`, { x: 12.4, y: 0.2, w: 0.8, h: 0.85, align: 'right', valign: 'middle', fontSize: 10, color: '666666' });

      const rows = [
        ['Category', 'Permit / License Description', 'Issuing Agency', 'Issue Date', 'Due Date', 'Current Status'].map(headerCells),
      ];
      for (const p of part) {
        const st = displayStatus(p);
        const meta = DISPLAY_META[st];
        const fill = st === 'ok' ? '2e9e44' : st === 'review' ? 'f5b400' : st === 'expired' ? 'd93025' : 'FFFFFF';
        const statusColor = st === 'review' ? '333333' : st === 'none' ? '1f2937' : 'FFFFFF';
        rows.push([
          { text: p.category, options: { fontSize: 9, bold: true, color: '003087', valign: 'middle' } },
          { text: fullDesc(p), options: { fontSize: 9, valign: 'middle' } },
          { text: p.issuing_agency || 'N/A', options: { fontSize: 9, valign: 'middle' } },
          { text: formatDate(p.issue_date), options: { fontSize: 9, align: 'center', valign: 'middle' } },
          { text: formatDate(p.due_date), options: { fontSize: 9, align: 'center', valign: 'middle' } },
          { text: meta.kor, options: { fontSize: 9, bold: true, align: 'center', valign: 'middle', color: statusColor, fill } },
        ]);
      }
      slide.addTable(rows, {
        x: 0.25, y: 1.15, w: 12.83, colW: [2.1, 4.3, 2.3, 1.2, 1.2, 1.73],
        border: { type: 'solid', color: 'C9D2DE', pt: 0.5 },
        rowH: 0.3,
      });

      // 범례 + 문구
      slide.addText(
        [
          { text: '■ ', options: { color: '2e9e44' } }, { text: 'Up to date    ', options: {} },
          { text: '■ ', options: { color: 'f5b400' } }, { text: 'Under renew/review    ', options: {} },
          { text: '■ ', options: { color: 'd93025' } }, { text: 'Out of date    ', options: {} },
          { text: '□ ', options: { color: '888888' } }, { text: 'Not applicable', options: {} },
        ],
        { x: 0.25, y: 6.6, w: 12.83, h: 0.3, fontSize: 10 }
      );
      slide.addText(
        `We commit to meet or exceed regulatory and company requirements consistent with Eaton's Policies on Ethics and compliance. Contact: ${contact}`,
        { x: 0.25, y: 6.95, w: 12.83, h: 0.3, fontSize: 9, color: '444444', italic: true }
      );
    });

    const fileName = `RTO_${site}_${new Date().toISOString().slice(0, 10)}.pptx`;
    await pptx.writeFile({ fileName });
  } catch (err) {
    alert('PPTX 저장 실패: ' + err.message);
  } finally {
    btn.textContent = '⬇ PPTX 저장';
    btn.disabled = false;
  }
}

// ---------- 연락처 인라인 수정 ----------
function setContactName(name) {
  contactEl.textContent = name || 'Inhee Park';
}

function editContactName() {
  const existing = contactEditor.querySelector('input');
  if (existing) { existing.focus(); existing.select(); return; }

  const current = settings.contact || 'Inhee Park';
  contactEl.hidden = true;

  const input = document.createElement('input');
  input.type = 'text';
  input.value = current;
  input.className = 'contact-input';
  input.maxLength = 80;
  input.setAttribute('aria-label', '담당 연락처');
  contactEditor.appendChild(input);
  input.focus();
  input.select();

  let cancelled = false;
  let saving = false;

  const cleanup = () => {
    input.remove();
    contactEl.hidden = false;
  };

  const save = async () => {
    if (cancelled || saving || !input.isConnected) return;
    const name = input.value.trim();
    if (!name || name === current) { cleanup(); return; }

    saving = true;
    input.disabled = true;
    try {
      settings.contact = name;
      setContactName(name);
      postData('save_settings', { settings });
    } catch (err) {
      alert('연락처 저장 실패: ' + err.message);
      setContactName(current);
    } finally {
      cleanup();
    }
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelled = true;
      cleanup();
      setContactName(current);
    }
  });
  input.addEventListener('blur', save);
}

// ---------- 전체화면 ----------
document.getElementById('btn-fullscreen').addEventListener('click', () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.();
  } else {
    document.exitFullscreen?.();
  }
});

// ---------- 화면 맞춤: 전체화면에서 스크롤 없이 상하좌우 꽉 차게 표시 ----------
function fitToScreen() {
  const wrap = document.getElementById('table-wrap');
  const table = document.getElementById('rto-table');
  if (!wrap || !table) return;

  const isFs = !!document.fullscreenElement;

  if (!isFs) {
    table.style.fontSize = '';
    table.style.removeProperty('--rto-pad-y');
    wrap.style.overflow = 'auto';
    return;
  }

  wrap.style.overflow = 'hidden';
  table.style.setProperty('--rto-pad-y', '0px');

  const cs = getComputedStyle(wrap);
  const availW = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const availH = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);

  // 한 줄(nowrap)을 유지한 채 가로/세로 모두 들어가는 최대 글자 크기 탐색
  let lo = 9, hi = 64, best = 9;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    table.style.fontSize = mid + 'px';
    if (table.scrollWidth <= availW && table.scrollHeight <= availH) {
      best = mid;
      lo = mid;
    } else {
      hi = mid;
    }
  }
  table.style.fontSize = best + 'px';

  // 남는 세로 공간은 셀 상하 패딩으로 채워 위아래도 꽉 차게
  const leftover = availH - table.scrollHeight;
  const rowCount = table.rows.length;
  let padY = rowCount > 0 ? leftover / (rowCount * 2) : 0;
  padY = Math.max(0, Math.min(padY, 24));
  table.style.setProperty('--rto-pad-y', padY + 'px');
}

window.addEventListener('resize', fitToScreen);
document.addEventListener('fullscreenchange', fitToScreen);

document.getElementById('btn-pptx').addEventListener('click', exportPptx);
contactEl.addEventListener('click', editContactName);
btnEditContact.addEventListener('click', editContactName);

// ---------- 시작 ----------
async function init() {
  try {
    await loadData();
    setConn(true);
  } catch (err) {
    tableBody.innerHTML = `<tr><td colspan="7" class="loading">데이터 로드 실패: ${escapeHtml(err.message)}<br>sheets-config.js 의 Apps Script URL을 확인하세요.</td></tr>`;
    setConn(false);
  }
  // 항시 표시 대비 주기적 재조회
  setInterval(async () => {
    try {
      await loadData();
      setConn(true);
    } catch (e) {
      setConn(false);
    }
  }, 60 * 1000);
}

init();
