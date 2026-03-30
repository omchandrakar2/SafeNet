/**
 * =============================================
 * MCP Functions — Unified Safety Platform
 * =============================================
 * The official MCP API.
 * All components call these functions — never mutate MCPContext directly.
 *
 * Depends on: mcp-context.js, storage.js
 */

// ─── Utilities ───────────────────────────────────────────────────────────────

function generateId() {
  return 'cmp_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

function generateEvidenceId() {
  return 'evd_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

// ─── SHA-256 Hashing ─────────────────────────────────────────────────────────

/**
 * Generate SHA-256 hash of a File using Web Crypto API.
 * @param {File} file
 * @returns {Promise<string>} hex hash string
 */
async function generateSHA256(file) {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray  = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── MCP: Add Complaint ──────────────────────────────────────────────────────

/**
 * Add a new complaint to the context.
 * Triggers safety score recalculation + storage sync.
 *
 * @param {Object} data
 * @param {string} data.title
 * @param {string} data.description
 * @param {'harassment'|'theft'|'accident'} data.category
 * @param {{name:string, lat:number, lng:number}} data.location
 * @returns {ComplaintContext} the created complaint
 */
window.addComplaint = function(data) {
  const complaint = {
    type:        'complaint',
    id:          generateId(),
    title:       data.title,
    description: data.description,
    category:    data.category,
    location: {
      name: data.location.name,
      lat:  parseFloat(data.location.lat) || 0,
      lng:  parseFloat(data.location.lng) || 0,
    },
    status:    'pending',
    timestamp: new Date().toISOString(),
  };

  window.MCPContext.complaints.push(complaint);
  console.log('[MCP] Complaint added:', complaint.id, complaint.title);

  updateSafetyScore(complaint.location);
  saveToStorage();
  window.MCPContext.emit('complaint:added', complaint);

  return complaint;
};

// ─── MCP: Update Status ──────────────────────────────────────────────────────

/**
 * Update the status of an existing complaint.
 * @param {string} id  complaint id
 * @param {'pending'|'in_progress'|'resolved'} status
 */
window.updateStatus = function(id, status) {
  const c = window.MCPContext.complaints.find(c => c.id === id);
  if (!c) { console.warn('[MCP] updateStatus: complaint not found', id); return; }
  c.status = status;
  console.log('[MCP] Status updated:', id, '->', status);
  saveToStorage();
  window.MCPContext.emit('complaint:updated', c);
};

// ─── MCP: Add Evidence ───────────────────────────────────────────────────────

/**
 * Hash a file with SHA-256 and attach it as evidence to a complaint.
 * @param {File}   file
 * @param {string} complaintId
 * @returns {Promise<EvidenceContext>}
 */
window.addEvidence = async function(file, complaintId) {
  const hash = await generateSHA256(file);
  const evidence = {
    type:        'evidence',
    id:          generateEvidenceId(),
    complaintId: complaintId || 'unlinked',
    fileName:    file.name,
    fileSize:    file.size,
    hash:        hash,
    uploadedAt:  new Date().toISOString(),
  };
  window.MCPContext.evidence.push(evidence);
  console.log('[MCP] Evidence added:', evidence.fileName, 'SHA-256:', hash.slice(0, 16) + '...');
  saveToStorage();
  window.MCPContext.emit('evidence:added', evidence);
  return evidence;
};

// ─── MCP: Calculate Safety Score ────────────────────────────────────────────

/**
 * Recalculate and upsert the safety score for a location.
 * Score starts at 10 and decreases based on complaint categories.
 * @param {{name:string, lat:number, lng:number}} location
 */
window.updateSafetyScore = function(location) {
  const locationName = location.name;

  // Find all complaints for this location
  const locationComplaints = window.MCPContext.complaints.filter(
    c => c.location.name.toLowerCase() === locationName.toLowerCase()
  );

  let score = 10;
  locationComplaints.forEach(c => {
    if (c.category === 'harassment') score -= 2;
    if (c.category === 'theft')      score -= 1.5;
    if (c.category === 'accident')   score -= 1;
  });
  score = Math.max(0, parseFloat(score.toFixed(1)));

  const riskLevel = score >= 7 ? 'low' : score >= 4 ? 'medium' : 'high';

  const existing = window.MCPContext.safetyScores.findIndex(
    s => s.location.toLowerCase() === locationName.toLowerCase()
  );

  const scoreObj = {
    type:      'safety_score',
    location:  locationName,
    lat:       location.lat  || 0,
    lng:       location.lng  || 0,
    score:     score,
    riskLevel: riskLevel,
    basedOn:   locationComplaints.map(c => c.id),
  };

  if (existing >= 0) {
    window.MCPContext.safetyScores[existing] = scoreObj;
  } else {
    window.MCPContext.safetyScores.push(scoreObj);
  }

  console.log('[MCP] Safety score updated:', locationName, '->', score, '(' + riskLevel + ')');
  window.MCPContext.emit('score:updated', scoreObj);
};

// ─── MCP: Accessors ──────────────────────────────────────────────────────────

window.getComplaints   = () => window.MCPContext.complaints;
window.getEvidence     = () => window.MCPContext.evidence;
window.getSafetyScores = () => window.MCPContext.safetyScores;

window.getComplaintById = (id) =>
  window.MCPContext.complaints.find(c => c.id === id) || null;

window.getEvidenceByComplaint = (complaintId) =>
  window.MCPContext.evidence.filter(e => e.complaintId === complaintId);

// ─── Delete Complaint ────────────────────────────────────────────────────────

window.deleteComplaint = function(id) {
  const idx = window.MCPContext.complaints.findIndex(c => c.id === id);
  if (idx === -1) return;
  const removed = window.MCPContext.complaints.splice(idx, 1)[0];
  // Remove orphan evidence
  window.MCPContext.evidence = window.MCPContext.evidence.filter(e => e.complaintId !== id);
  // Recalculate score for that location
  updateSafetyScore(removed.location);
  saveToStorage();
  window.MCPContext.emit('complaint:updated', { id, deleted: true });
  console.log('[MCP] Complaint deleted:', id);
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

window.getStats = function() {
  const complaints = window.MCPContext.complaints;
  return {
    total:      complaints.length,
    pending:    complaints.filter(c => c.status === 'pending').length,
    inProgress: complaints.filter(c => c.status === 'in_progress').length,
    resolved:   complaints.filter(c => c.status === 'resolved').length,
    evidence:   window.MCPContext.evidence.length,
    avgScore:   window.MCPContext.safetyScores.length
      ? (window.MCPContext.safetyScores.reduce((s, x) => s + x.score, 0) /
         window.MCPContext.safetyScores.length).toFixed(1)
      : '--',
  };
};

window.formatDate = function(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

window.categoryIcon = function(cat) {
  return { harassment: '😡', theft: '🔓', accident: '🚗' }[cat] || '📋';
};

window.categoryColor = function(cat) {
  return { harassment: 'pink', theft: 'yellow', accident: 'cyan' }[cat] || 'gray';
};

window.riskColor = function(level) {
  return { low: 'green', medium: 'yellow', high: 'red' }[level] || 'gray';
};

window.scoreRingClass = function(score) {
  if (score >= 7) return 'safe';
  if (score >= 4) return 'medium';
  return 'danger';
};

window.formatBytes = function(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB';
  return (bytes/1024/1024).toFixed(1) + ' MB';
};
