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

/* ─── SEED DATABASE (Indian realistic data, clean) ─── */
(function seedIndiaDatabase() {
  const SEED_VERSION = 'v1.2-women-safety';
  // Delete pre existing if version doesn't match
  if (localStorage.getItem('sn-seed-version') !== SEED_VERSION) {
    localStorage.removeItem(SK.REPORTS);
    
    const indiaReports = [
      // existing 10
      { type: 'theft', lat: 28.6139, lng: 77.2090, desc: 'Purse snatched by two men on a bike while waiting for auto.', user: 'seed-admin' },
      { type: 'harassment', lat: 28.5355, lng: 77.2910, desc: 'Group of men catcalling and passing lewd comments at girls passing by.', user: 'seed-admin' },
      { type: 'unsafe', lat: 19.0760, lng: 72.8777, desc: 'Street lights are broken, makes it extremely unsafe for women to walk back from work.', user: 'seed-admin' },
      { type: 'theft', lat: 19.1136, lng: 72.8697, desc: 'Phone snatched from a girl\'s hand near the auto stand.', user: 'seed-admin' },
      { type: 'unsafe', lat: 12.9716, lng: 77.5946, desc: 'Very dark stretch, no active police patrol. Women should avoid walking alone here at night.', user: 'seed-admin' },
      { type: 'vandalism', lat: 12.9352, lng: 77.6245, desc: 'Street CCTV cameras have been broken, leaving this alley completely unmonitored for women.', user: 'seed-admin' },
      { type: 'assault', lat: 13.0827, lng: 80.2707, desc: 'A woman was inappropriately touched in the crowded market.', user: 'seed-admin' },
      { type: 'stalking', lat: 22.5726, lng: 88.3639, desc: 'I was followed by a man for three blocks until I entered a crowded shop.', user: 'seed-admin' },
      { type: 'unsafe', lat: 17.3850, lng: 78.4867, desc: 'Isolated underpass with no lighting. Feels very unsafe for solo female travelers.', user: 'seed-admin' },
      { type: 'theft', lat: 18.5204, lng: 73.8567, desc: 'Gold chain snatched from a lady walking home.', user: 'seed-admin' },
      
      // clustered points in busy/unsafe zones
      { type: 'theft', lat: 28.6505, lng: 77.2303, desc: 'Handbag stolen in the crowded market. Warn other female shoppers.', user: 'seed-admin' },
      { type: 'assault', lat: 28.6692, lng: 77.4538, desc: 'Drunk men harassing women near the dhaba. Very hostile environment.', user: 'seed-admin' },
      { type: 'unsafe', lat: 28.5562, lng: 77.1000, desc: 'Isolated road; female cab drivers advise not taking this route post 8 PM.', user: 'seed-admin' },
      { type: 'harassment', lat: 19.0443, lng: 72.8205, desc: 'Frequent eve-teasing by men sitting at the corner tea stall.', user: 'seed-admin' },
      { type: 'theft', lat: 19.0660, lng: 72.8830, desc: 'Women\'s compartment at the local station had multiple purse pickpocketing incidents today.', user: 'seed-admin' },
      { type: 'unsafe', lat: 19.0380, lng: 72.8538, desc: 'Path feels very unsafe for young girls returning from tuition.', user: 'seed-admin' },
      { type: 'theft', lat: 12.9771, lng: 77.5714, desc: 'Backpack slashed and wallet stolen from a college girl in the bus crowd.', user: 'seed-admin' },
      { type: 'stalking', lat: 12.9141, lng: 77.6308, desc: 'Auto driver kept trailing a girl who was walking alone.', user: 'seed-admin' },
      { type: 'unsafe', lat: 12.9172, lng: 77.6228, desc: 'No safe crossing for women. Have to endure creeps at the junction for long minutes.', user: 'seed-admin' },
      { type: 'harassment', lat: 13.0489, lng: 80.2425, desc: 'Verbal abuse and staring making women commuters very uncomfortable at the depot.', user: 'seed-admin' },
      { type: 'theft', lat: 22.5851, lng: 88.3468, desc: 'Pickpockets continuously targeting women\'s purses at this tourist hotspot.', user: 'seed-admin' },
      { type: 'stalking', lat: 22.5535, lng: 88.3514, desc: 'Man has been repeatedly following college girls through these alleys.', user: 'seed-admin' },

      // Tier 1 & 2 cities spread
      { type: 'assault', lat: 26.9124, lng: 75.7873, desc: 'A woman reported groping in the bus stand parking. Police were called.', user: 'seed-admin' },
      { type: 'unsafe', lat: 26.8467, lng: 80.9462, desc: 'Dark construction site with laborers passing inappropriate comments at women.', user: 'seed-admin' },
      { type: 'theft', lat: 23.0225, lng: 72.5714, desc: 'Tote bag stolen off a woman\'s two-wheeler parked outside the mall.', user: 'seed-admin' },
      { type: 'vandalism', lat: 21.1702, lng: 72.8311, desc: 'Women\'s washroom facilities intentionally vandalized and doors broken.', user: 'seed-admin' },
      { type: 'harassment', lat: 26.4499, lng: 80.3319, desc: 'Boys on bikes eve-teasing female students near the college gates.', user: 'seed-admin' },
      { type: 'unsafe', lat: 21.1458, lng: 79.0882, desc: 'No safe pedestrian path. Women forced to walk very close to hostile traffic.', user: 'seed-admin' },
      { type: 'theft', lat: 22.7196, lng: 75.8577, desc: 'Woman\'s cycle stolen from outside the ladies\' coaching center.', user: 'seed-admin' },
      { type: 'stalking', lat: 23.2599, lng: 77.4126, desc: 'Car slowly trailing solo female pedestrian late at night. Scary experience.', user: 'seed-admin' },
      { type: 'theft', lat: 25.5941, lng: 85.1376, desc: 'Bikers snatching phones directly from women\'s hands near checking point.', user: 'seed-admin' },
      { type: 'assault', lat: 22.3072, lng: 73.1812, desc: 'Physical harassment against a female vendor reported inside the crowded market.', user: 'seed-admin' },
      { type: 'unsafe', lat: 30.9010, lng: 75.8573, desc: 'Street remains deserted post 7 PM, totally unsafe for solo female travel.', user: 'seed-admin' },
      { type: 'harassment', lat: 27.1767, lng: 78.0081, desc: 'Female tourists facing extremely aggressive and inappropriate touts.', user: 'seed-admin' },
      { type: 'unsafe', lat: 25.3176, lng: 82.9739, desc: 'Congested ghat path where women frequently report feeling unsafe and groped.', user: 'seed-admin' },
      { type: 'vandalism', lat: 28.9845, lng: 77.7064, desc: 'Street lights systematically broken creating dark spots dangerous for women.', user: 'seed-admin' },
      { type: 'theft', lat: 31.6340, lng: 74.8723, desc: 'Valuables stolen from a woman\'s parked car while she went to the pharmacy.', user: 'seed-admin' },
      { type: 'harassment', lat: 25.4358, lng: 81.8463, desc: 'Drunk groups creating a nuisance and making girls feel extremely unsafe at the river banks.', user: 'seed-admin' },
      { type: 'unsafe', lat: 23.3441, lng: 85.3096, desc: 'Lack of streetlights makes it terrifying for women working night shifts to commute.', user: 'seed-admin' },
      { type: 'theft', lat: 26.1445, lng: 91.7362, desc: 'Pickpocketing targeting women carrying hand-purses at the ferry terminal.', user: 'seed-admin' },
      { type: 'stalking', lat: 30.7333, lng: 76.7794, desc: 'A girl was followed by a white SUV for 2 kilometers. Be very careful here.', user: 'seed-admin' },
      { type: 'unsafe', lat: 20.2961, lng: 85.8245, desc: 'Isolated area behind the bus stand. Multiple reports of women feeling unsafe.', user: 'seed-admin' },
      { type: 'vandalism', lat: 30.3165, lng: 78.0322, desc: 'Emergency SOS poles for women deliberately damaged by miscreants.', user: 'seed-admin' },
      { type: 'assault', lat: 9.9312, lng: 76.2673, desc: 'A woman reported being pushed and harassed outside a local pub late night.', user: 'seed-admin' },
      { type: 'unsafe', lat: 8.5241, lng: 76.9366, desc: 'Pitch dark walkway near the station. Avoid completely after dusk, ladies.', user: 'seed-admin' },
      { type: 'theft', lat: 11.0168, lng: 76.9558, desc: 'Gold chain snatched from an elderly lady taking a walk in the park.', user: 'seed-admin' },
      { type: 'harassment', lat: 9.9252, lng: 78.1198, desc: 'Unwanted advances and inappropriate comments by shopkeeper towards female customers.', user: 'seed-admin' },
      { type: 'unsafe', lat: 27.8974, lng: 78.0880, desc: 'Highway patch with frequent incidents targeting cars driven by solo women.', user: 'seed-admin' }
    ];

    const seededData = indiaReports.map((r, i) => {
      // spread times over the last few hours
      const pastTime = Date.now() - (i * 3600000 * 2.5); 
      return {
        id: 'id_seed_' + i + '_' + Math.random().toString(36).slice(2, 9),
        lat: r.lat,
        lng: r.lng,
        type: r.type,
        description: r.desc,
        userId: r.user,
        createdAt: new Date(pastTime).toISOString(),
        integrityHash: 'seed-hash-1234',
        evidenceHash: null,
        verified: i % 2 === 0, // Half are verified
        verifiedBy: i % 2 === 0 ? 'admin_seed' : null,
        verifiedAt: i % 2 === 0 ? new Date(pastTime + 1000).toISOString() : null,
      };
    });

    localStorage.setItem(SK.REPORTS, JSON.stringify(seededData));
    localStorage.setItem('sn-seed-version', SEED_VERSION);
    console.log("Seeded database with realistic Indian data.");
  }
})();
