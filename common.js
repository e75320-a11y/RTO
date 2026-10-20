// ============================================================================
// RTO 인허가 대시보드 - 공용 헬퍼 (디스플레이/관리자 공유)
// ============================================================================
export const STATUS_META = {
  ok: { kor: '최신 상태', eng: 'Up to date', color: '#2e9e44' },
  review: { kor: '갱신·검토 중', eng: 'Under renew / review', color: '#f5b400' },
  expired: { kor: '만료', eng: 'Out of date', color: '#d93025' },
};

export function parseDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr.length === 10 ? dateStr + 'T00:00:00' : dateStr);
  return isNaN(d.getTime()) ? null : d;
}

export function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// 만료일까지 남은 일수 (음수 = 이미 만료)
export function daysUntil(dateStr, today = new Date()) {
  const d = parseDate(dateStr);
  if (!d) return null;
  return Math.floor((startOfDay(d) - startOfDay(today)) / 86400000);
}

// 상태 계산: 수동 지정 > 만료 > 검토(alertDays 이내) > 정상
export function computeStatus(permit, alertDays = 60, today = new Date()) {
  if (permit.status_override) return permit.status_override;
  if (!permit.due_date) return 'ok';
  const days = daysUntil(permit.due_date, today);
  if (days < 0) return 'expired';
  if (days <= alertDays) return 'review';
  return 'ok';
}

export function formatDate(dateStr) {
  if (!dateStr) return 'N/A';
  const d = parseDate(dateStr);
  if (!d) return dateStr;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// 알림 버킷 결정: 아직 발송하지 않은 가장 큰(가장 먼저 도달한) 알림 시점 문자열 반환
// buckets 예: [60,30,14,7] (만료 D-N). 이미 지났으면 'overdue'.
export function notificationBucket(dueDate, buckets, today = new Date()) {
  if (!dueDate) return null;
  const days = daysUntil(dueDate, today);
  if (days === null) return null;
  if (days < 0) return 'overdue';
  const sorted = [...buckets].sort((a, b) => b - a);
  for (const b of sorted) {
    if (days <= b) return String(b);
  }
  return null;
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function fullDesc(p) {
  return p.description_en ? `${p.description} (${p.description_en})` : p.description;
}
