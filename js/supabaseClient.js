// Supabase 데이터 레이어 (설정이 안 되어 있으면 로컬 폴백으로 자동 전환)
import { INITIAL_REPORTS } from './mockData.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, IS_SUPABASE_CONFIGURED } from './config.js';

const STORAGE_KEY_REPORTS = 'gongcho_hunter_reports_v2';
const STORAGE_KEY_USERS = 'gongcho_hunter_local_users';
const STORAGE_KEY_SESSION = 'gongcho_hunter_local_session';

const AUTH_EMAIL_DOMAIN = '@gongchohunter.local';

let client = null;
if (IS_SUPABASE_CONFIGURED && window.supabase) {
  client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

export function isLive() {
  return client !== null;
}

/* ============================================================================
   인증 (아이디+비밀번호만 노출, 내부적으로 가상 이메일 매핑)
   ============================================================================ */
export async function signUp(username, password) {
  username = (username || '').trim();
  if (!username || !password) throw new Error('아이디와 비밀번호를 입력해주세요.');

  if (client) {
    const email = username + AUTH_EMAIL_DOMAIN;
    const { data, error } = await client.auth.signUp({ email, password });
    if (error) throw new Error(translateAuthError(error));

    const userId = data.user?.id;
    if (userId) {
      const { error: profileError } = await client.from('profiles').insert([{ id: userId, username }]);
      if (profileError && !profileError.message.includes('duplicate')) {
        throw new Error('회원 프로필 생성에 실패했습니다: ' + profileError.message);
      }
    }
    return getCurrentUser();
  }

  // 로컬 폴백 (개발 미리보기용)
  const users = getLocalUsers();
  if (users.some(u => u.username === username)) throw new Error('이미 존재하는 아이디입니다.');
  users.push({ username, password });
  localStorage.setItem(STORAGE_KEY_USERS, JSON.stringify(users));
  const session = { id: 'local-' + username, username };
  localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(session));
  return session;
}

export async function signIn(username, password) {
  username = (username || '').trim();
  if (!username || !password) throw new Error('아이디와 비밀번호를 입력해주세요.');

  if (client) {
    const email = username + AUTH_EMAIL_DOMAIN;
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw new Error(translateAuthError(error));
    return getCurrentUser();
  }

  const users = getLocalUsers();
  const found = users.find(u => u.username === username && u.password === password);
  if (!found) throw new Error('아이디 또는 비밀번호가 올바르지 않습니다.');
  const session = { id: 'local-' + username, username };
  localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(session));
  return session;
}

export async function signOut() {
  if (client) {
    await client.auth.signOut();
    return;
  }
  localStorage.removeItem(STORAGE_KEY_SESSION);
}

export async function getCurrentUser() {
  if (client) {
    const { data } = await client.auth.getUser();
    const user = data?.user;
    if (!user) return null;

    let username = user.email ? user.email.replace(AUTH_EMAIL_DOMAIN, '') : '헌터';
    const { data: profile } = await client.from('profiles').select('username, points, reports_count, is_admin').eq('id', user.id).maybeSingle();
    if (profile) username = profile.username;

    return { id: user.id, username, points: profile?.points || 0, reportsCount: profile?.reports_count || 0, isAdmin: profile?.is_admin || false };
  }

  const stored = localStorage.getItem(STORAGE_KEY_SESSION);
  return stored ? JSON.parse(stored) : null;
}

function getLocalUsers() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY_USERS)) || [];
  } catch (e) {
    return [];
  }
}

function translateAuthError(error) {
  const msg = error.message || '';
  if (msg.includes('already registered') || msg.includes('already been registered')) return '이미 존재하는 아이디입니다.';
  if (msg.includes('Invalid login credentials')) return '아이디 또는 비밀번호가 올바르지 않습니다.';
  if (msg.includes('Password should be')) return '비밀번호는 6자 이상이어야 합니다.';
  return msg || '요청 처리 중 오류가 발생했습니다.';
}

/* ============================================================================
   신고 데이터 조회/생성
   ============================================================================ */
export async function fetchReports() {
  if (client) {
    const { data: reports, error } = await client
      .from('reports')
      .select('*')
      .order('created_at', { ascending: false });

    if (error || !reports) {
      console.warn('Supabase fetch failed:', error);
      return [];
    }

    const { data: comments } = await client
      .from('comments')
      .select('*')
      .order('created_at', { ascending: true });

    return reports.map(item => ({
      id: item.id,
      userId: item.user_id,
      title: item.title,
      description: item.description,
      imageUrl: item.image_url,
      latitude: parseFloat(item.latitude),
      longitude: parseFloat(item.longitude),
      address: item.address,
      severity: item.severity || 'medium',
      userName: item.guest_name || null,
      likesCount: item.likes_count || 0,
      cleanupVotes: item.cleanup_votes || 0,
      createdAt: item.created_at,
      comments: (comments || [])
        .filter(c => c.report_id === item.id)
        .map(c => ({ id: c.id, author: c.author_name, text: c.text, time: formatRelativeTime(c.created_at) }))
    }));
  }

  return getLocalReports();
}

function getLocalReports() {
  const stored = localStorage.getItem(STORAGE_KEY_REPORTS);
  if (!stored) {
    localStorage.setItem(STORAGE_KEY_REPORTS, JSON.stringify(INITIAL_REPORTS));
    return INITIAL_REPORTS;
  }
  try {
    return JSON.parse(stored);
  } catch (e) {
    return INITIAL_REPORTS;
  }
}

function saveLocalReports(reports) {
  localStorage.setItem(STORAGE_KEY_REPORTS, JSON.stringify(reports));
}

export async function createReport({ title, description, address, severity, imageBlob, latitude, longitude, userId, displayName }) {
  if (client) {
    const path = `${userId || 'guest'}/${Date.now()}.webp`;
    const { error: uploadError } = await client.storage.from('report-photos').upload(path, imageBlob, {
      contentType: 'image/webp'
    });
    if (uploadError) throw new Error('사진 업로드에 실패했습니다: ' + uploadError.message);

    const { data: publicUrlData } = client.storage.from('report-photos').getPublicUrl(path);

    const { data, error } = await client
      .from('reports')
      .insert([{
        user_id: userId || null,
        guest_name: displayName || null,
        title,
        description: description || '',
        image_url: publicUrlData.publicUrl,
        latitude,
        longitude,
        address: address || '',
        severity: severity || 'medium'
      }])
      .select()
      .single();

    if (error) throw new Error('신고 등록에 실패했습니다: ' + error.message);
    return data;
  }

  // 로컬 폴백: base64로 저장
  const { blobToDataURL } = await import('./imageUtils.js');
  const imageUrl = await blobToDataURL(imageBlob);

  const reports = getLocalReports();
  const newReport = {
    id: 'rep-' + Date.now(),
    userId: userId || null,
    title,
    description: description || '',
    imageUrl,
    latitude,
    longitude,
    address: address || '',
    severity: severity || 'medium',
    userName: displayName || null,
    likesCount: 0,
    cleanupVotes: 0,
    createdAt: new Date().toISOString(),
    comments: []
  };
  saveLocalReports([newReport, ...reports]);
  return newReport;
}

export async function toggleLikeReport(reportId, userId) {
  if (client) {
    const { error } = await client.from('report_likes').insert([{ report_id: reportId, user_id: userId || null }]);
    if (error) console.warn('like insert failed:', error);
    return fetchReports();
  }

  const reports = getLocalReports();
  const item = reports.find(r => r.id === reportId);
  if (item) item.likesCount = (item.likesCount || 0) + 1;
  saveLocalReports(reports);
  return reports;
}

export async function voteCleanupReport(reportId, userId) {
  if (client) {
    const { error } = await client.from('report_cleanup_votes').insert([{ report_id: reportId, user_id: userId || null }]);
    if (error) console.warn('cleanup vote insert failed:', error);
    return fetchReports();
  }

  const reports = getLocalReports();
  const item = reports.find(r => r.id === reportId);
  if (item) item.cleanupVotes = (item.cleanupVotes || 0) + 1;
  saveLocalReports(reports);
  return reports;
}

export async function addCommentToReport(reportId, commentText, authorName = '시민 헌터', userId = null) {
  if (client) {
    const { error } = await client.from('comments').insert([{
      report_id: reportId,
      user_id: userId,
      author_name: authorName,
      text: commentText
    }]);
    if (error) console.warn('comment insert failed:', error);
    return fetchReports();
  }

  const reports = getLocalReports();
  const item = reports.find(r => r.id === reportId);
  if (item) {
    if (!item.comments) item.comments = [];
    item.comments.push({ id: 'c-' + Date.now(), author: authorName, text: commentText, time: '방금 전' });
  }
  saveLocalReports(reports);
  return reports;
}

/* ============================================================================
   랭킹
   ============================================================================ */
export async function fetchMonthlyLeaderboard() {
  if (client) {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const { data, error } = await client
      .from('point_events')
      .select('user_id, amount')
      .gte('created_at', startOfMonth.toISOString());

    if (error || !data) return [];

    const totals = {};
    data.forEach(e => { totals[e.user_id] = (totals[e.user_id] || 0) + e.amount; });

    const userIds = Object.keys(totals);
    if (userIds.length === 0) return [];

    const { data: profiles } = await client.from('profiles').select('id, username').in('id', userIds);
    const nameMap = {};
    (profiles || []).forEach(p => { nameMap[p.id] = p.username; });

    return Object.entries(totals)
      .map(([userId, points]) => ({ username: nameMap[userId] || '알 수 없음', points }))
      .sort((a, b) => b.points - a.points)
      .slice(0, 10);
  }

  // 로컬 폴백: 이번 달 신고 건수 * 10점으로 근사
  const reports = getLocalReports();
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const totals = {};
  reports.forEach(r => {
    if (r.userName && new Date(r.createdAt) >= startOfMonth) {
      totals[r.userName] = (totals[r.userName] || 0) + 10;
    }
  });

  return Object.entries(totals)
    .map(([username, points]) => ({ username, points }))
    .sort((a, b) => b.points - a.points)
    .slice(0, 10);
}

function formatRelativeTime(isoString) {
  if (!isoString) return '방금 전';
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${Math.max(1, minutes)}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  return `${days}일 전`;
}

/* ============================================================================
   관리자 (admin.html 전용) - anon key + is_admin RLS 정책으로 동작, 서버 불필요
   ============================================================================ */
export async function adminFetchAllReports() {
  if (!client) return [];
  const { data, error } = await client
    .from('reports')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(300);
  if (error || !data) return [];
  return data;
}

export async function adminUpdateReport(id, { title, description, severity, address }) {
  if (!client) throw new Error('Supabase가 연동되어 있지 않습니다.');
  const { error } = await client
    .from('reports')
    .update({ title, description, severity, address })
    .eq('id', id);
  if (error) throw new Error('수정에 실패했습니다: ' + error.message);
}

export async function adminDeleteReport(id, imageUrl) {
  if (!client) throw new Error('Supabase가 연동되어 있지 않습니다.');

  if (imageUrl) {
    const marker = '/report-photos/';
    const idx = imageUrl.indexOf(marker);
    if (idx !== -1) {
      const objectPath = imageUrl.slice(idx + marker.length);
      await client.storage.from('report-photos').remove([objectPath]).catch(() => {});
    }
  }

  const { error } = await client.from('reports').delete().eq('id', id);
  if (error) throw new Error('삭제에 실패했습니다: ' + error.message);
}
