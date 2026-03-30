/**
 * =============================================
 * Storage Layer — Unified Safety Platform
 * =============================================
 * Handles persistence between sessions using localStorage.
 * Called by mcp-functions.js after every mutation.
 */

/**
 * Persist the full MCPContext to localStorage.
 * Called automatically after every MCP mutation.
 */
window.saveToStorage = function() {
  try {
    const payload = {
      complaints:   window.MCPContext.complaints,
      evidence:     window.MCPContext.evidence,
      safetyScores: window.MCPContext.safetyScores,
      _savedAt:     new Date().toISOString(),
    };
    localStorage.setItem('unified_safety_platform_mcp_v1', JSON.stringify(payload));
    console.log('[Storage] Context saved.', new Date().toLocaleTimeString());
  } catch(e) {
    console.error('[Storage] Failed to save:', e);
  }
};

/**
 * Wipe all MCP data (use carefully — for reset/demo).
 */
window.clearStorage = function() {
  localStorage.removeItem('unified_safety_platform_mcp_v1');
  window.MCPContext.complaints   = [];
  window.MCPContext.evidence     = [];
  window.MCPContext.safetyScores = [];
  console.log('[Storage] All data cleared.');
};
