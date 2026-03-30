/**
 * =====================================================
 * SAFENET — Auth + Data Layer (localStorage‑based)
 * =====================================================
 * Drop‑in module that provides Firebase‑style APIs
 * backed by localStorage so the app runs instantly
 * without any cloud setup.
 *
 * Exports everything on window.SafeNet
 * =====================================================
 */

/* ─── Storage Keys ─────────────────────────────────── */
const SK = {
  USERS:   'sn-users',
  SESSION: 'sn-session',
  REPORTS: 'sn-reports',
};

/* ─── Helpers ──────────────────────────────────────── */
const load  = (k, fb = null) => { try { return JSON.parse(localStorage.getItem(k)) || fb; } catch { return fb; } };
const save  = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const genId = () => 'id_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);

/* ─── Internal State ───────────────────────────────── */
let _authCbs      = [];
let _reportCbs    = [];
let _userRptCbs   = [];
let _currentUser  = null;

// Restore session
(function boot() {
  const uid = load(SK.SESSION);
  if (uid) {
    const u = (load(SK.USERS, [])).find(u => u.uid === uid);
    if (u) _currentUser = { uid: u.uid, email: u.email, displayName: u.displayName, role: u.role };
  }
})();

/* ─── Notify ───────────────────────────────────────── */
function _fireAuth()   { _authCbs.forEach(cb => { try { cb(_currentUser); } catch(e) { console.error(e); } }); }
function _fireReports() {
  const rpts = _allReports();
  _reportCbs.forEach(cb => { try { cb(rpts); } catch(e) { console.error(e); } });
}
function _fireUserReports(uid) {
  const rpts = _allReports().filter(r => r.userId === uid);
  _userRptCbs.forEach(({ uid: u, cb }) => { if (u === uid) { try { cb(rpts); } catch(e) { console.error(e); } } });
}

function _allReports() {
  return load(SK.REPORTS, []).map(r => ({
    ...r,
    time: new Date(r.createdAt || Date.now()),
  })).sort((a, b) => b.time - a.time);
}

/* ─── SHA‑256 ──────────────────────────────────────── */
async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ─── AUTH ──────────────────────────────────────────── */
function getCurrentUser() { return _currentUser; }

function onAuthChange(cb) {
  _authCbs.push(cb);
  setTimeout(() => { try { cb(_currentUser); } catch(e) { console.error(e); } }, 0);
}

async function signUp(email, password, displayName, role = 'user') {
  email = email.toLowerCase().trim();
  if (!email || !password) throw { code: 'auth/invalid-email' };
  if (password.length < 6)  throw { code: 'auth/weak-password' };
  const users = load(SK.USERS, []);
  if (users.find(u => u.email === email)) throw { code: 'auth/email-already-in-use' };

  const uid = genId();
  const user = { uid, email, password, displayName: displayName || '', role };
  users.push(user);
  save(SK.USERS, users);

  _currentUser = { uid, email, displayName: user.displayName, role };
  save(SK.SESSION, uid);
  _fireAuth();
  return _currentUser;
}

async function signIn(email, password) {
  email = email.toLowerCase().trim();
  const users = load(SK.USERS, []);
  const u = users.find(u => u.email === email);
  if (!u) throw { code: 'auth/user-not-found' };
  if (u.password !== password) throw { code: 'auth/wrong-password' };

  _currentUser = { uid: u.uid, email: u.email, displayName: u.displayName, role: u.role };
  save(SK.SESSION, u.uid);
  _fireAuth();
  return _currentUser;
}

async function signOut() {
  _currentUser = null;
  localStorage.removeItem(SK.SESSION);
  _fireAuth();
}

function getUserRole() {
  return _currentUser ? _currentUser.role : null;
}

/* ─── ANTI‑SPAM ────────────────────────────────────── */
const SPAM_LIMITS = { maxPerHour: 10, minDistMeters: 50 };

function checkSpam(userId, lat, lng) {
  const reports = load(SK.REPORTS, []);
  const oneHourAgo = Date.now() - 3600000;

  // Rate limit
  const recentCount = reports.filter(r => r.userId === userId && new Date(r.createdAt).getTime() > oneHourAgo).length;
  if (recentCount >= SPAM_LIMITS.maxPerHour) return { blocked: true, reason: 'Rate limit: max 10 reports per hour.' };

  // Duplicate location check (within 50m in last 10 min)
  const tenMinAgo = Date.now() - 600000;
  const dup = reports.find(r => {
    if (r.userId !== userId) return false;
    if (new Date(r.createdAt).getTime() < tenMinAgo) return false;
    const d = _haversine(lat, lng, r.lat, r.lng);
    return d < SPAM_LIMITS.minDistMeters;
  });
  if (dup) return { blocked: true, reason: 'Duplicate: you already reported near this location recently.' };

  return { blocked: false };
}

function _haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = x => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

/* ─── REPORTS CRUD ─────────────────────────────────── */
async function addReport({ lat, lng, type, description, userId, evidenceHash }) {
  const id = genId();
  const createdAt = new Date().toISOString();
  const contentHash = await sha256(`${lat}_${lng}_${type}_${userId}_${Date.now()}`);

  const report = {
    id, lat, lng, type, description, userId, createdAt,
    integrityHash: contentHash,
    evidenceHash: evidenceHash || null,
    verified: false,        // admin verification
    verifiedBy: null,
    verifiedAt: null,
  };

  const reports = load(SK.REPORTS, []);
  reports.unshift(report);
  save(SK.REPORTS, reports);
  _fireReports();
  if (userId) _fireUserReports(userId);
  return id;
}

function subscribeToReports(cb) {
  _reportCbs.push(cb);
  setTimeout(() => { try { cb(_allReports()); } catch(e) { console.error(e); } }, 0);
  return () => { _reportCbs = _reportCbs.filter(c => c !== cb); };
}

function subscribeToUserReports(uid, cb) {
  const entry = { uid, cb };
  _userRptCbs.push(entry);
  setTimeout(() => { try { cb(_allReports().filter(r => r.userId === uid)); } catch(e) { console.error(e); } }, 0);
  return () => { _userRptCbs = _userRptCbs.filter(e => e !== entry); };
}

async function deleteReport(reportId) {
  let reports = load(SK.REPORTS, []);
  reports = reports.filter(r => r.id !== reportId);
  save(SK.REPORTS, reports);
  _fireReports();
  _userRptCbs.forEach(({ uid }) => _fireUserReports(uid));
}

async function verifyReport(reportId, adminId) {
  const reports = load(SK.REPORTS, []);
  const r = reports.find(r => r.id === reportId);
  if (r) {
    r.verified = true;
    r.verifiedBy = adminId;
    r.verifiedAt = new Date().toISOString();
    save(SK.REPORTS, reports);
    _fireReports();
  }
}

async function unverifyReport(reportId) {
  const reports = load(SK.REPORTS, []);
  const r = reports.find(r => r.id === reportId);
  if (r) {
    r.verified = false;
    r.verifiedBy = null;
    r.verifiedAt = null;
    save(SK.REPORTS, reports);
    _fireReports();
  }
}

function getReportById(reportId) {
  return load(SK.REPORTS, []).find(r => r.id === reportId) || null;
}

function getAllUsers() {
  return load(SK.USERS, []).map(u => ({ uid: u.uid, email: u.email, displayName: u.displayName, role: u.role }));
}

/* ─── EXPORT ───────────────────────────────────────── */
window.SafeNet = {
  getCurrentUser, onAuthChange, getUserRole,
  signUp, signIn, signOut,
  sha256, checkSpam,
  addReport, subscribeToReports, subscribeToUserReports,
  deleteReport, verifyReport, unverifyReport, getReportById,
  getAllUsers,
};
