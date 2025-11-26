/**
 * Ferrari Overlay - Main Shadow DOM Application
 *
 * This module creates and manages the overlay UI that floats above
 * the host page. Uses Shadow DOM for style isolation.
 */

import { TranscriptView } from './ui/transcript';
import { ControlButtons } from './ui/buttons';
import { TabsComponent } from './ui/tabs';
import { StatusPills } from './ui/pills';
import { RecorderPill } from './ui/recorder-pill';
import { PatientCard } from './ui/patient-card';
import { Bridge } from './bridge';
import { DOMMapper } from './domMapper';
import { OverlayStore, OverlayState } from './state';
import { PatientInfo, RecorderState, TabId, TranscriptLine } from './types';

export class FerrariOverlay {
  private shadowRoot: ShadowRoot;
  private container: HTMLElement;
  private bridge: Bridge;
  private domMapper: DOMMapper;
  private tabId: string;
  private store: OverlayStore;

  // UI Components
  private transcriptView: TranscriptView;
  private controlButtons: ControlButtons;
  private tabs: TabsComponent;
  private statusPills: StatusPills;
  private recorderPill: RecorderPill;
  private summaryPatientCard: PatientCard;
  private patientCard: PatientCard;

  constructor(bridge: Bridge, domMapper: DOMMapper, tabId: string) {
    this.bridge = bridge;
    this.domMapper = domMapper;
    this.tabId = tabId;
    this.store = new OverlayStore();

    // Create host element
    this.container = document.createElement('div');
    this.container.id = 'ghost-next-overlay';

    // Attach Shadow DOM for style isolation
    this.shadowRoot = this.container.attachShadow({ mode: 'open' });

    // Initialize UI components
    this.transcriptView = new TranscriptView(this.shadowRoot);
    this.controlButtons = new ControlButtons(this.shadowRoot, this.handleControlAction.bind(this));
    this.tabs = new TabsComponent(this.shadowRoot, this.handleTabChange.bind(this));
    this.statusPills = new StatusPills(this.shadowRoot);
    this.recorderPill = new RecorderPill(this.shadowRoot);
    this.summaryPatientCard = new PatientCard(this.shadowRoot);
    this.patientCard = new PatientCard(this.shadowRoot);

    this.setupEventListeners();
    this.render();

    this.store.subscribe((state) => this.updateUI(state));
  }

  private setupEventListeners(): void {
    // Listen for bridge events
    this.bridge.on('transcript', (data: TranscriptLine & { tabId?: string }) => {
      if (data.tabId && data.tabId !== this.tabId) return;
      this.store.addTranscriptLine(data);
    });

    this.bridge.on('connection', (status: { connected: boolean; tabId?: string }) => {
      if (status.tabId && status.tabId !== this.tabId) return;
      this.store.setConnection(status.connected);
    });

    this.bridge.on('patient', (info: Partial<PatientInfo> & { tabId?: string }) => {
      if (info.tabId && info.tabId !== this.tabId) return;
      const { tabId: _ignored, ...patient } = info;
      if (patient.name || patient.mrn || patient.patient_code || patient.patient_uuid) {
        const normalized: PatientInfo = {
          name: patient.name || 'Unknown',
          mrn: patient.mrn || '',
          dob: patient.dob,
          patient_code: patient.patient_code,
          patient_uuid: patient.patient_uuid
        };
        this.store.setPatientInfo(normalized);
      } else {
        this.store.setPatientInfo(null);
      }
    });

    this.bridge.on('active_tab_changed', (data: { tabId?: string; isActive: boolean }) => {
      if (data.tabId && data.tabId !== this.tabId) return;
      this.store.setActiveState(data.isActive);
      if (data.isActive) {
        this.store.resetWarnings();
      } else {
        this.store.addWarning('This tab is inactive. Recording controls are disabled.');
      }
    });

    this.bridge.on('patient-mismatch', (data: { tabId?: string; message?: string }) => {
      if (data.tabId && data.tabId !== this.tabId) return;
      const warning = data.message || 'Patient mismatch detected. Verify patient before recording.';
      this.store.addWarning(warning);
    });

    this.bridge.on('recording-started', (data: { tabId?: string }) => {
      if (data.tabId && data.tabId !== this.tabId) return;
      this.store.setRecorderState('listening');
    });

    this.bridge.on('recording-stopped', (data: { tabId?: string }) => {
      if (data.tabId && data.tabId !== this.tabId) return;
      this.store.setRecorderState('idle');
    });

    this.bridge.on('recording-error', (data: { tabId?: string; error?: string }) => {
      if (data.tabId && data.tabId !== this.tabId) return;
      this.store.setRecorderState('error', 'error', data.error || 'Recorder error');
    });

    this.bridge.on('audio-status', (payload: { recording?: boolean; state?: RecorderState; tabId?: string; error?: string }) => {
      if (payload.tabId && payload.tabId !== this.tabId) return;
      const recorderState: RecorderState = payload.state || (payload.recording ? 'listening' : 'idle');
      this.store.setRecorderState(recorderState, payload.error ? 'error' : 'info', payload.error);
    });

    this.bridge.on('server-error', (data: { tabId?: string; error?: string }) => {
      if (data.tabId && data.tabId !== this.tabId) return;
      this.store.addWarning(data.error || 'Server error');
    });

    this.bridge.on('toggle-overlay', () => {
      this.toggleVisibility();
    });

    // Keyboard shortcut to toggle overlay
    document.addEventListener('keydown', (e) => {
      if (e.altKey && e.key === 'g') {
        this.toggleVisibility();
      }
    });
  }

  private handleControlAction(action: string): void {
    switch (action) {
      case 'start':
        this.startRecording();
        break;
      case 'stop':
        this.stopRecording();
        break;
      case 'clear':
        this.clearTranscript();
        break;
      case 'minimize':
        this.toggleVisibility();
        break;
      case 'map':
        this.bridge.emit('map-fields', {});
        break;
    }
  }

  private handleTabChange(tab: TabId): void {
    this.store.setActiveTab(tab);
  }

  private async startRecording(): Promise<void> {
    const state = this.store.getState();
    if (!state.isActive) {
      this.store.addWarning('Activate this tab to start recording.');
      return;
    }

    try {
      this.store.setRecorderState('connecting');
      await this.bridge.emit('start-recording', { tabId: this.tabId });
    } catch (error) {
      console.error('[Ferrari] Failed to start recording:', error);
      this.store.setRecorderState('error', 'error', 'Failed to start recording');
    }
  }

  private async stopRecording(): Promise<void> {
    try {
      await this.bridge.emit('stop-recording', { tabId: this.tabId });
      this.store.setRecorderState('idle');
    } catch (error) {
      console.error('[Ferrari] Failed to stop recording:', error);
      this.store.setRecorderState('error', 'error', 'Failed to stop recording');
    }
  }

  private clearTranscript(): void {
    this.store.clearTranscript();
    this.transcriptView.clear();
  }

  private toggleVisibility(): void {
    const state = this.store.getState();
    this.store.setVisibility(!state.isVisible);
  }

  public async sendHello(): Promise<void> {
    const patientHint = this.domMapper.getPatientHint();
    try {
      await this.bridge.emit('hello', {
        tabId: this.tabId,
        url: window.location.href,
        patientHint
      });

      if (patientHint) {
        this.store.setPatientInfo(patientHint);
      }
    } catch (error) {
      console.error('[Ferrari] Failed to send hello message:', error);
    }
  }

  private render(): void {
    // Inject styles
    const styles = document.createElement('style');
    styles.textContent = this.getStyles();
    this.shadowRoot.appendChild(styles);

    // Create main overlay structure
    const overlay = document.createElement('div');
    overlay.className = 'ferrari-overlay';
    overlay.innerHTML = `
      <div class="overlay-header">
        <div class="overlay-title">
          <span class="logo">🏎️</span>
          <span>GHOST-NEXT</span>
        </div>
        <div class="recorder-slot" id="recorder-pill"></div>
        <div class="header-pills" id="status-pills"></div>
        <div class="header-controls">
          <button class="minimize-btn" title="Minimize (Alt+G)">−</button>
        </div>
      </div>
      <div class="overlay-banner hidden" id="overlay-banner"></div>
      <div class="overlay-tabs" id="tabs-container"></div>
      <div class="overlay-content">
        <div class="tab-panel" id="summary-panel">
          <div class="panel-grid">
            <div id="summary-card"></div>
            <div class="panel-box">
              <div class="panel-title">Quick Notes</div>
              <p class="panel-placeholder">Summaries and SOAP snippets will appear here.</p>
            </div>
          </div>
        </div>
        <div class="tab-panel hidden" id="soap-panel">
          <div class="panel-box">
            <div class="panel-title">SOAP Outline</div>
            <p class="panel-placeholder">Structure Subjective, Objective, Assessment, Plan outputs.</p>
          </div>
        </div>
        <div class="tab-panel hidden" id="transcript-panel"></div>
        <div class="tab-panel hidden" id="tasks-panel">
          <div class="panel-box">
            <div class="panel-title">Tasks</div>
            <ul class="panel-list">
              <li>Track follow-ups</li>
              <li>Mark actions as completed</li>
              <li>Review agent reminders</li>
            </ul>
          </div>
        </div>
        <div class="tab-panel hidden" id="patient-panel">
          <div id="patient-card"></div>
        </div>
        <div class="tab-panel hidden" id="debug-panel">
          <div class="panel-box">
            <div class="panel-title">Status Log</div>
            <div class="debug-log" id="debug-log"></div>
          </div>
        </div>
      </div>
      <div class="overlay-footer" id="control-buttons"></div>
    `;

    this.shadowRoot.appendChild(overlay);

    // Mount components
    const pillsContainer = this.shadowRoot.getElementById('status-pills');
    const tabsContainer = this.shadowRoot.getElementById('tabs-container');
    const recorderContainer = this.shadowRoot.getElementById('recorder-pill');
    const summaryCardContainer = this.shadowRoot.getElementById('summary-card');
    const patientCardContainer = this.shadowRoot.getElementById('patient-card');
    const transcriptPanel = this.shadowRoot.getElementById('transcript-panel');
    const controlsContainer = this.shadowRoot.getElementById('control-buttons');

    if (pillsContainer) this.statusPills.mount(pillsContainer);
    if (tabsContainer) this.tabs.mount(tabsContainer);
    if (recorderContainer) this.recorderPill.mount(recorderContainer);
    if (summaryCardContainer) this.summaryPatientCard.mount(summaryCardContainer);
    if (patientCardContainer) this.patientCard.mount(patientCardContainer);
    if (transcriptPanel) this.transcriptView.mount(transcriptPanel);
    if (controlsContainer) this.controlButtons.mount(controlsContainer);

    // Setup minimize button
    const minimizeBtn = this.shadowRoot.querySelector('.minimize-btn');
    minimizeBtn?.addEventListener('click', () => this.toggleVisibility());
  }

  private updateUI(state: OverlayState): void {
    this.container.style.display = state.isVisible ? 'block' : 'none';

    this.controlButtons.update({
      isRecording: state.isRecording,
      isConnected: state.isConnected,
      isActive: state.isActive
    });

    this.statusPills.update({
      isConnected: state.isConnected,
      isRecording: state.isRecording,
      patientInfo: state.patientInfo
    });

    this.recorderPill.update({
      state: state.recorderState,
      message: state.warnings[state.warnings.length - 1]
    });

    this.tabs.setActiveTab(state.activeTab);
    this.updateBanner(state);
    this.renderDebugLog(state);

    const scopedLines = state.transcriptLines.filter(line => !line.tabId || line.tabId === this.tabId);
    this.transcriptView.updateLines(scopedLines);

    const patientProps = {
      patient: state.patientInfo,
      feeds: Object.values(state.feeds),
      statusLog: state.statusLog
    };

    this.summaryPatientCard.update(patientProps);
    this.patientCard.update(patientProps);
  }

  private updateBanner(state: OverlayState): void {
    const banner = this.shadowRoot.getElementById('overlay-banner');
    if (!banner) return;

    const messages: string[] = [];
    if (!state.isActive) {
      messages.push('This tab is inactive. Recording controls are disabled.');
    }

    const filteredWarnings = state.isActive
      ? state.warnings.filter(warning => warning !== 'Activate this tab to start recording.')
      : state.warnings;

    if (filteredWarnings.length > 0) {
      messages.push(...filteredWarnings);
    }

    if (messages.length === 0) {
      banner.classList.add('hidden');
      banner.textContent = '';
      return;
    }

    banner.textContent = messages.join(' • ');
    banner.classList.remove('hidden');
  }

  private renderDebugLog(state: OverlayState): void {
    const container = this.shadowRoot.getElementById('debug-log');
    if (!container) return;

    container.innerHTML = '';
    state.statusLog.slice(-20).reverse().forEach(entry => {
      const row = document.createElement('div');
      row.className = `log-row tone-${entry.tone}`;
      row.innerHTML = `
        <span class="log-time">${new Date(entry.timestamp).toLocaleTimeString('en-US', { hour12: false })}</span>
        <span class="log-message">${entry.message}</span>
      `;
      container.appendChild(row);
    });
  }

  private getStyles(): string {
    return `
      :host {
        all: initial;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      }

      .ferrari-overlay {
        position: fixed;
        top: 20px;
        right: 20px;
        width: 420px;
        max-height: 640px;
        background: #1a1a2e;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
        z-index: 2147483647;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid #2d2d44;
      }

      .overlay-header {
        display: grid;
        grid-template-columns: auto 1fr auto auto;
        align-items: center;
        padding: 12px 16px;
        background: linear-gradient(135deg, #e63946 0%, #c62828 100%);
        color: white;
        gap: 12px;
      }

      .overlay-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 600;
        font-size: 14px;
      }

      .logo {
        font-size: 18px;
      }

      .recorder-slot {
        display: flex;
        justify-content: center;
      }

      .header-pills {
        display: flex;
        gap: 6px;
        justify-content: flex-end;
      }

      .header-controls button {
        background: rgba(255, 255, 255, 0.2);
        border: none;
        color: white;
        width: 24px;
        height: 24px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 16px;
        line-height: 1;
      }

      .header-controls button:hover {
        background: rgba(255, 255, 255, 0.3);
      }

      .overlay-banner {
        background: #2d2d44;
        color: #ffcc80;
        padding: 8px 12px;
        font-size: 12px;
        border-bottom: 1px solid #3d3d5c;
      }

      .overlay-banner.hidden {
        display: none;
      }

      .overlay-tabs {
        background: #16162a;
        border-bottom: 1px solid #2d2d44;
      }

      .overlay-content {
        flex: 1;
        overflow: hidden;
        background: #1a1a2e;
      }

      .tab-panel {
        height: 100%;
        padding: 12px;
        overflow-y: auto;
      }

      .tab-panel.hidden {
        display: none;
      }

      .overlay-footer {
        padding: 12px 16px;
        background: #16162a;
        border-top: 1px solid #2d2d44;
      }

      .panel-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 12px;
      }

      .panel-box {
        background: rgba(255, 255, 255, 0.04);
        border-radius: 10px;
        padding: 12px;
        border: 1px solid rgba(255, 255, 255, 0.06);
      }

      .panel-title {
        font-size: 13px;
        font-weight: 700;
        color: #f2f3f7;
        margin-bottom: 6px;
      }

      .panel-placeholder {
        color: #9ea1ad;
        font-size: 12px;
        margin: 0;
      }

      .panel-list {
        margin: 0;
        padding-left: 18px;
        color: #cfd1da;
        font-size: 13px;
      }

      .debug-log {
        display: flex;
        flex-direction: column;
        gap: 6px;
        max-height: 260px;
        overflow-y: auto;
      }

      .log-row {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
        color: #cdd0db;
        padding: 6px 8px;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.05);
      }

      .log-row.tone-warning {
        border-color: rgba(255, 193, 7, 0.4);
      }

      .log-row.tone-error {
        border-color: rgba(244, 67, 54, 0.5);
      }

      .log-time {
        font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
        font-size: 11px;
        color: #a0a3af;
        min-width: 54px;
      }

      .log-message {
        flex: 1;
      }

      /* Scrollbar styling */
      ::-webkit-scrollbar {
        width: 6px;
      }

      ::-webkit-scrollbar-track {
        background: #1a1a2e;
      }

      ::-webkit-scrollbar-thumb {
        background: #3d3d5c;
        border-radius: 3px;
      }

      ::-webkit-scrollbar-thumb:hover {
        background: #4d4d6c;
      }

      @media (min-width: 480px) {
        .panel-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
    `;
  }

  public mount(): void {
    document.body.appendChild(this.container);
  }

  public unmount(): void {
    this.container.remove();
  }
}
