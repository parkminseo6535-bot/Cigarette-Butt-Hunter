<?php
// 관리자 전용 설정 파일 - 서버에서만 실행되며 브라우저로는 절대 노출되지 않습니다.
// (PHP가 정상 동작하는 서버에 올려야 안전합니다. 이 파일을 다른 사람과 공유하지 마세요.)

// Supabase Project Settings > API 에서 확인한 값을 입력하세요.
$SUPABASE_URL = '';

// anon key가 아니라 "service_role" (secret) 키입니다. 이 키는 모든 데이터를 무제한으로
// 읽고 쓸 수 있으므로 절대 js/config.js 나 프론트엔드 코드에 넣지 말고 이 파일에만 두세요.
$SUPABASE_SERVICE_ROLE_KEY = '';

// 관리자 로그인 비밀번호 (필요하면 여기서 변경하세요)
$ADMIN_PASSWORD = 'qkralstj1!';
