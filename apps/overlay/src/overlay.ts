/**
 * Ferrari Overlay - Main Shadow DOM Application
 *
 * This module creates and manages the overlay UI that floats above
 * the host page. Uses Shadow DOM for style isolation.
 */

import { TranscriptView } from './ui/transcript';
import { ControlButtons } from './ui/buttons';
import { TabId, TabsComponent } from './ui/tabs';
import { StatusPills } from './ui/pills';
import { FeedBadges, FeedStatusInfo } from './ui/feed-badges';
import { DebugLog, DebugLogEntry } from './ui/debug-log';
import { Bridge } from './bridge';
import { DOMMapper, PatientInfo } from './domMapper';

export interface OverlayState {
  isVisible: boolean;
  isRecording: boolean;
  isConnected: boolean;
  isActive: boolean;
  activeTab: TabId;
  transcriptLines: TranscriptLine[];
  patientInfo: PatientInfo | null;
  warnings: string[];
  feedStatuses: Record<string, FeedStatusInfo>;
  autopilot: AutopilotState | null;
  alerts: AlertEvent[];
  eventLog: DebugLogEntry[];
}

export interface TranscriptLine {
  id: string;
  speaker: string;
  text: string;
  timestamp: number;
  isFinal: boolean;
  tabId?: string;
}

export interface AutopilotState {
  ready: boolean;
  coverage: number;
  surfaces: number;
  reason?: string;
  timestamp?: string;
}

export interface AlertEvent {
  feed: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  timestamp: string;
  tabId?: string;
  keywords?: string[];
}

export class FerrariOverlay {
  private shadowRoot: ShadowRoot;
  private container: HTMLElement;
  private state: OverlayState;
  private bridge: Bridge;
  private domMapper: DOMMapper;
  private tabId: string;

  // UI Components
  private transcriptView: TranscriptView;
  private controlButtons: ControlButtons;
  private tabs: TabsComponent;
  private statusPills: StatusPills;
  private feedBadges: FeedBadges;
  private debugLog: DebugLog;

  constructor(bridge: Bridge, domMapper: DOMMapper, tabId: string) {
    this.bridge = bridge;
    this.domMapper = domMapper;
    this.tabId = tabId;
    this.state = this.getInitialState();

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
    this.feedBadges = new FeedBadges(this.shadowRoot);
    this.debugLog = new DebugLog(this.shadowRoot);

    this.setupEventListeners();
    this.render();
  }

  private getInitialState(): OverlayState {
    return {
      isVisible: true,
      isRecording: false,
      isConnected: false,
      isActive: true,
      activeTab: 'transcript',
      transcriptLines: [],
      patientInfo: null,
      warnings: [],
      feedStatuses: {},
      autopilot: null,
      alerts: [],
      eventLog: []
    };
  }

  private setupEventListeners(): void {
    // Listen for bridge events
    this.bridge.on('transcript', (data: TranscriptLine & { tabId?: string }) => {
      if (data.tabId && data.tabId !== this.tabId) return;
      this.addTranscriptLine(data);
    });

    this.bridge.on('connection', (status: { connected: boolean; tabId?: string }) => {
      if (status.tabId && status.tabId !== this.tabId) return;
      this.setState({ isConnected: status.connected });
    });

    this.bridge.on('patient', (info: PatientInfo & { tabId?: string }) => {
      if (info.tabId && info.tabId !== this.tabId) return;
      this.setState({ patientInfo: info });
    });

    this.bridge.on('active_tab_changed', (data: { tabId?: string; isActive: boolean }) => {
      if (data.tabId && data.tabId !== this.tabId) return;
      this.setState({ isActive: data.isActive });
    });

    this.bridge.on('patient-mismatch', (data: { tabId?: string; message?: string }) => {
      if (data.tabId && data.tabId !== this.tabId) return;
      const warning = data.message || 'Patient mismatch detected. Verify patient before recording.';
      this.setState({ warnings: Array.from(new Set([...this.state.warnings, warning])) });
    });

    this.bridge.on('feed-status', (data: FeedStatusInfo & { tabId?: string }) => {
      if (data.tabId && data.tabId !== this.tabId) return;
      this.handleFeedStatus(data);
    });

    this.bridge.on('autopilot-status', (data: AutopilotState & { tabId?: string }) => {
      if (data.tabId && data.tabId !== this.tabId) return;
      this.handleAutopilotState(data);
    });

    this.bridge.on('feed-alert', (data: AlertEvent & { tabId?: string }) => {
      if (data.tabId && data.tabId !== this.tabId) return;
      this.handleAlert(data);
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

  private handleTabChange(tab: OverlayState['activeTab']): void {
    this.setState({ activeTab: tab });
  }

  private handleFeedStatus(status: FeedStatusInfo): void {
    const updatedStatuses = { ...this.state.feedStatuses, [status.feed]: status };

    this.addEventLogEntry({
      id: `${status.feed}-${status.timestamp || Date.now()}`,
      type: 'status',
      message: `${status.label || 'Feed'} ${status.status}`,
      detail: status.timestamp ? new Date(status.timestamp).toLocaleTimeString() : undefined,
      timestamp: status.timestamp || new Date().toISOString(),
      feed: status.feed
    });

    this.setState({ feedStatuses: updatedStatuses });
    this.feedBadges.update(status);
  }

  private handleAutopilotState(state: AutopilotState): void {
    this.addEventLogEntry({
      id: `autopilot-${state.timestamp || Date.now()}`,
      type: 'autopilot',
      message: state.ready ? 'Autopilot ready' : 'Autopilot not ready',
      detail: state.reason,
      timestamp: state.timestamp || new Date().toISOString(),
      feed: 'D'
    });

    this.setState({ autopilot: state });
  }

  private handleAlert(alert: AlertEvent): void {
    const nextAlerts = [alert, ...this.state.alerts].slice(0, 5);

    this.addEventLogEntry({
      id: `alert-${alert.timestamp}-${alert.message}`,
      type: 'alert',
      message: `${alert.feed} ${alert.severity.toUpperCase()}: ${alert.message}`,
      detail: alert.keywords?.join(', '),
      timestamp: alert.timestamp || new Date().toISOString(),
      feed: alert.feed
    });

    this.setState({ alerts: nextAlerts });
  }

  private async startRecording(): Promise<void> {
    if (!this.state.isActive) {
      this.setState({
        warnings: Array.from(new Set([...this.state.warnings, 'Activate this tab to start recording.']))
      });
      return;
    }

    try {
      await this.bridge.emit('start-recording', { tabId: this.tabId });
      this.setState({ isRecording: true });
    } catch (error) {
      console.error('[Ferrari] Failed to start recording:', error);
    }
  }

  private async stopRecording(): Promise<void> {
    try {
      await this.bridge.emit('stop-recording', { tabId: this.tabId });
      this.setState({ isRecording: false });
    } catch (error) {
      console.error('[Ferrari] Failed to stop recording:', error);
    }
  }

  private clearTranscript(): void {
    this.setState({ transcriptLines: [] });
    this.transcriptView.clear();
  }

  private addTranscriptLine(line: TranscriptLine): void {
    const lines = [...this.state.transcriptLines];

    // Update existing line if not final, or add new
    const existingIndex = lines.findIndex(l => l.id === line.id);
    if (existingIndex >= 0) {
      lines[existingIndex] = line;
    } else {
      lines.push(line);
    }

    this.setState({ transcriptLines: lines });
    this.transcriptView.updateLines(lines);
  }

  private toggleVisibility(): void {
    this.setState({ isVisible: !this.state.isVisible });
    this.container.style.display = this.state.isVisible ? 'block' : 'none';
  }

  private addEventLogEntry(entry: DebugLogEntry): void {
    const updated = [entry, ...this.state.eventLog].slice(0, 50);
    this.setState({ eventLog: updated });
  }

  private setState(partial: Partial<OverlayState>): void {
    this.state = { ...this.state, ...partial };

    if (partial.isActive) {
      this.state.warnings = this.state.warnings.filter(
        warning => warning !== 'Activate this tab to start recording.'
      );
    }

    this.updateUI();
  }

  private updateUI(): void {
    this.controlButtons.update({
      isRecording: this.state.isRecording,
      isConnected: this.state.isConnected,
      isActive: this.state.isActive
    });

    this.statusPills.update({
      isConnected: this.state.isConnected,
      isRecording: this.state.isRecording,
      patientInfo: this.state.patientInfo,
      autopilot: this.state.autopilot
    });

    this.tabs.setActiveTab(this.state.activeTab);

    this.debugLog.update(this.state.eventLog);

    this.updateBanner();
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
        this.setState({ patientInfo: patientHint });
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
        <div class="header-pills" id="status-pills"></div>
        <div class="header-controls">
          <button class="minimize-btn" title="Minimize (Alt+G)">−</button>
        </div>
      </div>
      <div class="feed-badges-container" id="feed-badges"></div>
      <div class="overlay-banner hidden" id="overlay-banner"></div>
      <div class="overlay-tabs" id="tabs-container"></div>
      <div class="overlay-content">
        <div class="tab-panel" id="transcript-panel"></div>
        <div class="tab-panel hidden" id="mapping-panel">
          <p>DOM field mapping controls</p>
        </div>
        <div class="tab-panel hidden" id="settings-panel">
          <p>Settings and configuration</p>
        </div>
        <div class="tab-panel hidden" id="debug-panel">
          <div id="debug-log"></div>
        </div>
      </div>
      <div class="overlay-footer" id="control-buttons"></div>
    `;

    this.shadowRoot.appendChild(overlay);

    // Mount components
    const pillsContainer = this.shadowRoot.getElementById('status-pills');
    const feedBadgesContainer = this.shadowRoot.getElementById('feed-badges');
    const tabsContainer = this.shadowRoot.getElementById('tabs-container');
    const transcriptPanel = this.shadowRoot.getElementById('transcript-panel');
    const controlsContainer = this.shadowRoot.getElementById('control-buttons');
    const debugLogContainer = this.shadowRoot.getElementById('debug-log');

    if (pillsContainer) this.statusPills.mount(pillsContainer);
    if (feedBadgesContainer) this.feedBadges.mount(feedBadgesContainer);
    if (tabsContainer) this.tabs.mount(tabsContainer);
    if (transcriptPanel) this.transcriptView.mount(transcriptPanel);
    if (debugLogContainer) this.debugLog.mount(debugLogContainer);
    if (controlsContainer) this.controlButtons.mount(controlsContainer);

    // Setup minimize button
    const minimizeBtn = this.shadowRoot.querySelector('.minimize-btn');
    minimizeBtn?.addEventListener('click', () => this.toggleVisibility());
  }

  private updateBanner(): void {
    const banner = this.shadowRoot.getElementById('overlay-banner');
    if (!banner) return;

    const messages: string[] = [];
    if (!this.state.isActive) {
      messages.push('This tab is inactive. Recording controls are disabled.');
    }

    const filteredWarnings = this.state.isActive
      ? this.state.warnings.filter(warning => warning !== 'Activate this tab to start recording.')
      : this.state.warnings;

    if (filteredWarnings.length > 0) {
      messages.push(...filteredWarnings);
    }

    if (this.state.alerts.length > 0) {
      const alertMessages = this.state.alerts.slice(0, 2).map(alert => {
        const prefix = alert.severity === 'critical' ? '🚨' : alert.severity === 'warning' ? '⚠️' : 'ℹ️';
        return `${prefix} ${alert.message}`;
      });
      messages.push(...alertMessages);
    }

    if (messages.length === 0) {
      banner.classList.add('hidden');
      banner.textContent = '';
      return;
    }

    banner.textContent = messages.join(' • ');
    banner.classList.remove('hidden');
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
        width: 380px;
        max-height: 600px;
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
        display: flex;
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

      .header-pills {
        flex: 1;
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

      .feed-badges-container {
        border-bottom: 1px solid #2d2d44;
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

      #debug-panel {
        padding: 12px 14px;
        color: #e5e7eb;
      }

      .overlay-footer {
        padding: 12px 16px;
        background: #16162a;
        border-top: 1px solid #2d2d44;
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
    `;
  }

  public mount(): void {
    document.body.appendChild(this.container);
  }

  public unmount(): void {
    this.container.remove();
  }

  public getState(): OverlayState {
    return { ...this.state };
  }
}
