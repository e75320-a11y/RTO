// ============================================================================
// RTO 관리자 화면
// - 인허가 CRUD (팀장은 즉시 반영, 일반 사용자는 승인 요청)
// - 팀장 승인 워크플로우 + 변경 이력
// - 담당자/설정 관리
// - 만료 알림 수동 발송(Google Apps Script 연동)
// ============================================================================
import { loadAppData, postData } from './sheets.js';
import {
  STATUS_META, computeStatus, formatDate, fullDesc, escapeHtml,
  daysUntil, notificationBucket,
} from './common.js';

const CATEGORY_ORDER = ['Mandated Licenses/Permits', 'Localized Licenses/Permits'];
const ACTION_LABEL = { create: '등록', update: '수정', delete: '삭제' };

let settings = {};
let permits = [];
let assignees = [];
let changeRequests = [];
let changeLog = [];
let alertDays = 60;
let reminderBuckets = [60, 30, 14, 7];

// 중복 클릭 방지
let savingPermit = false;
const processingRequests = new Set();
const deletingPermits = new Set();

const user = {
  get name() { return document.getElementById('user-name').value.trim(); },
  get email() { return document.getElementById('user-email').value.trim(); },
};

const $ = (sel) => document.querySelector(sel);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function newId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// ---------- 유저 식별 ----------
function loadUser() {
  try {
    const saved = JSON.parse(localStorage.getItem('rto_user') || '{}');
    if (saved.name) $('#user-name').value = saved.name;
    if (saved.email) $('#user-email').value = saved.email;
  } catch {}
}
function saveUser() {
  localStorage.setItem('rto_user', JSON.stringify({ name: user.name, email: user.email }));
  updateRoleBadge();
}
function isLead() {
  const lead = (settings.lead_email || '').trim().toLowerCase();
  return !!lead && user.email.toLowerCase() === lead;
}
function updateRoleBadge() {
  const b = $('#role-badge');
  b.textContent = isLead() ? '팀장' : '일반';
  b.className = 'role-badge' + (isLead() ? ' lead' : '');
}

// ---------- 로드 ----------
async function loadAll() {
  const data = await loadAppData();
  settings = data.settings || {};
  permits = data.permits || [];
  changeRequests = data.change_requests || [];
  changeLog = data.change_log || [];
  deriveAssignees();

  alertDays = parseInt(settings.alert_days ?? '60', 10) || 60;
  reminderBuckets = String(settings.reminder_buckets ?? '60,30,14,7')
    .split(',').map((x) => parseInt(x, 10)).filter((n) => !isNaN(n));

  const banner = $('#conn-banner');
  banner.hidden = true;
  updateRoleBadge();
  fillSettingsForm();
  renderPermits();
  renderChangeRequests(changeRequests);
  renderChangeLog(changeLog);
  renderAssignees();
}

function deriveAssignees() {
  const map = new Map();
  for (const p of permits) {
    const email = (p.assignee_email || '').trim().toLowerCase();
    const name = (p.assignee_name || '').trim();
    if (!email) continue;
    if (!map.has(email)) map.set(email, { id: email, name: name || email, email, role: 'member' });
  }
  assignees = [...map.values()];
}

// ---------- 렌더: 인허가 목록 ----------
function sortedPermits() {
  return [...permits].sort((a, b) => {
    const ca = CATEGORY_ORDER.indexOf(a.category);
    const cb = CATEGORY_ORDER.indexOf(b.category);
    if (ca !== cb) return (ca < 0 ? 99 : ca) - (cb < 0 ? 99 : cb);
    return (a.sort_order ?? 0) - (b.sort_order ?? 0);
  });
}

function renderPermits() {
  const filter = $('#filter-category').value;
  const list = sortedPermits().filter((p) => p.active !== false && (!filter || p.category === filter));
  const body = $('#permits-body');
  if (!list.length) {
    body.innerHTML = '<tr><td colspan="8" style="color:#888">등록된 인허가가 없습니다.</td></tr>';
    return;
  }
  body.innerHTML = list.map((p) => {
    const st = computeStatus(p, alertDays);
    const meta = STATUS_META[st] ?? STATUS_META.ok;
    return `<tr>
      <td>${escapeHtml(p.category)}</td>
      <td>${escapeHtml(fullDesc(p))}</td>
      <td>${escapeHtml(p.issuing_agency || 'N/A')}</td>
      <td>${formatDate(p.issue_date)}</td>
      <td>${formatDate(p.due_date)}</td>
      <td><span class="status-badge ${st}">${meta.kor}</span></td>
      <td>${escapeHtml(p.assignee_name || '-')}<br><small>${escapeHtml(p.assignee_email || '')}</small></td>
      <td class="nowrap">
        <button class="btn small" data-edit="${p.id}">수정</button>
        <button class="btn small danger" data-del="${p.id}">삭제</button>
      </td>
    </tr>`;
  }).join('');

  body.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openDialog(permits.find((x) => x.id === b.dataset.edit))));
  body.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => requestDelete(permits.find((x) => x.id === b.dataset.del))));
}

// ---------- 렌더: 변경 요청 ----------
function renderChangeRequests(reqs) {
  const pending = reqs.filter((r) => r.status === 'pending');
  const badge = $('#req-badge');
  badge.hidden = !pending.length;
  badge.textContent = pending.length;

  const body = $('#requests-body');
  if (!reqs.length) {
    body.innerHTML = '<tr><td colspan="6" style="color:#888">변경 요청이 없습니다.</td></tr>';
    return;
  }
  body.innerHTML = reqs.map((r) => {
    const name = r.proposed_data?.description || r.proposed_data?.description_en || '(내용 없음)';
    const buttons = (r.status === 'pending' && isLead())
      ? `<button class="btn small primary" data-approve="${r.id}">승인</button>
         <button class="btn small danger" data-reject="${r.id}">거절</button>`
      : '';
    return `<tr>
      <td>${formatDateTime(r.created_at)}</td>
      <td>${ACTION_LABEL[r.action] || r.action}</td>
      <td>${escapeHtml(String(name))}</td>
      <td>${escapeHtml(r.requested_by || '-')}<br><small>${escapeHtml(r.requested_by_email || '')}</small></td>
      <td><span class="req-badge ${r.status}">${reqStatus(r.status)}</span></td>
      <td class="nowrap">${buttons}</td>
    </tr>`;
  }).join('');

  body.querySelectorAll('[data-approve]').forEach((b) => b.addEventListener('click', () => approveRequest(reqs.find((x) => x.id === b.dataset.approve))));
  body.querySelectorAll('[data-reject]').forEach((b) => b.addEventListener('click', () => rejectRequest(reqs.find((x) => x.id === b.dataset.reject))));
}

function reqStatus(s) {
  return { pending: '승인 대기', approved: '승인됨', rejected: '거절됨' }[s] || s;
}

// ---------- 렌더: 변경 이력 ----------
function renderChangeLog(logs) {
  const body = $('#history-body');
  if (!logs.length) {
    body.innerHTML = '<tr><td colspan="5" style="color:#888">변경 이력이 없습니다.</td></tr>';
    return;
  }
  body.innerHTML = logs.map((l) => {
    const d = l.details || {};
    const name = d.description || d.description_en || '(내용 없음)';
    const summary = summarizeDetails(l.action, d);
    return `<tr>
      <td>${formatDateTime(l.created_at)}</td>
      <td>${ACTION_LABEL[l.action] || l.action}</td>
      <td>${escapeHtml(String(name))}</td>
      <td>${escapeHtml(summary)}</td>
      <td>${escapeHtml(l.changed_by || '-')}<br><small>${escapeHtml(l.changed_by_email || '')}</small></td>
    </tr>`;
  }).join('');
}

function summarizeDetails(action, d) {
  if (action === 'delete') return '비활성화(보관)';
  const parts = [];
  if (d.due_date) parts.push(`만료일 ${d.due_date}`);
  if (d.issuing_agency) parts.push(`기관 ${d.issuing_agency}`);
  if (d.assignee_email) parts.push(`담당 ${d.assignee_email}`);
  return parts.join(' · ') || '-';
}

// ---------- 렌더: 담당자 ----------
function renderAssignees() {
  const body = $('#assignees-body');
  if (!assignees.length) {
    body.innerHTML = '<tr><td colspan="3" style="color:#888">등록된 담당자가 없습니다.</td></tr>';
    return;
  }
  const leadEmail = (settings.lead_email || '').trim().toLowerCase();
  body.innerHTML = assignees.map((a) => `<tr>
    <td>${escapeHtml(a.name)}</td>
    <td>${escapeHtml(a.email)}</td>
    <td>${a.email === leadEmail ? '팀장' : '일반'}</td>
  </tr>`).join('');
}

// ---------- 변경 적용 (메모리 반영 + 시트 저장) ----------
function persistPermits() { return postData('save_permits', { permits }); }
function persistSettings() { return postData('save_settings', { settings }); }
function persistChangeRequests() { return postData('save_change_requests', { change_requests: changeRequests }); }
function persistChangeLog() { return postData('save_change_log', { change_log: changeLog }); }

async function refreshAll() {
  await delay(700); // no-cors 요청이 서버에 반영될 시간 확보
  await loadAll();
}

async function applyChange(action, permitId, data, byName, byEmail) {
  let pid = permitId;
  if (action === 'create') {
    pid = newId();
    const maxSort = permits.reduce((m, p) => Math.max(m, Number(p.sort_order || 0)), 0);
    permits.push({ id: pid, active: true, ...data, sort_order: maxSort + 10 });
  } else if (action === 'update') {
    const p = permits.find((x) => x.id === pid);
    if (p) Object.assign(p, data);
  } else if (action === 'delete') {
    const p = permits.find((x) => x.id === pid);
    if (p) p.active = false;
  }

  changeLog.unshift({
    id: newId(),
    permit_id: pid,
    action,
    details: data,
    changed_by: byName,
    changed_by_email: byEmail,
    created_at: new Date().toISOString(),
  });

  await persistPermits();
  await persistChangeLog();
  return pid;
}

// ---------- 폼 ----------
function openDialog(permit) {
  const form = $('#permit-form');
  form.reset();
  $('#btn-save').disabled = false;
  $('#dialog-title').textContent = permit ? '인허가 수정' : '새 인허가 등록';
  form.elements.id.value = permit?.id || '';
  if (permit) {
    form.elements.category.value = permit.category;
    form.elements.description.value = permit.description || '';
    form.elements.description_en.value = permit.description_en || '';
    form.elements.issuing_agency.value = permit.issuing_agency || '';
    form.elements.issue_date.value = permit.issue_date || '';
    form.elements.due_date.value = permit.due_date || '';
    form.elements.status_override.value = permit.status_override || '';
    form.elements.assignee_name.value = permit.assignee_name || '';
    form.elements.assignee_email.value = permit.assignee_email || '';
    form.elements.sort_order.value = permit.sort_order ?? 0;
  }
  const dueNone = $('#due-none');
  dueNone.checked = !!permit && !permit.due_date;
  form.elements.due_date.disabled = dueNone.checked;
  if (dueNone.checked) form.elements.due_date.value = '';

  const issueNone = $('#issue-none');
  issueNone.checked = !!permit && !permit.issue_date;
  form.elements.issue_date.disabled = issueNone.checked;
  if (issueNone.checked) form.elements.issue_date.value = '';

  buildAssigneeDatalist();
  $('#permit-dialog').showModal();
}

function buildAssigneeDatalist() {
  let dl = document.getElementById('assignee-emails');
  if (!dl) {
    dl = document.createElement('datalist');
    dl.id = 'assignee-emails';
    document.body.appendChild(dl);
  }
  dl.innerHTML = assignees.map((a) => `<option value="${escapeHtml(a.email)}">${escapeHtml(a.name)}</option>`).join('');
  const emailInput = $('#permit-form').elements.assignee_email;
  emailInput.setAttribute('list', 'assignee-emails');
  emailInput.oninput = () => {
    const a = assignees.find((x) => x.email.toLowerCase() === emailInput.value.trim().toLowerCase());
    if (a) $('#permit-form').elements.assignee_name.value = a.name;
  };
}

function formToPayload(form) {
  const f = form.elements;
  const str = (k) => {
    const v = f[k]?.value;
    return (v === undefined || v === null || String(v).trim() === '') ? null : String(v).trim();
  };
  return {
    category: str('category') || 'Mandated Licenses/Permits',
    description: str('description'),
    description_en: str('description_en'),
    issuing_agency: str('issuing_agency'),
    issue_date: $('#issue-none').checked ? null : str('issue_date'),
    due_date: $('#due-none').checked ? null : str('due_date'),
    status_override: str('status_override'),
    assignee_name: str('assignee_name'),
    assignee_email: str('assignee_email'),
    sort_order: parseInt(f.sort_order?.value || '0', 10) || 0,
  };
}

async function onSave(e) {
  e.preventDefault();
  if (savingPermit) return;
  const form = $('#permit-form');
  const payload = formToPayload(form);
  if (!payload.description) { alert('인허가명(한글)은 필수입니다.'); return; }
  const id = form.elements.id.value || null;
  const note = form.elements.note?.value || '';
  const action = id ? 'update' : 'create';

  const btn = $('#btn-save');
  savingPermit = true;
  btn.disabled = true;
  try {
    if (isLead()) {
      await applyChange(action, id, payload, user.name, user.email);
      alert('변경이 즉시 반영되었습니다.');
    } else {
      changeRequests.unshift({
        id: newId(),
        permit_id: id,
        action,
        proposed_data: payload,
        requested_by: user.name,
        requested_by_email: user.email,
        note,
        status: 'pending',
        created_at: new Date().toISOString(),
      });
      await persistChangeRequests();
      postData('notify_change_request', {
        site: settings.site_name || 'Pyungtek',
        lead_email: settings.lead_email || '',
        request: {
          action,
          proposed_data: payload,
          requested_by: user.name,
          requested_by_email: user.email,
          note,
        },
      });
      alert('팀장 승인 요청이 등록되었습니다.');
    }
    $('#permit-dialog').close();
    await refreshAll();
  } catch (err) {
    alert('저장 실패: ' + err.message);
  } finally {
    savingPermit = false;
    btn.disabled = false;
  }
}

async function requestDelete(permit) {
  if (!permit) return;
  if (deletingPermits.has(permit.id)) return;
  deletingPermits.add(permit.id);
  try {
    if (!confirm(`"${fullDesc(permit)}" 항목을 삭제 요청할까요?`)) return;
    const payload = { description: permit.description, description_en: permit.description_en };
    if (isLead()) {
      await applyChange('delete', permit.id, payload, user.name, user.email);
      alert('삭제되었습니다.');
    } else {
      changeRequests.unshift({
        id: newId(),
        permit_id: permit.id,
        action: 'delete',
        proposed_data: payload,
        requested_by: user.name,
        requested_by_email: user.email,
        note: '',
        status: 'pending',
        created_at: new Date().toISOString(),
      });
      await persistChangeRequests();
      postData('notify_change_request', {
        site: settings.site_name || 'Pyungtek',
        lead_email: settings.lead_email || '',
        request: {
          action: 'delete',
          proposed_data: payload,
          requested_by: user.name,
          requested_by_email: user.email,
          note: '',
        },
      });
      alert('팀장 삭제 승인 요청이 등록되었습니다.');
    }
    await refreshAll();
  } catch (err) {
    alert('삭제 실패: ' + err.message);
  } finally {
    deletingPermits.delete(permit.id);
  }
}

// ---------- 승인/거절 ----------
async function approveRequest(req) {
  if (!req || processingRequests.has(req.id)) return;
  processingRequests.add(req.id);
  try {
    await applyChange(req.action, req.permit_id, req.proposed_data || {}, req.requested_by, req.requested_by_email);
    const r = changeRequests.find((x) => x.id === req.id);
    if (r) {
      r.status = 'approved';
      r.reviewed_by = user.name;
      r.reviewed_at = new Date().toISOString();
    }
    await persistChangeRequests();
    await refreshAll();
  } catch (err) {
    alert('승인 처리 실패: ' + err.message);
  } finally {
    processingRequests.delete(req.id);
  }
}

async function rejectRequest(req) {
  if (!req || processingRequests.has(req.id)) return;
  processingRequests.add(req.id);
  try {
    const reason = prompt('거절 사유를 입력하세요:', '');
    if (reason === null) return;
    const r = changeRequests.find((x) => x.id === req.id);
    if (r) {
      r.status = 'rejected';
      r.reject_reason = reason;
      r.reviewed_by = user.name;
      r.reviewed_at = new Date().toISOString();
    }
    await persistChangeRequests();
    await refreshAll();
  } catch (err) {
    alert('거절 처리 실패: ' + err.message);
  } finally {
    processingRequests.delete(req.id);
  }
}

// ---------- 만료 알림 ----------
async function triggerNotifications() {
  const resultEl = $('#notify-result');
  const due = permits.filter((p) => p.active !== false && p.due_date && p.assignee_email);
  const items = due
    .filter((p) => ['review', 'expired'].includes(computeStatus(p, alertDays)))
    .map((p) => ({
      permit_id: p.id,
      description: fullDesc(p),
      assignee_name: p.assignee_name || '',
      assignee_email: p.assignee_email,
      due_date: p.due_date,
      days_left: daysUntil(p.due_date),
      bucket: notificationBucket(p.due_date, reminderBuckets) || 'manual',
    }));

  if (!items.length) {
    resultEl.textContent = '현재 만료 알림 대상이 없습니다.';
    return;
  }

  resultEl.textContent = '전송 중…';
  try {
    await postData('notify', {
      site: settings.site_name || 'Pyungtek',
      lead_email: settings.lead_email || '',
      items,
    });
    resultEl.textContent = `요청 전송됨: ${items.length}건 (Apps Script 실행 로그/알림로그에서 확인)`;
  } catch (err) {
    resultEl.textContent = '전송 실패: ' + err.message;
  }
}

// ---------- 설정 ----------
function fillSettingsForm() {
  const form = $('#settings-form');
  for (const el of form.elements) {
    if (el.name && settings[el.name] !== undefined) el.value = settings[el.name];
  }
}

async function onSaveSettings(e) {
  e.preventDefault();
  const form = $('#settings-form');
  const resultEl = $('#settings-result');
  resultEl.textContent = '저장 중…';
  try {
    const next = {};
    for (const el of form.elements) {
      if (!el.name) continue;
      next[el.name] = el.value;
    }
    settings = next;
    await persistSettings();
    resultEl.textContent = '저장 완료';
    setTimeout(() => { resultEl.textContent = ''; }, 2000);
    await refreshAll();
  } catch (err) {
    resultEl.textContent = '저장 실패: ' + err.message;
  }
}

async function onTestEmail() {
  const resultEl = $('#test-mail-result');
  const recipients = [];
  if ($('#test-mail-lead').checked) recipients.push('lead');
  if ($('#test-mail-assignees').checked) recipients.push('assignees');

  if (!recipients.length) { resultEl.textContent = '수신 대상을 선택하세요.'; return; }
  if (recipients.includes('lead') && !(settings.lead_email || '').trim()) {
    resultEl.textContent = '팀장 이메일이 설정되지 않았습니다.';
    return;
  }
  if (recipients.includes('assignees') && !assignees.length) {
    resultEl.textContent = '담당자가 없습니다.';
    return;
  }

  resultEl.textContent = '발송 중…';
  try {
    await postData('test_email', {
      site: settings.site_name || 'Pyungtek',
      lead_email: settings.lead_email || '',
      recipients,
      assignee_emails: assignees.map((a) => a.email),
    });
    resultEl.textContent = '시험 메일 발송 요청 완료 — 수신함/Apps Script 실행 로그에서 확인';
  } catch (err) {
    resultEl.textContent = '발송 실패: ' + err.message;
  }
}

// ---------- 탭 ----------
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    $('#panel-' + tab.dataset.tab).classList.add('active');
  });
});

// ---------- 기타 이벤트 ----------
$('#btn-add').addEventListener('click', () => openDialog(null));
$('#btn-cancel').addEventListener('click', () => $('#permit-dialog').close());
$('#permit-form').addEventListener('submit', onSave);
$('#btn-notify').addEventListener('click', triggerNotifications);
$('#filter-category').addEventListener('change', renderPermits);
$('#due-none').addEventListener('change', () => {
  const dueInput = $('#permit-form').elements.due_date;
  dueInput.disabled = $('#due-none').checked;
  if ($('#due-none').checked) dueInput.value = '';
});
$('#issue-none').addEventListener('change', () => {
  const issueInput = $('#permit-form').elements.issue_date;
  issueInput.disabled = $('#issue-none').checked;
  if ($('#issue-none').checked) issueInput.value = '';
});
$('#settings-form').addEventListener('submit', onSaveSettings);
$('#btn-test-mail').addEventListener('click', onTestEmail);
$('#user-name').addEventListener('change', saveUser);
$('#user-email').addEventListener('change', saveUser);

function formatDateTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ---------- 시작 ----------
async function init() {
  loadUser();
  try {
    await loadAll();
  } catch (err) {
    $('#conn-banner').hidden = false;
    alert('초기 로드 실패: ' + err.message + '\nsheets-config.js 의 Apps Script URL을 확인하세요.');
    return;
  }
  // 다른 탭에서 바뀐 내용을 주기적으로 반영
  setInterval(() => loadAll().catch(() => { $('#conn-banner').hidden = false; }), 60 * 1000);
}

init();
