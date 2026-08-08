// 꽁초헌터 앱 로직 (Leaflet 지도 고정, 회원 시스템, 포인트/랭킹)
import {
  fetchReports,
  createReport,
  toggleLikeReport,
  voteCleanupReport,
  updateReportStatus,
  addCommentToReport,
  signUp,
  signIn,
  signOut,
  getCurrentUser,
  fetchMonthlyLeaderboard
} from './supabaseClient.js';
import { compressImageToWebP } from './imageUtils.js';
import { extractGpsFromImage } from './exifGps.js';

const LIGHT_TILE_URL = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
const LIGHT_TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';
const DEFAULT_CENTER = { lat: 37.5665, lng: 126.9780 }; // 서울시청 기본 좌표

const state = {
  activeView: 'map',
  feedLayout: 'grid',
  reports: [],
  filteredReports: [],
  filterSeverity: 'all',
  searchQuery: '',
  selectedReport: null,
  newReportPhotoBlob: null,
  newReportCoords: { ...DEFAULT_CENTER },
  map: null,
  mapMarkers: [],
  pickerMap: null,
  pickerMarker: null,
  currentUser: null,
  authMode: 'login' // 'login' | 'signup'
};

document.addEventListener('DOMContentLoaded', async () => {
  state.currentUser = await getCurrentUser();
  updateAuthUI();

  await loadAndRenderData();
  setupEventListeners();
  initMap();
});

async function loadAndRenderData() {
  state.reports = await fetchReports();
  applyFilters();
  renderStats();
}

function applyFilters() {
  state.filteredReports = state.reports.filter(report => {
    const severityMatch = state.filterSeverity === 'all' || report.severity === state.filterSeverity;

    let searchMatch = true;
    if (state.searchQuery.trim() !== '') {
      const q = state.searchQuery.toLowerCase();
      searchMatch = (report.title || '').toLowerCase().includes(q) ||
                    (report.address || '').toLowerCase().includes(q) ||
                    (report.description || '').toLowerCase().includes(q) ||
                    (report.userName || '').toLowerCase().includes(q);
    }
    return severityMatch && searchMatch;
  });

  if (state.activeView === 'map') updateMapMarkers();
  else renderFeedView();
}

function renderStats() {
  const total = state.reports.length;
  const cleaned = state.reports.filter(r => r.status === 'cleaned').length;

  document.getElementById('statTotal').innerText = total + '건';
  document.getElementById('statCleaned').innerText = cleaned + '곳';

  const myPointsEl = document.getElementById('statMyPoints');
  const myPointsWrap = document.getElementById('statMyPointsWrap');
  if (state.currentUser) {
    myPointsWrap.style.display = 'flex';
    myPointsEl.innerText = (state.currentUser.points || 0) + 'P';
  } else {
    myPointsWrap.style.display = 'none';
  }
}

/* ==========================================================================
   지도 (Leaflet 고정, 라이트 타일)
   ========================================================================== */
function initMap() {
  const container = document.getElementById('map');
  if (!container || !window.L) return;

  const centerLat = state.reports.length > 0 ? state.reports[0].latitude : DEFAULT_CENTER.lat;
  const centerLng = state.reports.length > 0 ? state.reports[0].longitude : DEFAULT_CENTER.lng;

  state.map = L.map('map', { zoomControl: false }).setView([centerLat, centerLng], 13);
  L.control.zoom({ position: 'topright' }).addTo(state.map);
  L.tileLayer(LIGHT_TILE_URL, { maxZoom: 19, attribution: LIGHT_TILE_ATTRIBUTION }).addTo(state.map);

  updateMapMarkers();
}

function updateMapMarkers() {
  if (!state.map) return;

  state.mapMarkers.forEach(m => state.map.removeLayer(m));
  state.mapMarkers = [];

  state.filteredReports.forEach(report => {
    const pinClass = report.status === 'cleaned' ? 'pin-cleaned' : `pin-${report.severity}`;

    const customIcon = L.divIcon({
      className: 'custom-pin-wrapper',
      html: `<div class="custom-pin ${pinClass}"></div>`,
      iconSize: [34, 34],
      iconAnchor: [17, 34],
      popupAnchor: [0, -30]
    });

    const marker = L.marker([report.latitude, report.longitude], { icon: customIcon }).addTo(state.map);

    const popupHtml = `
      <div class="popup-card">
        <div class="popup-img-wrapper">
          <img src="${report.imageUrl}" class="popup-img" alt="${escapeHtml(report.title)}" />
        </div>
        <div class="popup-body">
          <div class="popup-badge-row">
            <span class="badge badge-${report.severity}">${severityLabel(report.severity)}</span>
            <span class="popup-likes">❤ ${report.likesCount || 0}</span>
          </div>
          <h4 class="popup-title">${escapeHtml(report.title)}</h4>
          <p class="popup-address">${escapeHtml(report.address || '위치 정보 없음')}</p>
          <button class="popup-btn" onclick="window.openDetailModalFromId('${report.id}')">자세히 보기</button>
        </div>
      </div>
    `;

    marker.bindPopup(popupHtml);
    state.mapMarkers.push(marker);
  });
}

function initPickerMap() {
  const container = document.getElementById('pickerMap');
  if (!container) return;

  if (!state.pickerMap) {
    state.pickerMap = L.map('pickerMap', { zoomControl: false }).setView([state.newReportCoords.lat, state.newReportCoords.lng], 15);
    L.tileLayer(LIGHT_TILE_URL, { maxZoom: 19, attribution: LIGHT_TILE_ATTRIBUTION }).addTo(state.pickerMap);
    state.pickerMarker = L.marker([state.newReportCoords.lat, state.newReportCoords.lng], { draggable: true }).addTo(state.pickerMap);

    state.pickerMarker.on('dragend', (e) => {
      const latlng = e.target.getLatLng();
      state.newReportCoords = { lat: latlng.lat, lng: latlng.lng };
      updateAddressField(latlng.lat, latlng.lng);
    });

    state.pickerMap.on('click', (e) => {
      state.pickerMarker.setLatLng(e.latlng);
      state.newReportCoords = { lat: e.latlng.lat, lng: e.latlng.lng };
      updateAddressField(e.latlng.lat, e.latlng.lng);
    });
  } else {
    state.pickerMap.setView([state.newReportCoords.lat, state.newReportCoords.lng], 15);
    state.pickerMarker.setLatLng([state.newReportCoords.lat, state.newReportCoords.lng]);
    state.pickerMap.invalidateSize();
  }
}

function movePickerTo(lat, lng, zoom = 16) {
  state.newReportCoords = { lat, lng };
  if (state.pickerMap && state.pickerMarker) {
    state.pickerMap.setView([lat, lng], zoom);
    state.pickerMarker.setLatLng([lat, lng]);
  }
  updateAddressField(lat, lng);
}

function setLocationHint(message, tone = 'neutral') {
  const hint = document.getElementById('locationHint');
  if (!hint) return;
  hint.innerText = message;
  hint.className = 'location-hint' + (tone === 'success' ? ' success' : '');
  hint.style.display = message ? 'block' : 'none';
}

function getCurrentGPSLocation() {
  if (!navigator.geolocation) {
    alert('브라우저가 GPS 조회를 지원하지 않습니다.');
    return;
  }
  const btn = document.getElementById('btnAutoGPS');
  btn.innerText = '위치 확인 중...';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      movePickerTo(pos.coords.latitude, pos.coords.longitude, 16);
      setLocationHint('현재 위치를 불러왔어요 · 지도를 눌러 수정할 수 있어요', 'success');
      btn.innerText = '현재 위치 가져오기';
    },
    () => {
      alert('GPS 위치를 가져올 수 없습니다. 지도를 직접 클릭해 위치를 지정해주세요.');
      btn.innerText = '현재 위치 가져오기';
    }
  );
}

async function updateAddressField(lat, lng) {
  document.getElementById('reportAddress').value = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`);
    const data = await res.json();
    if (data && data.display_name) {
      document.getElementById('reportAddress').value = data.display_name;
    }
  } catch (e) {
    // 좌표 표시로 대체됨
  }
}

/* ==========================================================================
   피드 (그리드 / 카드)
   ========================================================================== */
function renderFeedView() {
  const container = document.getElementById('feedContainer');
  if (!container) return;

  if (state.filteredReports.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i data-lucide="ghost"></i>
        <h3>등록된 신고가 없습니다</h3>
        <p>담배꽁초 발생 구역을 발견했다면 신고해보세요.</p>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  if (state.feedLayout === 'grid') {
    let gridHtml = `<div class="insta-grid">`;
    state.filteredReports.forEach(report => {
      gridHtml += `
        <div class="grid-card" onclick="window.openDetailModalFromId('${report.id}')">
          <img src="${report.imageUrl}" alt="${escapeHtml(report.title)}" loading="lazy" />
          <div class="grid-overlay">
            <div class="grid-overlay-top">
              <span class="badge badge-${report.severity}">${severityLabel(report.severity)}</span>
            </div>
            <div class="grid-overlay-bottom">
              <h4 class="grid-title">${escapeHtml(report.title)}</h4>
              <div class="grid-stats">
                <span>❤ ${report.likesCount || 0}</span>
                <span>🧹 ${report.cleanupVotes || 0}</span>
                <span>💬 ${(report.comments || []).length}</span>
              </div>
            </div>
          </div>
        </div>
      `;
    });
    gridHtml += `</div>`;
    container.innerHTML = gridHtml;
  } else {
    let feedHtml = `<div class="insta-feed">`;
    state.filteredReports.forEach(report => {
      const timeAgo = formatTimeAgo(report.createdAt);
      const displayName = report.userName || '익명 헌터';
      feedHtml += `
        <div class="post-card">
          <div class="post-header">
            <div class="post-user">
              <div class="user-avatar">${avatarInitials(displayName)}</div>
              <div>
                <div class="user-info-name">${escapeHtml(displayName)}</div>
                <div class="user-info-location">${escapeHtml(report.address || '위치 정보 없음')}</div>
              </div>
            </div>
            <span class="badge badge-${report.severity}">${severityLabel(report.severity)}</span>
          </div>

          <div class="post-image-container" onclick="window.openDetailModalFromId('${report.id}')">
            <img src="${report.imageUrl}" class="post-image" alt="${escapeHtml(report.title)}" loading="lazy" />
          </div>

          <div class="post-actions">
            <div class="action-bar">
              <div class="action-btns-left">
                <button class="icon-action-btn" onclick="window.handleLikeClick('${report.id}')">❤ <span>${report.likesCount || 0}</span></button>
                <button class="icon-action-btn" onclick="window.handleCleanupVoteClick('${report.id}')">🧹 <span>${report.cleanupVotes || 0}</span></button>
                <button class="icon-action-btn" onclick="window.openDetailModalFromId('${report.id}')">💬 <span>${(report.comments || []).length}</span></button>
              </div>
            </div>
            <div class="post-caption">
              <strong>${escapeHtml(report.title)}</strong><br />
              <span class="post-caption-desc">${escapeHtml(report.description || '')}</span>
            </div>
            <div class="post-time">${timeAgo}</div>
          </div>
        </div>
      `;
    });
    feedHtml += `</div>`;
    container.innerHTML = feedHtml;
  }

  if (window.lucide) window.lucide.createIcons();
}

/* ==========================================================================
   이벤트 리스너
   ========================================================================== */
function setupEventListeners() {
  document.getElementById('btnViewMap').addEventListener('click', () => {
    state.activeView = 'map';
    document.getElementById('btnViewMap').classList.add('active');
    document.getElementById('btnViewFeed').classList.remove('active');
    document.getElementById('mapViewSection').style.display = 'block';
    document.getElementById('feedViewSection').style.display = 'none';
    setTimeout(() => state.map && state.map.invalidateSize(), 50);
  });

  document.getElementById('btnViewFeed').addEventListener('click', () => {
    state.activeView = 'feed';
    document.getElementById('btnViewFeed').classList.add('active');
    document.getElementById('btnViewMap').classList.remove('active');
    document.getElementById('mapViewSection').style.display = 'none';
    document.getElementById('feedViewSection').style.display = 'block';
    renderFeedView();
  });

  document.getElementById('btnFeedGrid')?.addEventListener('click', () => {
    state.feedLayout = 'grid';
    document.getElementById('btnFeedGrid').classList.add('active');
    document.getElementById('btnFeedCards').classList.remove('active');
    renderFeedView();
  });

  document.getElementById('btnFeedCards')?.addEventListener('click', () => {
    state.feedLayout = 'cards';
    document.getElementById('btnFeedCards').classList.add('active');
    document.getElementById('btnFeedGrid').classList.remove('active');
    renderFeedView();
  });

  document.querySelectorAll('.chip[data-filter]').forEach(chip => {
    chip.addEventListener('click', (e) => {
      document.querySelectorAll('.chip[data-filter]').forEach(c => c.classList.remove('active'));
      e.currentTarget.classList.add('active');
      state.filterSeverity = e.currentTarget.dataset.filter;
      applyFilters();
    });
  });

  document.getElementById('searchInput').addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    applyFilters();
  });

  // 신고 모달
  document.getElementById('btnOpenReportModal').addEventListener('click', openReportModal);
  document.getElementById('btnCloseReportModal').addEventListener('click', closeReportModal);
  document.getElementById('btnCancelReport').addEventListener('click', closeReportModal);

  const photoInput = document.getElementById('photoInput');
  const photoUploadBox = document.getElementById('photoUploadBox');
  photoUploadBox.addEventListener('click', () => photoInput.click());
  photoInput.addEventListener('change', handlePhotoSelected);

  document.getElementById('btnAutoGPS').addEventListener('click', getCurrentGPSLocation);
  document.getElementById('reportForm').addEventListener('submit', handleReportFormSubmit);

  // 상세 모달
  document.getElementById('btnCloseDetailModal').addEventListener('click', closeDetailModal);
  document.getElementById('btnMarkCleaned').addEventListener('click', handleMarkCleanedClick);

  // 인증 모달
  document.getElementById('btnOpenAuthModal').addEventListener('click', () => openAuthModal('login'));
  document.getElementById('btnCloseAuthModal').addEventListener('click', closeAuthModal);
  document.getElementById('btnAuthSwitchToSignup').addEventListener('click', () => setAuthMode('signup'));
  document.getElementById('btnAuthSwitchToLogin').addEventListener('click', () => setAuthMode('login'));
  document.getElementById('authForm').addEventListener('submit', handleAuthFormSubmit);
  document.getElementById('btnLogout').addEventListener('click', handleLogoutClick);

  // 랭킹 모달
  document.getElementById('btnOpenRankingModal').addEventListener('click', openRankingModal);
  document.getElementById('btnCloseRankingModal').addEventListener('click', closeRankingModal);
}

/* ==========================================================================
   신고 등록
   ========================================================================== */
function openReportModal() {
  document.getElementById('reportModal').classList.add('open');
  updateReporterFieldUI();
  setTimeout(initPickerMap, 150);
}

function closeReportModal() {
  document.getElementById('reportModal').classList.remove('open');
}

function updateReporterFieldUI() {
  const loggedInWrap = document.getElementById('reporterLoggedIn');
  const guestWrap = document.getElementById('reporterGuest');
  if (state.currentUser) {
    loggedInWrap.style.display = 'block';
    guestWrap.style.display = 'none';
    document.getElementById('reporterUsername').innerText = state.currentUser.username;
  } else {
    loggedInWrap.style.display = 'none';
    guestWrap.style.display = 'block';
  }
}

async function handlePhotoSelected(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  const preview = document.getElementById('uploadPreview');
  const placeholder = document.getElementById('uploadPlaceholder');
  const placeholderText = document.getElementById('uploadPlaceholderText');
  placeholderText.innerText = '사진 압축 중...';

  try {
    const [blob, gps] = await Promise.all([
      compressImageToWebP(file, { maxWidth: 600, quality: 0.5 }),
      extractGpsFromImage(file)
    ]);
    state.newReportPhotoBlob = blob;
    preview.src = URL.createObjectURL(blob);
    preview.style.display = 'block';
    placeholder.style.display = 'none';

    if (gps) {
      movePickerTo(gps.lat, gps.lng, 17);
      setLocationHint('사진 속 위치 정보를 불러왔어요 · 지도를 눌러 수정할 수 있어요', 'success');
    } else {
      setLocationHint('사진에 위치 정보가 없어요 · 지도를 눌러 위치를 지정해주세요');
    }
  } catch (err) {
    alert('사진을 처리하지 못했습니다. 다른 사진을 선택해주세요.');
    placeholderText.innerText = '터치하여 사진 업로드';
  }
}

async function handleReportFormSubmit(e) {
  e.preventDefault();

  const title = document.getElementById('reportTitle').value.trim();
  const description = document.getElementById('reportDesc').value.trim();
  const address = document.getElementById('reportAddress').value.trim();
  const severity = document.getElementById('reportSeverity').value;
  const guestNameInput = document.getElementById('reportGuestName').value.trim();
  const displayName = state.currentUser ? state.currentUser.username : (guestNameInput || null);

  if (!title) { alert('제목을 입력해주세요.'); return; }
  if (!state.newReportPhotoBlob) { alert('현장 사진을 첨부해주세요.'); return; }

  const submitBtn = document.getElementById('btnSubmitReport');
  submitBtn.innerText = '등록 중...';
  submitBtn.disabled = true;

  try {
    await createReport({
      title,
      description,
      address,
      severity,
      imageBlob: state.newReportPhotoBlob,
      latitude: state.newReportCoords.lat,
      longitude: state.newReportCoords.lng,
      userId: state.currentUser?.id || null,
      displayName
    });

    closeReportModal();
    resetReportForm();

    if (state.currentUser) state.currentUser = await getCurrentUser();
    await loadAndRenderData();
    updateAuthUI();
  } catch (err) {
    alert(err.message || '신고 등록 중 오류가 발생했습니다.');
  }

  submitBtn.innerText = '신고 등록하기';
  submitBtn.disabled = false;
}

function resetReportForm() {
  document.getElementById('reportForm').reset();
  document.getElementById('uploadPreview').style.display = 'none';
  document.getElementById('uploadPlaceholder').style.display = 'block';
  document.getElementById('uploadPlaceholderText').innerText = '터치하여 사진 업로드';
  state.newReportPhotoBlob = null;
  setLocationHint('');
}

/* ==========================================================================
   상세 모달
   ========================================================================== */
window.openDetailModalFromId = (id) => {
  const report = state.reports.find(r => r.id === id);
  if (report) {
    state.selectedReport = report;
    openDetailModal(report);
  }
};

window.handleLikeClick = async (id) => {
  state.reports = await toggleLikeReport(id, state.currentUser?.id || null);
  applyFilters();
  renderStats();
};

window.handleCleanupVoteClick = async (id) => {
  state.reports = await voteCleanupReport(id, state.currentUser?.id || null);
  applyFilters();
  renderStats();
};

async function handleMarkCleanedClick() {
  if (!state.selectedReport) return;
  state.reports = await updateReportStatus(state.selectedReport.id, 'cleaned');
  const updated = state.reports.find(r => r.id === state.selectedReport.id);
  if (updated) {
    state.selectedReport = updated;
    openDetailModal(updated);
  }
  applyFilters();
  renderStats();
}

function openDetailModal(report) {
  const modal = document.getElementById('detailModal');
  const displayName = report.userName || '익명 헌터';

  document.getElementById('detailTitle').innerText = report.title;
  document.getElementById('detailImg').src = report.imageUrl;
  document.getElementById('detailUserName').innerText = displayName;
  document.getElementById('detailUserAvatar').innerText = avatarInitials(displayName);
  document.getElementById('detailAddress').innerText = report.address || '위치 정보 없음';
  document.getElementById('detailDesc').innerText = report.description || '상세 설명이 없습니다.';
  document.getElementById('detailTime').innerText = formatTimeAgo(report.createdAt);
  document.getElementById('detailLikesCount').innerText = report.likesCount || 0;
  document.getElementById('detailCleanupVotes').innerText = report.cleanupVotes || 0;

  const markCleanedBtn = document.getElementById('btnMarkCleaned');
  markCleanedBtn.style.display = report.status === 'cleaned' ? 'none' : 'inline-flex';

  renderCommentsList(report.comments || []);

  const commentForm = document.getElementById('commentForm');
  commentForm.onsubmit = async (e) => {
    e.preventDefault();
    const input = document.getElementById('commentInput');
    const text = input.value.trim();
    if (!text) return;
    const authorName = state.currentUser?.username || '익명 헌터';
    state.reports = await addCommentToReport(report.id, text, authorName, state.currentUser?.id || null);
    input.value = '';
    const updated = state.reports.find(r => r.id === report.id);
    if (updated) { state.selectedReport = updated; renderCommentsList(updated.comments); }
  };

  modal.classList.add('open');
}

function closeDetailModal() {
  document.getElementById('detailModal').classList.remove('open');
}

function renderCommentsList(comments) {
  const container = document.getElementById('detailCommentsList');
  if (!comments || comments.length === 0) {
    container.innerHTML = `<p class="empty-comment">첫 번째 댓글을 남겨보세요.</p>`;
    return;
  }
  container.innerHTML = comments.map(c => `
    <div class="comment-row">
      <strong>${escapeHtml(c.author)}</strong>
      <span>${escapeHtml(c.text)}</span>
      <span class="comment-time">${c.time || ''}</span>
    </div>
  `).join('');
}

/* ==========================================================================
   인증 (로그인 / 회원가입)
   ========================================================================== */
function openAuthModal(mode) {
  setAuthMode(mode);
  document.getElementById('authModal').classList.add('open');
}

function closeAuthModal() {
  document.getElementById('authModal').classList.remove('open');
  document.getElementById('authForm').reset();
  document.getElementById('authError').style.display = 'none';
}

function setAuthMode(mode) {
  state.authMode = mode;
  document.getElementById('authModalTitle').innerText = mode === 'login' ? '로그인' : '회원가입';
  document.getElementById('btnAuthSubmit').innerText = mode === 'login' ? '로그인' : '가입하기';
  document.getElementById('authSwitchToSignup').style.display = mode === 'login' ? 'block' : 'none';
  document.getElementById('authSwitchToLogin').style.display = mode === 'signup' ? 'block' : 'none';
  document.getElementById('authError').style.display = 'none';
}

async function handleAuthFormSubmit(e) {
  e.preventDefault();
  const username = document.getElementById('authUsername').value.trim();
  const password = document.getElementById('authPassword').value;
  const errorBox = document.getElementById('authError');
  const submitBtn = document.getElementById('btnAuthSubmit');

  submitBtn.disabled = true;
  errorBox.style.display = 'none';

  try {
    if (state.authMode === 'login') await signIn(username, password);
    else await signUp(username, password);

    state.currentUser = await getCurrentUser();
    updateAuthUI();
    closeAuthModal();
    await loadAndRenderData();
  } catch (err) {
    errorBox.innerText = err.message || '오류가 발생했습니다.';
    errorBox.style.display = 'block';
  }

  submitBtn.disabled = false;
}

async function handleLogoutClick() {
  await signOut();
  state.currentUser = null;
  updateAuthUI();
  renderStats();
}

function updateAuthUI() {
  const loggedOutEl = document.getElementById('authLoggedOut');
  const loggedInEl = document.getElementById('authLoggedIn');
  if (state.currentUser) {
    loggedOutEl.style.display = 'none';
    loggedInEl.style.display = 'flex';
    document.getElementById('currentUsername').innerText = state.currentUser.username;
    document.getElementById('currentUserAvatar').innerText = avatarInitials(state.currentUser.username);
  } else {
    loggedOutEl.style.display = 'flex';
    loggedInEl.style.display = 'none';
  }
  renderStats();
}

/* ==========================================================================
   랭킹
   ========================================================================== */
async function openRankingModal() {
  document.getElementById('rankingModal').classList.add('open');

  const list = document.getElementById('rankingList');
  list.innerHTML = `<p class="ranking-loading">불러오는 중...</p>`;

  const data = await fetchMonthlyLeaderboard();

  if (!data || data.length === 0) {
    list.innerHTML = `<p class="ranking-empty">아직 랭킹 데이터가 없습니다.</p>`;
    return;
  }

  list.innerHTML = data.map((entry, idx) => `
    <div class="ranking-row">
      <span class="ranking-rank ${idx < 3 ? 'top' : ''}">${idx + 1}</span>
      <span class="ranking-name">${escapeHtml(entry.username)}</span>
      <span class="ranking-value">${entry.points}P</span>
    </div>
  `).join('');
}

function closeRankingModal() {
  document.getElementById('rankingModal').classList.remove('open');
}

/* ==========================================================================
   유틸
   ========================================================================== */
const SEVERITY_LABELS = {
  critical: '매우 심각',
  severe: '심함',
  medium: '보통',
  slight: '약간'
};

function severityLabel(severity) {
  return SEVERITY_LABELS[severity] || SEVERITY_LABELS.medium;
}

function avatarInitials(name) {
  return (name || '헌터').trim().slice(0, 2).toUpperCase();
}

function formatTimeAgo(isoString) {
  if (!isoString) return '방금 전';
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${Math.max(1, minutes)}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  return `${days}일 전`;
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
