/**
 * GHOST-NEXT Overlay Module
 *
 * Ferrari UI components and overlay management.
 * This module exports overlay creation and control functions.
 */

/**
 * Overlay configuration
 */
const OVERLAY_CONFIG = {
  width: 400,
  height: 500,
  position: 'bottom-right',
  theme: {
    primary: '#e94560',
    background: '#1a1a2e',
    surface: '#16213e',
    border: '#0f3460',
    text: '#ffffff',
    textMuted: '#888888',
    success: '#4ade80',
    info: '#60a5fa'
  }
};

/**
 * Create the overlay styles
 */
function createOverlayStyles(theme) {
  return `
    * { box-sizing: border-box; margin: 0; padding: 0; }

    .ghost-overlay {
      position: fixed;
      width: ${OVERLAY_CONFIG.width}px;
      max-height: ${OVERLAY_CONFIG.height}px;
      background: ${theme.background};
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: ${theme.text};
      display: flex;
      flex-direction: column;
      overflow: hidden;
      transition: all 0.3s ease;
    }

    .ghost-overlay.minimized {
      width: 60px;
      height: 60px;
      border-radius: 30px;
    }

    .ghost-overlay.position-bottom-right {
      bottom: 20px;
      right: 20px;
    }

    .ghost-overlay.position-bottom-left {
      bottom: 20px;
      left: 20px;
    }

    .ghost-overlay.position-top-right {
      top: 20px;
      right: 20px;
    }

    .ghost-overlay.position-top-left {
      top: 20px;
      left: 20px;
    }

    /* Header */
    .overlay-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      background: ${theme.surface};
      border-bottom: 1px solid ${theme.border};
      cursor: move;
    }

    .overlay-title {
      font-size: 14px;
      font-weight: 600;
      color: ${theme.primary};
    }

    /* Tabs */
    .overlay-tabs {
      display: flex;
      background: ${theme.surface};
      border-bottom: 1px solid ${theme.border};
    }

    .overlay-tab {
      flex: 1;
      padding: 10px;
      text-align: center;
      font-size: 12px;
      cursor: pointer;
      border: none;
      background: transparent;
      color: ${theme.textMuted};
      transition: all 0.2s;
    }

    .overlay-tab:hover { color: ${theme.text}; }
    .overlay-tab.active {
      color: ${theme.primary};
      border-bottom: 2px solid ${theme.primary};
    }

    /* Content */
    .overlay-content {
      flex: 1;
      overflow: hidden;
    }

    .overlay-panel {
      display: none;
      height: 100%;
      overflow-y: auto;
      padding: 12px;
    }

    .overlay-panel.active { display: block; }

    /* Recording Indicator */
    .recording-indicator {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: rgba(233, 69, 96, 0.1);
      border-radius: 6px;
    }

    .recording-indicator .dot {
      width: 8px;
      height: 8px;
      background: ${theme.primary};
      border-radius: 50%;
      animation: blink 1s infinite;
    }

    @keyframes blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }

    /* Transcript Items */
    .transcript-item {
      padding: 10px 12px;
      background: ${theme.surface};
      border-radius: 8px;
      margin-bottom: 8px;
      font-size: 13px;
      line-height: 1.5;
    }

    .transcript-speaker {
      font-size: 11px;
      font-weight: 600;
      margin-bottom: 4px;
    }

    .transcript-speaker.provider { color: ${theme.success}; }
    .transcript-speaker.patient { color: ${theme.info}; }

    .transcript-text { color: #ccc; }

    .transcript-time {
      font-size: 10px;
      color: ${theme.textMuted};
      margin-top: 4px;
    }

    /* Buttons */
    .btn {
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
    }

    .btn-primary {
      background: ${theme.primary};
      border: none;
      color: ${theme.text};
    }

    .btn-primary:hover { background: #d63d56; }

    .btn-secondary {
      background: transparent;
      border: 1px solid ${theme.border};
      color: ${theme.text};
    }

    .btn-secondary:hover { background: ${theme.surface}; }

    /* Form Elements */
    .form-input {
      width: 100%;
      padding: 10px 12px;
      background: ${theme.surface};
      border: 1px solid ${theme.border};
      border-radius: 6px;
      color: ${theme.text};
      font-size: 13px;
    }

    .form-input:focus {
      outline: none;
      border-color: ${theme.primary};
    }

    .form-label {
      display: block;
      font-size: 11px;
      color: ${theme.textMuted};
      margin-bottom: 4px;
    }

    .form-group { margin-bottom: 12px; }

    /* Status Badge */
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 500;
    }

    .status-badge.connected {
      background: rgba(74, 222, 128, 0.1);
      color: ${theme.success};
    }

    .status-badge.disconnected {
      background: rgba(233, 69, 96, 0.1);
      color: ${theme.primary};
    }

    .status-badge.recording {
      background: rgba(233, 69, 96, 0.2);
      color: ${theme.primary};
    }
  `;
}

/**
 * Overlay state management
 */
class OverlayState {
  constructor() {
    this.isMinimized = false;
    this.isRecording = false;
    this.isConnected = false;
    this.activeTab = 'recorder';
    this.position = OVERLAY_CONFIG.position;
    this.transcripts = [];
    this.listeners = new Map();
  }

  set(key, value) {
    this[key] = value;
    this.emit(key, value);
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  emit(event, data) {
    const callbacks = this.listeners.get(event) || [];
    callbacks.forEach(cb => cb(data));
  }

  addTranscript(transcript) {
    // Remove interim if this is final
    if (transcript.isFinal) {
      this.transcripts = this.transcripts.filter(t => !t.isInterim);
    } else {
      // Remove previous interim
      this.transcripts = this.transcripts.filter(t => !t.isInterim);
      transcript.isInterim = true;
    }
    this.transcripts.push(transcript);
    this.emit('transcripts', this.transcripts);
  }

  clearTranscripts() {
    this.transcripts = [];
    this.emit('transcripts', this.transcripts);
  }
}

/**
 * Create overlay controller
 */
function createOverlayController(shadowRoot, state) {
  const controller = {
    shadowRoot,
    state,

    setTab(tabName) {
      state.set('activeTab', tabName);

      // Update UI
      shadowRoot.querySelectorAll('.overlay-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabName);
      });
      shadowRoot.querySelectorAll('.overlay-panel').forEach(panel => {
        panel.classList.toggle('active', panel.dataset.tab === tabName);
      });
    },

    minimize() {
      state.set('isMinimized', true);
      shadowRoot.querySelector('.ghost-overlay').classList.add('minimized');
    },

    expand() {
      state.set('isMinimized', false);
      shadowRoot.querySelector('.ghost-overlay').classList.remove('minimized');
    },

    setPosition(position) {
      const overlay = shadowRoot.querySelector('.ghost-overlay');
      overlay.classList.remove(`position-${state.position}`);
      state.set('position', position);
      overlay.classList.add(`position-${position}`);
    },

    updateConnectionStatus(connected) {
      state.set('isConnected', connected);
      const badge = shadowRoot.querySelector('.status-badge');
      if (badge) {
        badge.className = `status-badge ${connected ? 'connected' : 'disconnected'}`;
        badge.textContent = connected ? 'Connected' : 'Disconnected';
      }
    },

    updateRecordingStatus(recording) {
      state.set('isRecording', recording);
      const indicator = shadowRoot.querySelector('.recording-indicator');
      if (indicator) {
        indicator.style.display = recording ? 'flex' : 'none';
      }
    },

    renderTranscripts() {
      const container = shadowRoot.querySelector('.transcript-list');
      if (!container) return;

      container.innerHTML = state.transcripts.map(t => `
        <div class="transcript-item ${t.isInterim ? 'interim' : ''}">
          <div class="transcript-speaker ${t.speaker === 0 ? 'provider' : 'patient'}">
            ${t.speaker === 0 ? 'Provider' : 'Patient'}
          </div>
          <div class="transcript-text">${escapeHtml(t.text)}</div>
          ${t.start !== undefined ? `<div class="transcript-time">${formatTime(t.start)}</div>` : ''}
        </div>
      `).join('');

      container.scrollTop = container.scrollHeight;
    }
  };

  // Subscribe to state changes
  state.on('transcripts', () => controller.renderTranscripts());

  return controller;
}

/**
 * Format time in seconds to mm:ss
 */
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Make overlay draggable
 */
function makeDraggable(element, handle) {
  let isDragging = false;
  let startX, startY;
  let startLeft, startTop;

  handle.addEventListener('mousedown', (e) => {
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;

    const rect = element.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;

    element.style.transition = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    element.style.left = `${startLeft + dx}px`;
    element.style.top = `${startTop + dy}px`;
    element.style.right = 'auto';
    element.style.bottom = 'auto';
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      element.style.transition = '';
    }
  });
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    OVERLAY_CONFIG,
    createOverlayStyles,
    OverlayState,
    createOverlayController,
    makeDraggable,
    formatTime,
    escapeHtml
  };
}
