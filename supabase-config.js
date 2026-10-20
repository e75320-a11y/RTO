// ============================================================================
// RTO 인허가 대시보드 - 공용 Supabase 설정
// Supabase 대시보드 → 좌측 ⚙️ 프로젝트 설정 → API 에서
// 'Project URL'과 'anon public' 키를 복사해 아래에 입력하세요.
// ============================================================================
const SUPABASE_URL = 'https://xinavsqxfzodhwwzmbki.supabase.co'; // ← Project URL
const SUPABASE_ANON_KEY = '여기에_ANON_PUBLIC_KEY_입력';          // ← anon public key

// Supabase SDK 로드 (CDN 장애 대비 다중 시도)
async function loadCreateClient() {
  const sources = [
    'https://esm.sh/@supabase/supabase-js@2.45.4',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm',
    'https://unpkg.com/@supabase/supabase-js@2.45.4/dist/module/index.js',
  ];
  for (const src of sources) {
    try {
      const mod = await import(/* @vite-ignore */ src);
      if (mod && typeof mod.createClient === 'function') return mod.createClient;
    } catch (e) {
      console.warn('Supabase SDK 로드 실패:', src, e);
    }
  }
  throw new Error('Supabase SDK를 불러오지 못했습니다. 인터넷 연결을 확인하세요.');
}

const createClient = await loadCreateClient();
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
export const SUPABASE_URL_VALUE = SUPABASE_URL;
