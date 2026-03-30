/**
 * =====================================================
 * SAFENET — Main Application Script (User Dashboard)
 * =====================================================
 * Map, markers, risk calc, routing, evidence, anti-spam
 * =====================================================
 */

/* ─── Severity Weights ───────────────────────────────── */
const SEVERITY = {
  theft:      2,
  harassment: 3,
  assault:    5,
  stalking:   4,
  unsafe:     1,
  vandalism:  2,
};

/* ─── Type Config ────────────────────────────────────── */
const TYPE_CONFIG = {
  theft:      { emoji: '🔓', color: '#f97316', label: 'Theft' },
  harassment: { emoji: '😤', color: '#8b5cf6', label: 'Harassment' },
  assault:    { emoji: '🥊', color: '#ef4444', label: 'Assault' },
  stalking:   { emoji: '👁',  color: '#ec4899', label: 'Stalking' },
  unsafe:     { emoji: '⚠️', color: '#f59e0b', label: 'Unsafe Area' },
  vandalism:  { emoji: '🔨', color: '#6366f1', label: 'Vandalism' },
};

/* ─── State ──────────────────────────────────────────── */
let map;
let markerClusterGroup;
let allReports      = [];
let filteredReports  = [];
let activeFilter     = 'all';
let riskCircles      = [];
let routingControl   = null;
let userMarker       = null;
let userLatLng       = null;
let selectedType     = null;
let reportLat        = null;
let reportLng        = null;
let pinMarker        = null;
let isPickingLocation = false;
let showZones        = true;
let useClustering    = true;
let routeType        = 'fastest';
let currentUser      = null;
let isGuest          = false;
let unsubscribeReports    = null;
let unsubscribeMyReports  = null;
let sidebarOpen      = true;
let evidenceHash     = null;

/* ─── Risk Color ─────────────────────────────────────── */
function getRiskColor(score) {
  if (score >= 6) return '#ef4444';
  if (score >= 3) return '#f59e0b';
  return '#10b981';
}

/* ─── Time Ago ───────────────────────────────────────── */
function timeAgo(date) {
  if (!date) return 'Unknown';
  const secs = Math.floor((Date.now() - date.getTime()) / 1000);
  if (secs < 60)    return 'Just now';
  if (secs < 3600)  return `${Math.floor(secs / 60)} min ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)} hrs ago`;
  if (secs < 604800) return `${Math.floor(secs / 86400)} days ago`;
  return date.toLocaleDateString();
}

/* ─── Toast ──────────────────────────────────────────── */
function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span style="font-size:1.1rem;flex-shrink:0">${icons[type] || 'ℹ️'}</span>
    <span style="flex:1">${message}</span>
    <button class="toast-close" onclick="this.closest('.toast').remove()">✕</button>
  `;
  container.prepend(toast);
  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 320);
  }, duration);
}

/* ─── Theme ──────────────────────────────────────────── */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
  localStorage.setItem('sn-theme', theme);
  if (map) {
    map.eachLayer(l => { if (l._url) map.removeLayer(l); });
    initTiles();
  }
}

document.getElementById('theme-toggle').addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme') || 'light';
  applyTheme(cur === 'dark' ? 'light' : 'dark');
});

(function() {
  const saved = localStorage.getItem('sn-theme');
  const dark  = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved || (dark ? 'dark' : 'light'));
})();

/* ─── Map Tiles ──────────────────────────────────────── */
function initTiles() {
  const theme = document.documentElement.getAttribute('data-theme');
  const url = theme === 'dark'
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
  L.tileLayer(url, {
    attribution: '&copy; <a href="https://carto.com">CARTO</a>',
    subdomains: 'abcd', maxZoom: 19,
  }).addTo(map);
}

/* ─── Init Map ───────────────────────────────────────── */
function initMap() {
  map = L.map('map', {
    center: [20.5937, 78.9629],
    zoom: 5,
    zoomControl: false,
  });
  L.control.zoom({ position: 'bottomleft' }).addTo(map);
  initTiles();

  map.on('click', e => {
    if (isPickingLocation) {
      placePinMarker(e.latlng.lat, e.latlng.lng);
      isPickingLocation = false;
      openReportModal(e.latlng.lat, e.latlng.lng);
    } else {
      openReportModal(e.latlng.lat, e.latlng.lng);
    }
  });

  markerClusterGroup = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 60,
    iconCreateFunction: clusterIcon,
    animate: true,
  });
  map.addLayer(markerClusterGroup);
}

/* ─── Cluster Icon ───────────────────────────────────── */
function clusterIcon(cluster) {
  const count = cluster.getChildCount();
  const size  = count < 10 ? 36 : count < 100 ? 44 : 52;
  let color = '#10b981';
  if (count >= 6)  color = '#ef4444';
  else if (count >= 3) color = '#f59e0b';
  return L.divIcon({
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:50%;
      background:${color};color:#fff;
      display:flex;align-items:center;justify-content:center;
      font-weight:800;font-size:0.85rem;
      border:3px solid rgba(255,255,255,0.7);
      box-shadow:0 2px 10px rgba(0,0,0,0.25);
    ">${count}</div>`,
    className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2],
  });
}

/* ─── Marker Icon ────────────────────────────────────── */
function createMarkerIcon(type, riskScore) {
  const cfg   = TYPE_CONFIG[type] || { emoji: '📍', color: '#6c63ff' };
  const color = getRiskColor(riskScore);
  const size  = 36;
  return L.divIcon({
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:50%;
      background:${color};color:#fff;
      display:flex;align-items:center;justify-content:center;
      font-size:1rem;
      border:3px solid rgba(255,255,255,0.85);
      box-shadow:0 3px 12px rgba(0,0,0,0.28),0 0 0 3px ${color}40;
      position:relative;
    ">${cfg.emoji}<div style="
      position:absolute;bottom:-8px;left:50%;transform:translateX(-50%);
      width:0;height:0;
      border-left:5px solid transparent;
      border-right:5px solid transparent;
      border-top:8px solid ${color};
    "></div></div>`,
    className: '', iconSize: [size, size + 8],
    iconAnchor: [size / 2, size + 8],
    popupAnchor: [0, -(size + 8)],
  });
}

/* ─── Risk Score Calculation ─────────────────────────── */
// Score = sum(severity × timeFactor) for reports within 800m
function calculateRiskScore(lat, lng, reports) {
  let score = 0;
  const now = Date.now();
  reports.forEach(r => {
    const dist = map.distance([lat, lng], [r.lat, r.lng]);
    if (dist > 800) return;

    const severity = SEVERITY[r.type] || 1;
    const ageHrs   = (now - (r.time?.getTime() || now)) / 3600000;

    // Time factor: last 24h → 1.5, last 7d → 1.2, older → 0.8
    let timeFactor = 0.8;
    if (ageHrs < 24)  timeFactor = 1.5;
    else if (ageHrs < 168) timeFactor = 1.2;

    // Verified reports get extra weight
    const verifyBoost = r.verified ? 1.3 : 1.0;

    score += severity * timeFactor * verifyBoost;
  });
  return Math.round(score);
}

/* ─── Render Markers ─────────────────────────────────── */
function renderMarkers(reports) {
  markerClusterGroup.clearLayers();
  clearRiskZones();

  const today = new Date(); today.setHours(0, 0, 0, 0);
  let highRisk = 0, todayCount = 0;

  document.getElementById('total-count').textContent = reports.length;
  document.getElementById('nav-count').textContent   = reports.length;

  reports.forEach(r => {
    if (!r.lat || !r.lng) return;
    const riskScore = calculateRiskScore(r.lat, r.lng, reports);
    if (riskScore >= 6) highRisk++;
    if (r.time >= today) todayCount++;

    const icon   = createMarkerIcon(r.type, riskScore);
    const marker = L.marker([r.lat, r.lng], { icon });
    const cfg    = TYPE_CONFIG[r.type] || { emoji: '📍', color: '#6c63ff', label: r.type };
    const riskLabel = riskScore >= 6 ? '🔴 High Risk' : riskScore >= 3 ? '🟡 Medium Risk' : '🟢 Low Risk';

    // Evidence + verification info
    const evidenceHtml = r.evidenceHash
      ? `<div class="popup-evidence">📎 Evidence: <code style="font-size:0.65rem;">${r.evidenceHash.slice(0, 12)}…</code> <span class="popup-verified">Verified ✅</span></div>`
      : '';
    const verifiedHtml = r.verified
      ? `<div style="margin-top:0.3rem"><span class="verified-badge yes">✅ Admin Verified</span></div>`
      : `<div style="margin-top:0.3rem"><span class="verified-badge no">⏳ Pending</span></div>`;

    marker.bindPopup(`
      <div style="min-width:190px">
        <div class="popup-type-badge" style="background:${cfg.color}22;color:${cfg.color};border:1px solid ${cfg.color}44">
          ${cfg.emoji} ${cfg.label}
        </div>
        <div class="popup-desc">${r.description || 'No description provided.'}</div>
        <div class="popup-time">🕐 ${timeAgo(r.time)}</div>
        <div class="popup-score">${riskLabel} · Score: ${riskScore}</div>
        ${evidenceHtml}
        ${verifiedHtml}
      </div>
    `, { maxWidth: 260 });

    if (useClustering) {
      markerClusterGroup.addLayer(marker);
    } else {
      marker.addTo(map);
    }

    if (showZones) addRiskZone(r.lat, r.lng, riskScore);
  });

  document.getElementById('high-risk-count').textContent = highRisk;
  document.getElementById('today-count').textContent     = todayCount;
}

/* ─── Risk Zone Circles ──────────────────────────────── */
function addRiskZone(lat, lng, score) {
  const color  = getRiskColor(score);
  const radius = score >= 6 ? 400 : score >= 3 ? 280 : 180;
  const circle = L.circle([lat, lng], {
    radius, color, fillColor: color,
    fillOpacity: 0.08, weight: 1, opacity: 0.25,
  }).addTo(map);
  riskCircles.push(circle);
}

function clearRiskZones() {
  riskCircles.forEach(c => c.remove());
  riskCircles = [];
}

function toggleRiskZones() {
  showZones = document.getElementById('toggle-zones').checked;
  renderMarkers(filteredReports);
}

function toggleClustering() {
  useClustering = document.getElementById('toggle-cluster').checked;
  renderMarkers(filteredReports);
}

/* ─── Filter System ──────────────────────────────────── */
function setFilter(btn, filter) {
  activeFilter = filter;
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  applyFilter();
}

function applyFilter() {
  filteredReports = activeFilter === 'all'
    ? [...allReports]
    : allReports.filter(r => r.type === activeFilter);
  renderMarkers(filteredReports);
}

/* ─── Pin Marker ─────────────────────────────────────── */
function placePinMarker(lat, lng) {
  if (pinMarker) map.removeLayer(pinMarker);
  reportLat = lat; reportLng = lng;
  document.getElementById('report-lat').value = lat;
  document.getElementById('report-lng').value = lng;
  document.getElementById('report-coords').textContent = `📌 ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  pinMarker = L.marker([lat, lng], {
    icon: L.divIcon({
      html: `<div style="font-size:2rem;text-shadow:0 2px 8px rgba(0,0,0,0.3);filter:drop-shadow(0 2px 4px rgba(108,99,255,0.4))">📌</div>`,
      className: '', iconSize: [32, 32], iconAnchor: [16, 32],
    })
  }).addTo(map);
}

/* ─── Evidence Upload Handler ────────────────────────── */
async function handleEvidenceFile(input) {
  const statusEl = document.getElementById('evidence-status');
  if (!input.files || !input.files[0]) {
    evidenceHash = null;
    statusEl.innerHTML = '';
    return;
  }
  const file = input.files[0];
  statusEl.innerHTML = '<span style="color:var(--text-3);">Hashing evidence…</span>';

  try {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    evidenceHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    statusEl.innerHTML = `
      <div style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);border-radius:var(--r-sm);padding:0.5rem 0.7rem;margin-top:0.3rem;">
        <div style="color:var(--success);font-weight:700;font-size:0.78rem;">Evidence Verified ✅</div>
        <div style="font-family:monospace;font-size:0.68rem;color:var(--text-3);word-break:break-all;margin-top:0.2rem;">
          SHA-256: ${evidenceHash.slice(0, 16)}…${evidenceHash.slice(-8)}
        </div>
      </div>
    `;
  } catch (e) {
    statusEl.innerHTML = '<span style="color:var(--danger);">Hash failed. Try another file.</span>';
    evidenceHash = null;
  }
}

/* ─── Report Modal ───────────────────────────────────── */
function openReportModal(lat, lng) {
  if (!currentUser && !isGuest) {
    showToast('Please sign in to report incidents.', 'warning');
    setTimeout(() => window.location.href = 'login.html', 1500);
    return;
  }
  if (lat !== null && lng !== null) placePinMarker(lat, lng);
  selectedType = null;
  evidenceHash = null;
  document.querySelectorAll('.type-card').forEach(c => c.classList.remove('selected'));
  document.getElementById('report-desc').value = '';
  document.getElementById('evidence-file').value = '';
  document.getElementById('evidence-status').innerHTML = '';
  openModal('report-modal');
}

function selectType(type) {
  selectedType = type;
  document.querySelectorAll('.type-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.type === type);
  });
}

async function submitReport() {
  if (!selectedType) { showToast('Please select an incident type.', 'error'); return; }
  if (!reportLat || !reportLng) { showToast('Please set a location.', 'error'); return; }
  if (!currentUser && !isGuest) { showToast('Sign in to submit reports.', 'error'); return; }

  const userId = currentUser ? currentUser.uid : 'guest';

  // Anti-spam check
  const spamCheck = SafeNet.checkSpam(userId, reportLat, reportLng);
  if (spamCheck.blocked) {
    showToast(spamCheck.reason, 'warning');
    return;
  }

  const btn = document.getElementById('submit-report-btn');
  btn.disabled = true;
  btn.innerHTML = '<span style="display:inline-block;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;width:16px;height:16px;animation:spin 0.7s linear infinite"></span> Submitting…';

  try {
    const desc = document.getElementById('report-desc').value.trim();
    await SafeNet.addReport({
      lat: reportLat, lng: reportLng,
      type: selectedType,
      description: desc,
      userId,
      evidenceHash: evidenceHash || null,
    });

    closeModal('report-modal');
    showToast('✅ Report submitted! Thank you for keeping the community safe.', 'success');
    if (pinMarker) { map.removeLayer(pinMarker); pinMarker = null; }
    reportLat = reportLng = null;
    evidenceHash = null;
  } catch (err) {
    console.error(err);
    showToast('Failed to submit report.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '🚨 Submit Report';
  }
}

/* ─── My Location ────────────────────────────────────── */
function useMyLocation() {
  if (userLatLng) {
    placePinMarker(userLatLng.lat, userLatLng.lng);
    showToast('Using your current location.', 'info');
  } else {
    navigator.geolocation.getCurrentPosition(pos => {
      const { latitude: lat, longitude: lng } = pos.coords;
      userLatLng = { lat, lng };
      placePinMarker(lat, lng);
      showToast('Location captured!', 'success');
    }, () => showToast('Could not get location.', 'error'));
  }
}

function goToMyLocation() {
  if (!navigator.geolocation) return;
  showToast('Getting your location…', 'info');
  navigator.geolocation.getCurrentPosition(pos => {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    userLatLng = { lat, lng };
    map.flyTo([lat, lng], 15, { animate: true, duration: 1.2 });
    if (userMarker) map.removeLayer(userMarker);
    userMarker = L.marker([lat, lng], {
      icon: L.divIcon({
        html: `<div style="
          width:20px;height:20px;
          background:#6c63ff;border-radius:50%;
          border:3px solid #fff;
          box-shadow:0 0 0 4px rgba(108,99,255,0.25),0 2px 10px rgba(108,99,255,0.5);
          animation:pulse-ring 2s ease-in-out infinite;
        "></div>
        <style>@keyframes pulse-ring{0%,100%{box-shadow:0 0 0 4px rgba(108,99,255,0.25)}50%{box-shadow:0 0 0 10px rgba(108,99,255,0)}}</style>`,
        className: '', iconSize: [20, 20], iconAnchor: [10, 10],
      })
    }).bindPopup('📍 You are here').addTo(map);
    showToast('📍 Location found!', 'success');
  }, () => showToast('Could not access your location.', 'error'));
}

/* ─── Search (Nominatim) ─────────────────────────────── */
let searchTimeout;
document.getElementById('search-input').addEventListener('input', function() {
  clearTimeout(searchTimeout);
  const q = this.value.trim();
  const res = document.getElementById('search-results');
  if (q.length < 3) { res.style.display = 'none'; return; }
  searchTimeout = setTimeout(() => searchLocation(q), 500);
});

async function searchLocation(query) {
  const res = document.getElementById('search-results');
  res.style.display = 'block';
  res.innerHTML = '<div style="padding:0.75rem;font-size:0.8rem;color:var(--text-3)">Searching…</div>';
  try {
    const data = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`,
      { headers: { 'Accept-Language': 'en' } }
    ).then(r => r.json());

    if (!data.length) {
      res.innerHTML = '<div style="padding:0.75rem;font-size:0.8rem;color:var(--text-3)">No results found.</div>';
      return;
    }

    res.innerHTML = data.map(item => `
      <div onclick="flyToResult(${item.lat},${item.lon},'${escHtml(item.display_name)}')"
        style="padding:0.65rem 0.9rem;cursor:pointer;font-size:0.8rem;color:var(--text);
               border-bottom:1px solid var(--glass-border);transition:background 0.15s;"
        onmouseover="this.style.background='rgba(108,99,255,0.08)'"
        onmouseout="this.style.background=''">
        <div style="font-weight:600">📍 ${escHtml(item.display_name.slice(0, 60))}${item.display_name.length > 60 ? '…' : ''}</div>
      </div>
    `).join('');
  } catch (e) {
    res.innerHTML = '<div style="padding:0.75rem;font-size:0.8rem;color:var(--text-3)">Search unavailable.</div>';
  }
}

function flyToResult(lat, lng, name) {
  map.flyTo([lat, lng], 14, { animate: true, duration: 1 });
  document.getElementById('search-results').style.display = 'none';
  document.getElementById('search-input').value = '';
  showToast(`Flying to ${name.slice(0, 40)}…`, 'info', 2000);
}

document.addEventListener('click', e => {
  if (!e.target.closest('.search-wrap'))
    document.getElementById('search-results').style.display = 'none';
});

/* ─── Route Planner ──────────────────────────────────── */
let routePanelOpen = false;

function toggleRoutePanel() {
  routePanelOpen = !routePanelOpen;
  document.getElementById('route-panel').classList.toggle('open', routePanelOpen);
}

function selectRouteType(type) {
  routeType = type;
  document.getElementById('tag-fastest').classList.toggle('active', type === 'fastest');
  document.getElementById('tag-fastest').classList.toggle('fastest', type === 'fastest');
  document.getElementById('tag-safest').classList.toggle('active', type === 'safest');
  document.getElementById('tag-safest').classList.toggle('safest', type === 'safest');
}

async function planRoute() {
  const fromVal = document.getElementById('route-from').value.trim();
  const toVal   = document.getElementById('route-to').value.trim();
  if (!fromVal || !toVal) { showToast('Enter both start and destination.', 'error'); return; }

  clearRoute();
  showToast('Calculating route…', 'info', 3000);

  try {
    let fromLC, toLC;
    if (fromVal.toLowerCase() === 'me') {
      if (!userLatLng) { showToast("Use 📍 first to get your location.", 'warning'); return; }
      fromLC = L.latLng(userLatLng.lat, userLatLng.lng);
    } else {
      fromLC = await geocode(fromVal);
    }
    toLC = await geocode(toVal);

    if (!fromLC || !toLC) { showToast('Could not resolve locations.', 'error'); return; }

    const waypoints = buildWaypoints(fromLC, toLC);

    routingControl = L.Routing.control({
      waypoints,
      routeWhileDragging: false,
      lineOptions: {
        styles: [{ color: routeType === 'safest' ? '#10b981' : '#6c63ff', weight: 5, opacity: 0.8 }],
      },
      fitSelectedRoutes: true,
      showAlternatives: true,
      createMarker: () => null,
    }).addTo(map);

    routingControl.on('routesfound', e => {
      const route    = e.routes[0];
      const distKm   = (route.summary.totalDistance / 1000).toFixed(1);
      const timeMins = Math.round(route.summary.totalTime / 60);
      const label    = routeType === 'safest' ? '🛡️ Safest' : '⚡ Fastest';
      const info     = document.getElementById('route-info');

      // Calculate route risk
      const routeRisk = calculateRouteRisk(route.coordinates);

      info.innerHTML = `
        <strong>${label} Route</strong> · ${distKm} km · ~${timeMins} min<br/>
        <span style="color:var(--text-3);font-size:0.72rem">${routeType === 'safest' ? 'Avoiding high-risk zones' : 'Optimized for speed'}</span>
        <br/><span style="font-size:0.72rem;font-weight:700;color:${routeRisk >= 10 ? '#ef4444' : routeRisk >= 5 ? '#f59e0b' : '#10b981'}">
          Route Risk Score: ${routeRisk}
        </span>
        ${routeRisk >= 5 ? '<br/><span style="font-size:0.7rem;color:#ef4444;font-weight:600;">⚠️ Safer route available — try 🛡️ Safest</span>' : ''}
      `;
      info.style.display = 'block';
      highlightRouteRisk(route.coordinates);
      showToast(`${label} route: ${distKm} km, ~${timeMins} min`, 'success');
    });

    routingControl.on('routingerror', () => showToast('Routing failed.', 'error'));
  } catch (err) {
    console.error(err);
    showToast('Route planning error.', 'error');
  }
}

async function geocode(query) {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`
  ).then(r => r.json());
  if (!res.length) return null;
  return L.latLng(parseFloat(res[0].lat), parseFloat(res[0].lon));
}

// Calculate risk for an entire route
function calculateRouteRisk(coords) {
  let totalRisk = 0;
  const step = Math.max(1, Math.floor(coords.length / 20)); // sample 20 points
  for (let i = 0; i < coords.length; i += step) {
    totalRisk += calculateRiskScore(coords[i].lat, coords[i].lng, allReports);
  }
  return Math.round(totalRisk / Math.ceil(coords.length / step));
}

function buildWaypoints(from, to) {
  if (routeType === 'fastest') return [from, to];

  const midLat = (from.lat + to.lat) / 2;
  const midLng = (from.lng + to.lng) / 2;
  const highRisk = allReports.filter(r => {
    const score = calculateRiskScore(r.lat, r.lng, allReports);
    return score >= 6 && map.distance([midLat, midLng], [r.lat, r.lng]) < 5000;
  });

  if (!highRisk.length) return [from, to];
  const offset = 0.008;
  const safeMid = L.latLng(midLat + offset, midLng + offset);
  return [from, safeMid, to];
}

let riskRouteOverlays = [];
function highlightRouteRisk(coords) {
  riskRouteOverlays.forEach(l => l.remove());
  riskRouteOverlays = [];
  coords.forEach((c, i) => {
    if (i === 0) return;
    const prev = coords[i - 1];
    const midLat = (c.lat + prev.lat) / 2;
    const midLng = (c.lng + prev.lng) / 2;
    const score = calculateRiskScore(midLat, midLng, allReports);
    if (score >= 4) {
      const overlay = L.polyline([[prev.lat, prev.lng], [c.lat, c.lng]], {
        color: '#ef4444', weight: 6, opacity: 0.45, dashArray: '8,4',
      }).addTo(map);
      overlay.bindTooltip(`⚠️ Risk zone (score: ${score})`, { sticky: true });
      riskRouteOverlays.push(overlay);
    }
  });
}

function clearRoute() {
  if (routingControl) { map.removeControl(routingControl); routingControl = null; }
  riskRouteOverlays.forEach(l => l.remove()); riskRouteOverlays = [];
  document.getElementById('route-info').style.display = 'none';
}

/* ─── SOS ────────────────────────────────────────────── */
function triggerSOS() { openModal('sos-modal'); }

async function sosReportLocation() {
  closeModal('sos-modal');
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(async pos => {
      const { latitude: lat, longitude: lng } = pos.coords;
      const userId = currentUser ? currentUser.uid : 'sos-guest';
      try {
        await SafeNet.addReport({ lat, lng, type: 'unsafe', description: '🆘 SOS — Emergency alert from user', userId });
        showToast('🆘 SOS alert submitted! Stay safe.', 'warning', 6000);
        map.flyTo([lat, lng], 16);
      } catch (e) { showToast('SOS report failed. Call 112 now!', 'error'); }
    }, () => showToast('Cannot get location. Call 112 immediately!', 'error'));
  }
}

/* ─── Modal Helpers ──────────────────────────────────── */
function openModal(id) {
  document.getElementById(id).classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  document.body.style.overflow = '';
}
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeModal(overlay.id);
  });
});

/* ─── Sidebar Toggle ─────────────────────────────────── */
function toggleSidebar() {
  sidebarOpen = !sidebarOpen;
  document.getElementById('sidebar').classList.toggle('collapsed', !sidebarOpen);
}

/* ─── My Reports Panel ───────────────────────────────── */
function togglePanel() {
  document.getElementById('reports-panel').classList.toggle('open');
}

function renderMyReports(reports) {
  const el = document.getElementById('my-reports-list');
  const statsEl = document.getElementById('user-stats');

  if (!reports.length) {
    el.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">📭</div>
      <div class="empty-state-text">No reports yet.</div>
    </div>`;
    statsEl.textContent = '';
    return;
  }

  statsEl.innerHTML = `${reports.length} report${reports.length !== 1 ? 's' : ''} submitted · Keep it up! 🙌`;

  el.innerHTML = reports.map(r => {
    const cfg = TYPE_CONFIG[r.type] || { emoji: '📍', color: '#6c63ff', label: r.type };
    const verBadge = r.verified
      ? '<span class="verified-badge yes">✅ Verified</span>'
      : '<span class="verified-badge no">⏳ Pending</span>';
    return `
    <div class="report-card">
      <div class="report-card-header">
        <span class="report-type-badge" style="background:${cfg.color}22;color:${cfg.color};border:1px solid ${cfg.color}44">
          ${cfg.emoji} ${cfg.label}
        </span>
        <button onclick="handleDeleteReport('${r.id}')"
          style="background:none;border:none;cursor:pointer;color:var(--text-3);font-size:0.85rem;padding:0.2rem;"
          title="Delete report">🗑️</button>
      </div>
      <div class="report-desc">${r.description || '<em style="opacity:0.6">No description.</em>'}</div>
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.3rem;">
        <div class="report-time">🕐 ${timeAgo(r.time)}</div>
        ${verBadge}
        <button onclick="flyToReport(${r.lat},${r.lng})"
          style="background:none;border:none;cursor:pointer;font-size:0.78rem;color:var(--primary);font-weight:600;padding:0;">
          📍 View
        </button>
      </div>
    </div>`;
  }).join('');
}

function flyToReport(lat, lng) {
  map.flyTo([lat, lng], 16, { animate: true, duration: 1 });
  document.getElementById('reports-panel').classList.remove('open');
}

async function handleDeleteReport(id) {
  if (!confirm('Delete this report?')) return;
  try {
    await SafeNet.deleteReport(id);
    showToast('Report deleted.', 'info');
  } catch (e) { showToast('Failed to delete.', 'error'); }
}

/* ─── User Menu ──────────────────────────────────────── */
function toggleUserMenu() {
  const menu = document.getElementById('user-menu');
  menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
}

document.addEventListener('click', e => {
  if (!e.target.closest('#user-menu') && !e.target.closest('#user-avatar'))
    document.getElementById('user-menu').style.display = 'none';
});

async function handleSignOut() {
  try {
    await SafeNet.signOut();
    localStorage.removeItem('sn-guest');
    window.location.href = 'login.html';
  } catch (e) { showToast('Sign out failed.', 'error'); }
}

/* ─── Utility ────────────────────────────────────────── */
function escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ─── Auth Guard + App Init ──────────────────────────── */
SafeNet.onAuthChange(user => {
  const isGuestMode = localStorage.getItem('sn-guest') === '1';

  if (!user && !isGuestMode) {
    window.location.href = 'login.html';
    return;
  }

  // If admin, redirect to admin page
  if (user && user.role === 'admin') {
    window.location.href = 'admin.html';
    return;
  }

  currentUser = user;
  isGuest     = !user && isGuestMode;

  const avatar  = document.getElementById('user-avatar');
  const emailEl = document.getElementById('user-email');
  const roleEl  = document.getElementById('user-role-badge');
  const guestBtn = document.getElementById('guest-sign-in');

  if (user) {
    const initial = (user.displayName || user.email || 'U').charAt(0).toUpperCase();
    avatar.textContent  = initial;
    emailEl.textContent = user.displayName || user.email;
    roleEl.innerHTML    = '<span class="verified-badge yes">👤 User</span>';
    guestBtn.style.display = 'none';
  } else {
    avatar.textContent  = '👤';
    emailEl.textContent = 'Guest Mode';
    roleEl.innerHTML    = '<span class="verified-badge no">👀 Guest</span>';
    guestBtn.style.display = 'block';
  }

  initApp(user, isGuestMode);
});

function initApp(user, isGuestMode) {
  if (!map) initMap();
  const loading = document.getElementById('loading');

  if (unsubscribeReports) unsubscribeReports();
  unsubscribeReports = SafeNet.subscribeToReports(reports => {
    allReports = reports;
    applyFilter();
    loading.classList.add('hidden');
  });

  if (user) {
    if (unsubscribeMyReports) unsubscribeMyReports();
    unsubscribeMyReports = SafeNet.subscribeToUserReports(user.uid, reports => {
      renderMyReports(reports);
    });
  } else if (isGuestMode) {
    renderMyReports([]);
    setTimeout(() => loading.classList.add('hidden'), 800);
  }

  setTimeout(goToMyLocation, 1200);
  showToast(`Welcome to SafeNet ${user ? (user.displayName || '').split(' ')[0] : '(Guest)'}! 🛡️`, 'success', 3000);
}
