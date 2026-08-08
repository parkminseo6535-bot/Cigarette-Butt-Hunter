// 꽁초헌터 Supabase 연결 설정
// schema.sql을 Supabase 프로젝트에 실행한 뒤, 아래 두 값을 채워 넣고 배포하세요.
// Project Settings > API 메뉴에서 Project URL / anon public key를 확인할 수 있습니다.
// (anon key는 공개되어도 안전하도록 설계되어 있습니다 - schema.sql의 RLS 정책이 권한을 제어합니다.)

export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';

export const IS_SUPABASE_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
