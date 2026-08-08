// 꽁초헌터 앱 로직 (Leaflet 지도 고정, 회원 시스템, 포인트/랭킹)
import {
  fetchReports,
  createReport,
  toggleLikeReport,
  fetchMyLikedReportIds,
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

let photoItemSeq = 0;

const state = {
  activeView: 'map',
  feedLayout: 'grid',
  reports: [],
  filteredReports: [],
  filterSeverity: 'all',
  searchQuery: '',
  selectedReport: null,
  photoItems: [], // { id, blob, previewUrl, coords: {lat,lng}, address }
  activePhotoId: null,
  map: null,
  mapMarkers: [],
  pickerMap: null,
  pickerMarker: null,
  currentUser: null,
  authMode: 'login', // 'login' | 'signup'
  likedReportIds: new Set()
};

document.addEventListener('DOMContentLoaded', async () => {
  state.currentUser = await getCurrentUser();
  await refreshLikedReportIds();
  updateAuthUI();

  await loadAndRenderData();
  setupEventListeners();
  initMap();
});

async function refreshLikedReportIds() {
  const ids = await fetchMyLikedReportIds(state.currentUser?.id || null);
  state.likedReportIds = new Set(ids);
}

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
  document.getElementById('statTotal').innerText = total + '건';

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
    const pinClass = `pin-${report.severity}`;

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

  const coords = getActivePhotoItem()?.coords || DEFAULT_CENTER;

  if (!state.pickerMap) {
    state.pickerMap = L.map('pickerMap', { zoomControl: false }).setView([coords.lat, coords.lng], 15);
    L.tileLayer(LIGHT_TILE_URL, { maxZoom: 19, attribution: LIGHT_TILE_ATTRIBUTION }).addTo(state.pickerMap);
    state.pickerMarker = L.marker([coords.lat, coords.lng], { draggable: true }).addTo(state.pickerMap);

    state.pickerMarker.on('dragend', (e) => {
      const latlng = e.target.getLatLng();
      setActivePhotoLocation(latlng.lat, latlng.lng);
    });

    state.pickerMap.on('click', (e) => {
      state.pickerMarker.setLatLng(e.latlng);
      setActivePhotoLocation(e.latlng.lat, e.latlng.lng);
    });
  } else {
    state.pickerMap.setView([coords.lat, coords.lng], 15);
    state.pickerMarker.setLatLng([coords.lat, coords.lng]);
    state.pickerMap.invalidateSize();
  }
}

// 지도 위 클릭/드래그 시 "선택된 사진"의 좌표 + 주소를 갱신
async function setActivePhotoLocation(lat, lng) {
  const item = getActivePhotoItem();
  if (!item) return;
  item.coords = { lat, lng };
  item.address = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  document.getElementById('reportAddress').value = item.address;
  item.address = await reverseGeocode(lat, lng);
  document.getElementById('reportAddress').value = item.address;
  renderPhotoThumbs();
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
  if (!getActivePhotoItem()) {
    alert('먼저 사진을 추가해주세요.');
    return;
  }
  const btn = document.getElementById('btnAutoGPS');
  btn.innerText = '위치 확인 중...';
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude, longitude } = pos.coords;
      if (state.pickerMap && state.pickerMarker) {
        state.pickerMap.setView([latitude, longitude], 16);
        state.pickerMarker.setLatLng([latitude, longitude]);
      }
      await setActivePhotoLocation(latitude, longitude);
      setLocationHint('현재 위치를 불러왔어요 · 지도를 눌러 수정할 수 있어요', 'success');
      btn.innerText = '현재 위치 가져오기';
    },
    () => {
      alert('GPS 위치를 가져올 수 없습니다. 지도를 직접 클릭해 위치를 지정해주세요.');
      btn.innerText = '현재 위치 가져오기';
    }
  );
}

// 좌표 → 한글 주소 역지오코딩 (Nominatim, 무료)
async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=ko`);
    const data = await res.json();
    if (data && data.display_name) return data.display_name;
  } catch (e) {
    // 좌표 표시로 대체됨
  }
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
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
      const liked = isLikedByMe(report.id);
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
                <button class="grid-like-btn ${liked ? 'liked' : ''}" ${liked ? 'disabled' : ''} onclick="event.stopPropagation(); window.handleLikeClick('${report.id}')">❤ ${report.likesCount || 0}</button>
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
      const liked = isLikedByMe(report.id);
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
                <button class="icon-action-btn ${liked ? 'liked' : ''}" ${liked ? 'disabled' : ''} onclick="window.handleLikeClick('${report.id}')">❤ <span>${report.likesCount || 0}</span></button>
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
  document.getElementById('btnAddPhoto').addEventListener('click', () => photoInput.click());
  photoInput.addEventListener('change', handlePhotosSelected);

  document.getElementById('btnAutoGPS').addEventListener('click', getCurrentGPSLocation);
  document.getElementById('reportForm').addEventListener('submit', handleReportFormSubmit);

  // 상세 모달
  document.getElementById('btnCloseDetailModal').addEventListener('click', closeDetailModal);

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

// 사진 여러 장 선택 → 각각 압축 + EXIF 위치 자동 인식
async function handlePhotosSelected(e) {
  const files = Array.from(e.target.files || []);
  e.target.value = ''; // 같은 파일을 다시 선택할 수 있도록 초기화

  for (const file of files) {
    const id = 'photo-' + (++photoItemSeq);
    const item = { id, blob: null, previewUrl: null, coords: null, address: '사진 처리 중...', ready: false };
    state.photoItems.push(item);
    if (!state.activePhotoId) state.activePhotoId = id;
    renderPhotoThumbs();
    if (state.activePhotoId === id) syncPickerToActivePhoto();

    try {
      const [blob, gps] = await Promise.all([
        compressImageToWebP(file, { maxWidth: 600, quality: 0.5 }),
        extractGpsFromImage(file)
      ]);
      item.blob = blob;
      item.previewUrl = URL.createObjectURL(blob);

      if (gps) {
        item.coords = gps;
        item.address = '위치 확인 중...';
        renderPhotoThumbs();
        item.address = await reverseGeocode(gps.lat, gps.lng);
      } else {
        const previousWithCoords = state.photoItems.find(p => p.id !== id && p.coords);
        if (previousWithCoords) {
          item.coords = { ...previousWithCoords.coords };
          item.address = '위치 확인 중...';
          renderPhotoThumbs();
          item.address = await reverseGeocode(item.coords.lat, item.coords.lng);
        } else {
          item.coords = { ...DEFAULT_CENTER };
          item.address = '위치 정보 없음';
        }
      }
      item.ready = true;
    } catch (err) {
      item.coords = item.coords || { ...DEFAULT_CENTER };
      item.address = '사진 처리 실패';
      item.ready = false;
    }

    renderPhotoThumbs();
    if (state.activePhotoId === id) syncPickerToActivePhoto();
  }
}

function getActivePhotoItem() {
  return state.photoItems.find(p => p.id === state.activePhotoId) || null;
}

function setActivePhoto(id) {
  state.activePhotoId = id;
  renderPhotoThumbs();
  syncPickerToActivePhoto();
}

function removePhotoItem(id) {
  const idx = state.photoItems.findIndex(p => p.id === id);
  if (idx === -1) return;
  const [removed] = state.photoItems.splice(idx, 1);
  if (removed.previewUrl) URL.revokeObjectURL(removed.previewUrl);

  if (state.activePhotoId === id) {
    state.activePhotoId = state.photoItems.length > 0 ? state.photoItems[0].id : null;
  }
  renderPhotoThumbs();
  syncPickerToActivePhoto();
}

function syncPickerToActivePhoto() {
  const item = getActivePhotoItem();
  const coords = item?.coords || DEFAULT_CENTER;
  if (state.pickerMap && state.pickerMarker) {
    state.pickerMap.setView([coords.lat, coords.lng], item ? 16 : 13);
    state.pickerMarker.setLatLng([coords.lat, coords.lng]);
  }
  document.getElementById('reportAddress').value = item?.address || '';
}

function renderPhotoThumbs() {
  const grid = document.getElementById('photoThumbGrid');
  const addTile = document.getElementById('btnAddPhoto');
  if (!grid || !addTile) return;

  grid.querySelectorAll('.photo-thumb').forEach(el => el.remove());

  state.photoItems.forEach((item, idx) => {
    const div = document.createElement('div');
    div.className = 'photo-thumb' + (item.id === state.activePhotoId ? ' active' : '');
    div.innerHTML = `
      ${item.previewUrl ? `<img src="${item.previewUrl}" alt="사진 ${idx + 1}" />` : `<div class="photo-thumb-loading">처리중</div>`}
      <button type="button" class="photo-thumb-remove" aria-label="삭제">&times;</button>
      <span class="photo-thumb-address">${escapeHtml(item.address || '')}</span>
    `;
    div.addEventListener('click', () => setActivePhoto(item.id));
    div.querySelector('.photo-thumb-remove').addEventListener('click', (e) => {
      e.stopPropagation();
      removePhotoItem(item.id);
    });
    grid.insertBefore(div, addTile);
  });

  const total = state.photoItems.length;
  const label = document.getElementById('activePhotoLabel');
  if (label) {
    const idx = state.photoItems.findIndex(p => p.id === state.activePhotoId);
    label.innerText = total > 1 ? `· 선택한 사진 위치 (${idx + 1}/${total})` : '';
  }

  const submitBtn = document.getElementById('btnSubmitReport');
  if (submitBtn) submitBtn.innerText = total > 1 ? `${total}건 한번에 등록하기` : '신고 등록하기';
}

async function handleReportFormSubmit(e) {
  e.preventDefault();

  const title = document.getElementById('reportTitle').value.trim();
  const description = document.getElementById('reportDesc').value.trim();
  const severity = document.getElementById('reportSeverity').value;
  const guestNameInput = document.getElementById('reportGuestName').value.trim();
  const displayName = state.currentUser ? state.currentUser.username : (guestNameInput || null);

  if (state.photoItems.length === 0) { alert('현장 사진을 1장 이상 첨부해주세요.'); return; }
  if (state.photoItems.some(p => !p.ready || !p.blob || !p.coords)) {
    alert('사진 위치 확인이 아직 끝나지 않았습니다. 잠시 후 다시 시도해주세요.');
    return;
  }

  const submitBtn = document.getElementById('btnSubmitReport');
  submitBtn.disabled = true;

  const total = state.photoItems.length;
  let successCount = 0;

  try {
    for (let i = 0; i < total; i++) {
      submitBtn.innerText = total > 1 ? `등록 중... (${i + 1}/${total})` : '등록 중...';
      const item = state.photoItems[i];
      await createReport({
        title: title || item.address || '위치 정보 없음',
        description,
        address: item.address,
        severity,
        imageBlob: item.blob,
        latitude: item.coords.lat,
        longitude: item.coords.lng,
        userId: state.currentUser?.id || null,
        displayName
      });
      successCount++;
    }

    closeReportModal();
    resetReportForm();

    if (state.currentUser) state.currentUser = await getCurrentUser();
    await loadAndRenderData();
    updateAuthUI();
  } catch (err) {
    alert((err.message || '신고 등록 중 오류가 발생했습니다.') + ` (${successCount}/${total}건 등록됨)`);
    await loadAndRenderData();
  }

  submitBtn.disabled = false;
  renderPhotoThumbs();
}

function resetReportForm() {
  document.getElementById('reportForm').reset();
  state.photoItems.forEach(p => { if (p.previewUrl) URL.revokeObjectURL(p.previewUrl); });
  state.photoItems = [];
  state.activePhotoId = null;
  renderPhotoThumbs();
  document.getElementById('reportAddress').value = '';
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

function isLikedByMe(reportId) {
  return state.likedReportIds.has(reportId);
}

window.handleLikeClick = async (id) => {
  if (state.likedReportIds.has(id)) return;

  try {
    state.reports = await toggleLikeReport(id, state.currentUser?.id || null);
    state.likedReportIds.add(id);
  } catch (err) {
    if (state.currentUser) alert(err.message || '공감 처리에 실패했습니다.');
    return;
  }

  applyFilters();
  if (state.currentUser) state.currentUser = await getCurrentUser();
  updateAuthUI();
};

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

  const likeBtn = document.getElementById('btnDetailLike');
  likeBtn.disabled = isLikedByMe(report.id);
  likeBtn.classList.toggle('liked', isLikedByMe(report.id));
  likeBtn.onclick = async () => {
    await window.handleLikeClick(report.id);
    const updated = state.reports.find(r => r.id === report.id);
    if (updated) {
      state.selectedReport = updated;
      document.getElementById('detailLikesCount').innerText = updated.likesCount || 0;
    }
    likeBtn.disabled = isLikedByMe(report.id);
    likeBtn.classList.toggle('liked', isLikedByMe(report.id));
  };

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
    await refreshLikedReportIds();
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
  await refreshLikedReportIds();
  updateAuthUI();
  applyFilters();
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
