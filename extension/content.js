/**
 * GHOST-NEXT Content Script
 *
 * Injected into all pages. Responsibilities:
 * - Inject Ferrari overlay into Shadow DOM
 * - Connect to backend WebSocket
 * - Capture audio from page/mic
 * - Stream audio to backend
 * - Display transcripts in overlay
 */

(function() {
  'use strict';

  const BACKEND_URL = 'ws://localhost:3001/ws';

  // State
  let ws = null;
  let mediaStream = null;
  let audioContext = null;
  let processor = null;
  let isRecording = false;
  let userId = 'user-' + Date.now();
  let overlayContainer = null;

  /**
   * Initialize the extension
   */
  function init() {
    console.log('[GHOST] Content script initializing...');

    // Create overlay container with Shadow DOM
    createOverlayContainer();

    // Connect to backend
    connectWebSocket();

    // Listen for messages from background script
    chrome.runtime.onMessage.addListener(handleBackgroundMessage);

    console.log('[GHOST] Content script ready');
  }

  /**
   * Create Shadow DOM container for overlay
   */
  function createOverlayContainer() {
    overlayContainer = document.createElement('div');
    overlayContainer.id = 'ghost-overlay-root';
    overlayContainer.style.cssText = `
      position: fixed;
      top: 0;
      right: 0;
      z-index: 2147483647;
      pointer-events: none;
    `;

    const shadow = overlayContainer.attachShadow({ mode: 'closed' });

    // Inject overlay HTML and styles
    shadow.innerHTML = getOverlayHTML();

    document.body.appendChild(overlayContainer);

    // Initialize overlay event handlers
    initOverlayEvents(shadow);
  }

  /**
   * Get overlay HTML template
   */
  function getOverlayHTML() {
    return `
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }

        .ghost-overlay {
          position: fixed;
          bottom: 20px;
          right: 20px;
          width: 400px;
          max-height: 500px;
          background: #1a1a2e;
          border-radius: 12px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          color: #fff;
          pointer-events: auto;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .ghost-overlay.minimized {
          width: 60px;
          height: 60px;
          border-radius: 30px;
          cursor: pointer;
        }

        .ghost-overlay.minimized .overlay-content { display: none; }
        .ghost-overlay.minimized .minimize-btn { display: none; }
        .ghost-overlay.minimized .expand-btn { display: flex; }

        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 16px;
          background: #16213e;
          border-bottom: 1px solid #0f3460;
        }

        .header-title {
          font-size: 14px;
          font-weight: 600;
          color: #e94560;
        }

        .header-controls {
          display: flex;
          gap: 8px;
        }

        .btn {
          background: transparent;
          border: none;
          color: #fff;
          cursor: pointer;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 12px;
        }

        .btn:hover { background: rgba(255, 255, 255, 0.1); }

        .minimize-btn { font-size: 16px; }
        .expand-btn {
          display: none;
          width: 60px;
          height: 60px;
          align-items: center;
          justify-content: center;
          font-size: 24px;
          background: #e94560;
          border-radius: 30px;
        }

        .tabs {
          display: flex;
          background: #16213e;
          border-bottom: 1px solid #0f3460;
        }

        .tab {
          flex: 1;
          padding: 10px;
          text-align: center;
          font-size: 12px;
          cursor: pointer;
          border: none;
          background: transparent;
          color: #888;
          transition: all 0.2s;
        }

        .tab:hover { color: #fff; }
        .tab.active {
          color: #e94560;
          border-bottom: 2px solid #e94560;
        }

        .overlay-content {
          flex: 1;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }

        .tab-content {
          display: none;
          flex: 1;
          overflow-y: auto;
          padding: 12px;
        }

        .tab-content.active { display: flex; flex-direction: column; }

        /* Recorder Tab */
        .recorder {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
          padding: 20px;
        }

        .record-btn {
          width: 80px;
          height: 80px;
          border-radius: 50%;
          border: 3px solid #e94560;
          background: transparent;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
        }

        .record-btn:hover { background: rgba(233, 69, 96, 0.1); }

        .record-btn.recording {
          background: #e94560;
          animation: pulse 1.5s infinite;
        }

        .record-btn .icon {
          width: 32px;
          height: 32px;
          background: #e94560;
          border-radius: 6px;
        }

        .record-btn.recording .icon {
          background: #fff;
          border-radius: 4px;
          width: 24px;
          height: 24px;
        }

        @keyframes pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(233, 69, 96, 0.4); }
          50% { box-shadow: 0 0 0 15px rgba(233, 69, 96, 0); }
        }

        .status {
          font-size: 12px;
          color: #888;
        }

        .status.connected { color: #4ade80; }
        .status.recording { color: #e94560; }

        /* Transcript Tab */
        .transcript-feed {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .transcript-item {
          padding: 8px 12px;
          background: #16213e;
          border-radius: 8px;
          font-size: 13px;
          line-height: 1.4;
        }

        .transcript-item .speaker {
          font-size: 11px;
          font-weight: 600;
          margin-bottom: 4px;
        }

        .transcript-item .speaker.provider { color: #4ade80; }
        .transcript-item .speaker.patient { color: #60a5fa; }

        .transcript-item .text { color: #ccc; }

        .transcript-item.interim { opacity: 0.6; font-style: italic; }

        /* Patient Tab */
        .patient-form {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .form-group label {
          display: block;
          font-size: 11px;
          color: #888;
          margin-bottom: 4px;
        }

        .form-group input {
          width: 100%;
          padding: 8px 12px;
          background: #16213e;
          border: 1px solid #0f3460;
          border-radius: 6px;
          color: #fff;
          font-size: 13px;
        }

        .form-group input:focus {
          outline: none;
          border-color: #e94560;
        }

        .save-btn {
          padding: 10px;
          background: #e94560;
          border: none;
          border-radius: 6px;
          color: #fff;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
        }

        .save-btn:hover { background: #d63d56; }
      </style>

      <div class="ghost-overlay" id="overlay">
        <button class="expand-btn" id="expandBtn">🎙️</button>

        <div class="header">
          <span class="header-title">GHOST</span>
          <div class="header-controls">
            <span class="status" id="status">Disconnected</span>
            <button class="btn minimize-btn" id="minimizeBtn">−</button>
          </div>
        </div>

        <div class="tabs">
          <button class="tab active" data-tab="recorder">Recorder</button>
          <button class="tab" data-tab="transcript">Transcript</button>
          <button class="tab" data-tab="patient">Patient</button>
        </div>

        <div class="overlay-content">
          <div class="tab-content active" data-tab="recorder">
            <div class="recorder">
              <button class="record-btn" id="recordBtn">
                <div class="icon"></div>
              </button>
              <div class="status" id="recordStatus">Click to start recording</div>
            </div>
          </div>

          <div class="tab-content" data-tab="transcript">
            <div class="transcript-feed" id="transcriptFeed">
              <div class="transcript-item">
                <div class="text" style="color: #888; text-align: center;">
                  Start recording to see transcripts
                </div>
              </div>
            </div>
          </div>

          <div class="tab-content" data-tab="patient">
            <div class="patient-form">
              <div class="form-group">
                <label>Patient Code (ENC-YYYY-XXXXX)</label>
                <input type="text" id="patientCode" placeholder="ENC-2024-00001">
              </div>
              <div class="form-group">
                <label>Patient UUID (optional)</label>
                <input type="text" id="patientUuid" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx">
              </div>
              <button class="save-btn" id="savePatientBtn">Save Patient Info</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Initialize overlay event handlers
   */
  function initOverlayEvents(shadow) {
    const overlay = shadow.getElementById('overlay');
    const minimizeBtn = shadow.getElementById('minimizeBtn');
    const expandBtn = shadow.getElementById('expandBtn');
    const recordBtn = shadow.getElementById('recordBtn');
    const savePatientBtn = shadow.getElementById('savePatientBtn');
    const tabs = shadow.querySelectorAll('.tab');

    // Minimize/expand
    minimizeBtn.addEventListener('click', () => overlay.classList.add('minimized'));
    expandBtn.addEventListener('click', () => overlay.classList.remove('minimized'));

    // Record button
    recordBtn.addEventListener('click', toggleRecording);

    // Tab switching
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const tabName = tab.dataset.tab;
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        shadow.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        shadow.querySelector(`.tab-content[data-tab="${tabName}"]`).classList.add('active');
      });
    });

    // Save patient info
    savePatientBtn.addEventListener('click', () => {
      const patientCode = shadow.getElementById('patientCode').value;
      const patientUuid = shadow.getElementById('patientUuid').value;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'set_patient',
          patientCode,
          patientUuid: patientUuid || undefined
        }));
      }
    });

    // Store shadow reference for updates
    window.__ghostShadow = shadow;
  }

  /**
   * Connect to backend WebSocket
   */
  function connectWebSocket() {
    if (ws && ws.readyState === WebSocket.OPEN) return;

    console.log('[GHOST] Connecting to backend...');
    ws = new WebSocket(`${BACKEND_URL}?userId=${userId}`);

    ws.onopen = () => {
      console.log('[GHOST] Connected to backend');
      updateStatus('Connected', 'connected');
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handleServerMessage(message);
      } catch (error) {
        console.error('[GHOST] Failed to parse message:', error);
      }
    };

    ws.onclose = () => {
      console.log('[GHOST] Disconnected from backend');
      updateStatus('Disconnected', '');
      // Reconnect after delay
      setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = (error) => {
      console.error('[GHOST] WebSocket error:', error);
      updateStatus('Error', '');
    };
  }

  /**
   * Handle messages from backend
   */
  function handleServerMessage(message) {
    switch (message.type) {
      case 'connected':
        userId = message.userId;
        break;

      case 'recording_started':
        updateRecordStatus('Recording...', 'recording');
        break;

      case 'recording_stopped':
        updateRecordStatus('Click to start recording', '');
        break;

      case 'transcript':
        addTranscriptItem(message);
        break;

      case 'chunk':
        console.log('[GHOST] Chunk saved:', message);
        break;

      case 'error':
        console.error('[GHOST] Server error:', message.error);
        updateStatus('Error: ' + message.error, '');
        break;
    }
  }

  /**
   * Toggle recording on/off
   */
  async function toggleRecording() {
    if (isRecording) {
      await stopRecording();
    } else {
      await startRecording();
    }
  }

  /**
   * Start recording audio
   */
  async function startRecording() {
    try {
      // Request microphone access
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true
        }
      });

      // Create audio context for processing
      audioContext = new AudioContext({ sampleRate: 16000 });
      const source = audioContext.createMediaStreamSource(mediaStream);

      // Create script processor for raw PCM
      processor = audioContext.createScriptProcessor(4096, 1, 1);

      processor.onaudioprocess = (event) => {
        if (!isRecording || !ws || ws.readyState !== WebSocket.OPEN) return;

        const inputData = event.inputBuffer.getChannelData(0);
        const pcmData = convertToPCM16(inputData);
        ws.send(pcmData);
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      // Tell backend to start recording
      ws.send(JSON.stringify({
        type: 'start_recording',
        patientCode: window.__ghostShadow?.getElementById('patientCode')?.value || ''
      }));

      isRecording = true;
      updateRecordButton(true);
      updateRecordStatus('Connecting...', '');

    } catch (error) {
      console.error('[GHOST] Failed to start recording:', error);
      updateRecordStatus('Mic access denied', '');
    }
  }

  /**
   * Stop recording
   */
  async function stopRecording() {
    // Stop audio processing
    if (processor) {
      processor.disconnect();
      processor = null;
    }

    if (audioContext) {
      await audioContext.close();
      audioContext = null;
    }

    if (mediaStream) {
      mediaStream.getTracks().forEach(track => track.stop());
      mediaStream = null;
    }

    // Tell backend to stop
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'stop_recording' }));
    }

    isRecording = false;
    updateRecordButton(false);
    updateRecordStatus('Click to start recording', '');
  }

  /**
   * Convert Float32 audio to Int16 PCM
   */
  function convertToPCM16(float32Array) {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);

    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }

    return buffer;
  }

  /**
   * Add transcript item to feed
   */
  function addTranscriptItem(transcript) {
    const shadow = window.__ghostShadow;
    if (!shadow) return;

    const feed = shadow.getElementById('transcriptFeed');

    // Remove placeholder if exists
    const placeholder = feed.querySelector('.transcript-item:only-child .text[style]');
    if (placeholder) {
      feed.innerHTML = '';
    }

    // Find or create interim element
    let item = feed.querySelector('.transcript-item.interim');

    if (transcript.isFinal) {
      // Remove interim, add final
      if (item) item.remove();

      item = document.createElement('div');
      item.className = 'transcript-item';
      item.innerHTML = `
        <div class="speaker ${transcript.speaker === 0 ? 'provider' : 'patient'}">
          ${transcript.speaker === 0 ? 'Provider' : 'Patient'}
        </div>
        <div class="text">${escapeHtml(transcript.text)}</div>
      `;
      feed.appendChild(item);
    } else {
      // Update or create interim
      if (!item) {
        item = document.createElement('div');
        item.className = 'transcript-item interim';
        feed.appendChild(item);
      }
      item.innerHTML = `
        <div class="speaker ${transcript.speaker === 0 ? 'provider' : 'patient'}">
          ${transcript.speaker === 0 ? 'Provider' : 'Patient'}
        </div>
        <div class="text">${escapeHtml(transcript.text)}</div>
      `;
    }

    // Auto-scroll
    feed.scrollTop = feed.scrollHeight;
  }

  /**
   * Update connection status display
   */
  function updateStatus(text, className) {
    const shadow = window.__ghostShadow;
    if (!shadow) return;

    const status = shadow.getElementById('status');
    status.textContent = text;
    status.className = 'status ' + className;
  }

  /**
   * Update record button state
   */
  function updateRecordButton(recording) {
    const shadow = window.__ghostShadow;
    if (!shadow) return;

    const btn = shadow.getElementById('recordBtn');
    if (recording) {
      btn.classList.add('recording');
    } else {
      btn.classList.remove('recording');
    }
  }

  /**
   * Update record status text
   */
  function updateRecordStatus(text, className) {
    const shadow = window.__ghostShadow;
    if (!shadow) return;

    const status = shadow.getElementById('recordStatus');
    status.textContent = text;
    status.className = 'status ' + className;
  }

  /**
   * Handle messages from background script
   */
  function handleBackgroundMessage(message, sender, sendResponse) {
    switch (message.type) {
      case 'toggle_recording':
        toggleRecording();
        sendResponse({ success: true });
        break;

      case 'get_state':
        sendResponse({
          isRecording,
          isConnected: ws && ws.readyState === WebSocket.OPEN
        });
        break;
    }
    return true;
  }

  /**
   * Escape HTML to prevent XSS
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
