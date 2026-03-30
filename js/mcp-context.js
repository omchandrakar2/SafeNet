/**
 * =============================================
 * MCP Context Layer — Unified Safety Platform
 * =============================================
 * Central in-memory data store.
 * All modules read/write data through this object.
 * Implements the MCP contract from the project spec.
 */

const MCP_STORAGE_KEY = 'unified_safety_platform_mcp_v1';

/**
 * MCPContext — the single source of truth.
 * Matches the JSON schemas defined in the MCP spec.
 */
window.MCPContext = {
  /** @type {ComplaintContext[]} */
  complaints: [],

  /** @type {EvidenceContext[]} */
  evidence: [],

  /** @type {SafetyScoreContext[]} */
  safetyScores: [],

  /** Internal event bus */
  _listeners: {},
};

// ─── Event Bus ──────────────────────────────────────────────────────────────
/**
 * Subscribe to MCP events.
 * Events: 'complaint:added', 'complaint:updated', 'evidence:added', 'score:updated', 'context:loaded'
 */
window.MCPContext.on = function(event, callback) {
  if (!this._listeners[event]) this._listeners[event] = [];
  this._listeners[event].push(callback);
};

window.MCPContext.emit = function(event, data) {
  (this._listeners[event] || []).forEach(cb => {
    try { cb(data); } catch(e) { console.error('[MCP emit]', event, e); }
  });
};

// ─── Schema helpers ──────────────────────────────────────────────────────────
/**
 * @typedef {Object} ComplaintContext
 * @property {'complaint'} type
 * @property {string} id
 * @property {string} title
 * @property {string} description
 * @property {'harassment'|'theft'|'accident'} category
 * @property {{name:string, lat:number, lng:number}} location
 * @property {'pending'|'in_progress'|'resolved'} status
 * @property {string} timestamp  ISO date
 */

/**
 * @typedef {Object} EvidenceContext
 * @property {'evidence'} type
 * @property {string} complaintId
 * @property {string} fileName
 * @property {string} hash  SHA-256 hex
 * @property {number} fileSize  bytes
 * @property {string} uploadedAt  ISO date
 */

/**
 * @typedef {Object} SafetyScoreContext
 * @property {'safety_score'} type
 * @property {string} location
 * @property {number} lat
 * @property {number} lng
 * @property {number} score  0-10
 * @property {'low'|'medium'|'high'} riskLevel
 * @property {string[]} basedOn  complaint IDs
 */

// ─── Load from localStorage on init ─────────────────────────────────────────
(function initMCPContext() {
  try {
    const raw = localStorage.getItem(MCP_STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved.complaints)   window.MCPContext.complaints   = saved.complaints;
      if (saved.evidence)     window.MCPContext.evidence     = saved.evidence;
      if (saved.safetyScores) window.MCPContext.safetyScores = saved.safetyScores;
      console.log('[MCP] Context loaded from localStorage:', {
        complaints: window.MCPContext.complaints.length,
        evidence:   window.MCPContext.evidence.length,
        scores:     window.MCPContext.safetyScores.length,
      });
    } else {
      console.log('[MCP] No saved context found — fresh start.');
    }
    window.MCPContext.emit('context:loaded', window.MCPContext);
  } catch(e) {
    console.error('[MCP] Failed to load context from localStorage:', e);
  }
})();
