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
import { Bridge } from './bridge';
import { DebugPanel } from './ui/debug';

export interface OverlayState {
  isVisible: boolean;
  isRecording: boolean;
  isConnected: boolean;
  activeTab: 'transcript' | 'mapping' | 'settings' | 'debug';
  transcriptLines: TranscriptLine[];
  patientInfo: PatientInfo | null;
  feedStatus: 'connected' | 'recording' | 'stopped' | 'disconnected' | 'error';
  domCoverage: number;
  transcriptAvailable: boolean;
  autopilotReady: boolean;
  autopilotMessage: string;
}

export interface TranscriptLine {
  id: string;
  speaker: string;
  text: string;
  timestamp: number;
  isFinal: boolean;
}

export interface PatientInfo {
  name: string;
  mrn: string;
  dob?: string;
}

export class FerrariOverlay {
  private shadowRoot: ShadowRoot;
  private container: HTMLElement;
  private state: OverlayState;
  private bridge: Bridge;

  // UI Components
  private transcriptView: TranscriptView;
  private controlButtons: ControlButtons;
  private tabs: TabsComponent;
  private statusPills: StatusPills;
  private debugPanel: DebugPanel;

  constructor(bridge: Bridge) {
    this.bridge = bridge;
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
    this.debugPanel = new DebugPanel(this.shadowRoot);

    this.setupEventListeners();
    this.render();
  }

  private getInitialState(): OverlayState {
    return {
      isVisible: true,
      isRecording: false,
      isConnected: false,
      activeTab: 'transcript',
      transcriptLines: [],
      patientInfo: null,
      feedStatus: 'disconnected',
      domCoverage: 0,
      transcriptAvailable: false,
      autopilotReady: false,
      autopilotMessage: 'Waiting for DOM coverage and transcript'
    };
  }

  private setupEventListeners(): void {
    // Listen for bridge events
    this.bridge.on('transcript', (data: TranscriptLine) => {
      this.addTranscriptLine(data);
    });

    this.bridge.on('connection', (status: { connected: boolean }) => {
      this.setState({ isConnected: status.connected });
    });

    this.bridge.on('feed-status', (status: { status: OverlayState['feedStatus'] }) => {
      this.setState({ feedStatus: status.status });
    });

    this.bridge.on('patient', (info: PatientInfo) => {
      this.setState({ patientInfo: info });
    });

    this.bridge.on('dom-coverage', (coverage: { coverage: number }) => {
      const autopilot = this.buildAutopilotStatus(coverage.coverage, this.state.transcriptAvailable);
      this.setState({
        domCoverage: coverage.coverage,
        autopilotReady: autopilot.ready,
        autopilotMessage: autopilot.message
      });
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

  private async startRecording(): Promise<void> {
    try {
      await this.bridge.emit('start-recording', {});
      this.setState({ isRecording: true });
    } catch (error) {
      console.error('[Ferrari] Failed to start recording:', error);
    }
  }

  private async stopRecording(): Promise<void> {
    try {
      await this.bridge.emit('stop-recording', {});
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

    const transcriptAvailable = lines.some(line => line.text?.trim());
    const autopilot = this.buildAutopilotStatus(this.state.domCoverage, transcriptAvailable);

    this.setState({
      transcriptLines: lines,
      transcriptAvailable,
      autopilotReady: autopilot.ready,
      autopilotMessage: autopilot.message
    });
    this.transcriptView.updateLines(lines);
  }

  private toggleVisibility(): void {
    this.setState({ isVisible: !this.state.isVisible });
    this.container.style.display = this.state.isVisible ? 'block' : 'none';
  }

  private setState(partial: Partial<OverlayState>): void {
    this.state = { ...this.state, ...partial };
    this.updateUI();
  }

  private updateUI(): void {
    this.controlButtons.update({
      isRecording: this.state.isRecording,
      isConnected: this.state.isConnected
    });

    this.statusPills.update({
      isConnected: this.state.isConnected,
      isRecording: this.state.isRecording,
      patientInfo: this.state.patientInfo,
      feedStatus: this.state.feedStatus,
      autopilotReady: this.state.autopilotReady,
      autopilotMessage: this.state.autopilotMessage,
      coverage: this.state.domCoverage,
      transcriptAvailable: this.state.transcriptAvailable
    });

    this.tabs.setActiveTab(this.state.activeTab);

    this.debugPanel.update({
      isConnected: this.state.isConnected,
      feedStatus: this.state.feedStatus,
      domCoverage: this.state.domCoverage,
      transcriptAvailable: this.state.transcriptAvailable,
      autopilotReady: this.state.autopilotReady,
      autopilotMessage: this.state.autopilotMessage,
      isRecording: this.state.isRecording
    });
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
      <div class="overlay-tabs" id="tabs-container"></div>
      <div class="overlay-content">
        <div class="tab-panel" id="transcript-panel"></div>
        <div class="tab-panel hidden" id="mapping-panel">
          <p>DOM field mapping controls</p>
        </div>
        <div class="tab-panel hidden" id="settings-panel">
          <p>Settings and configuration</p>
        </div>
        <div class="tab-panel hidden" id="debug-panel"></div>
      </div>
      <div class="overlay-footer" id="control-buttons"></div>
    `;

    this.shadowRoot.appendChild(overlay);

    // Mount components
    const pillsContainer = this.shadowRoot.getElementById('status-pills');
    const tabsContainer = this.shadowRoot.getElementById('tabs-container');
    const transcriptPanel = this.shadowRoot.getElementById('transcript-panel');
    const debugPanel = this.shadowRoot.getElementById('debug-panel');
    const controlsContainer = this.shadowRoot.getElementById('control-buttons');

    if (pillsContainer) this.statusPills.mount(pillsContainer);
    if (tabsContainer) this.tabs.mount(tabsContainer);
    if (transcriptPanel) this.transcriptView.mount(transcriptPanel);
    if (debugPanel) this.debugPanel.mount(debugPanel);
    if (controlsContainer) this.controlButtons.mount(controlsContainer);

    // Setup minimize button
    const minimizeBtn = this.shadowRoot.querySelector('.minimize-btn');
    minimizeBtn?.addEventListener('click', () => this.toggleVisibility());
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

  private buildAutopilotStatus(coverage: number, transcriptAvailable: boolean): { ready: boolean; message: string } {
    if (coverage >= 50 && transcriptAvailable) {
      return { ready: true, message: 'Ready: coverage + transcript available' };
    }

    if (!transcriptAvailable && coverage < 50) {
      return { ready: false, message: 'Waiting for transcript and DOM coverage' };
    }

    if (!transcriptAvailable) {
      return { ready: false, message: 'Waiting for transcript from audio feed' };
    }

    return { ready: false, message: 'Waiting for DOM coverage' };
  }
}
