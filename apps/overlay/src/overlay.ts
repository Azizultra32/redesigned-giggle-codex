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
import {
  AutopilotNote,
  DebugLogEntry,
  PatientInfo,
  SoapNote,
  SummaryPayload,
  TabId,
  TaskItem,
  TranscriptLine
} from './types';

export interface OverlayState {
  isVisible: boolean;
  isRecording: boolean;
  isConnected: boolean;
  activeTab: TabId;
  transcriptByTab: Record<TabId, TranscriptLine[]>;
  patientInfo: PatientInfo | null;
  summary: SummaryPayload | null;
  soap: SoapNote;
  tasks: TaskItem[];
  autopilotNotes: AutopilotNote[];
  debugLogs: DebugLogEntry[];
  boundTab: TabId | null;
  isBoundActive: boolean;
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

  // Panel references
  private summaryContent?: HTMLElement | null;
  private summaryTitle?: HTMLElement | null;
  private soapSections?: Record<keyof SoapNote, HTMLElement>;
  private tasksList?: HTMLElement | null;
  private autopilotSummary?: HTMLElement | null;
  private autopilotTasks?: HTMLElement | null;
  private patientDetails?: HTMLElement | null;
  private patientAutopilot?: HTMLElement | null;
  private debugList?: HTMLElement | null;
  private bindingBanner?: HTMLElement | null;

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

    this.setupEventListeners();
    this.render();
  }

  private getInitialState(): OverlayState {
    return {
      isVisible: true,
      isRecording: false,
      isConnected: false,
      activeTab: 'summary',
      transcriptByTab: {
        summary: [],
        soap: [],
        transcript: [],
        tasks: [],
        patient: [],
        debug: []
      },
      patientInfo: null,
      summary: null,
      soap: {},
      tasks: [],
      autopilotNotes: [],
      debugLogs: [],
      boundTab: 'summary',
      isBoundActive: true
    };
  }

  private setupEventListeners(): void {
    // Listen for bridge events
    this.bridge.on('transcript', (data: TranscriptLine) => {
      this.addTranscriptLine(data);
    });

    this.bridge.on('summary_update', (data: SummaryPayload) => {
      this.setState({ summary: data });
    });

    this.bridge.on('soap_update', (data: SoapNote) => {
      this.setState({ soap: { ...this.state.soap, ...data } });
    });

    this.bridge.on('tasks_update', (data: TaskItem[]) => {
      this.setState({ tasks: this.mergeTaskUpdates(data) });
    });

    this.bridge.on('autopilot_update', (data: AutopilotNote | AutopilotNote[]) => {
      const updates = Array.isArray(data) ? data : [data];
      this.setState({ autopilotNotes: this.mergeAutopilotNotes(updates) });
    });

    this.bridge.on('debug_log', (entry: DebugLogEntry) => {
      this.appendDebugLog(entry);
    });

    this.bridge.on('active_tab_changed', (payload: { tabId: TabId; isActive: boolean }) => {
      this.setState({ boundTab: payload.tabId, isBoundActive: payload.isActive });
    });

    this.bridge.on('connection', (status: { connected: boolean }) => {
      this.setState({ isConnected: status.connected });
    });

    this.bridge.on('patient', (info: PatientInfo) => {
      this.setState({ patientInfo: info });
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
    const cleared: Record<TabId, TranscriptLine[]> = {
      summary: [],
      soap: [],
      transcript: [],
      tasks: [],
      patient: [],
      debug: []
    };
    this.setState({ transcriptByTab: cleared });
    this.transcriptView.clear();
  }

  private addTranscriptLine(line: TranscriptLine): void {
    const tabId = line.tabId || this.state.boundTab || this.state.activeTab || 'transcript';
    const currentLines = this.state.transcriptByTab[tabId] || [];
    const lines = [...currentLines];

    const existingIndex = lines.findIndex(l => l.id === line.id);
    if (existingIndex >= 0) {
      lines[existingIndex] = { ...line, tabId };
    } else {
      lines.push({ ...line, tabId });
    }

    const transcriptByTab = { ...this.state.transcriptByTab, [tabId]: lines };
    this.setState({ transcriptByTab });
    if (this.state.activeTab === tabId) {
      this.transcriptView.updateLines(lines);
    }
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
    this.updateBindingBanner();

    this.controlButtons.update({
      isRecording: this.state.isRecording,
      isConnected: this.state.isConnected,
      isActive: this.state.isBoundActive
    });

    this.statusPills.update({
      isConnected: this.state.isConnected,
      isRecording: this.state.isRecording,
      patientInfo: this.state.patientInfo,
      boundTab: this.state.boundTab,
      isTabActive: this.state.isBoundActive
    });

    this.tabs.setActiveTab(this.state.activeTab);
    this.tabs.setBoundTab(this.state.boundTab, this.state.isBoundActive);

    this.transcriptView.updateLines(this.state.transcriptByTab[this.state.activeTab]);
    this.updateSummaryPanel();
    this.updateSoapPanel();
    this.updateTasksPanel();
    this.updatePatientPanel();
    this.updateDebugPanel();
  }

  private render(): void {
    const styles = document.createElement('style');
    styles.textContent = this.getStyles();
    this.shadowRoot.appendChild(styles);

    const overlay = document.createElement('div');
    overlay.className = 'ferrari-overlay';
    overlay.innerHTML = `
      <div class="overlay-header">
        <div class="overlay-title">
          <span class="logo">🏎️</span>
          <div class="title-stack">
            <span class="brand">Ferrari</span>
            <span class="subtitle">Clinical Copilot</span>
          </div>
        </div>
        <div class="header-pills" id="status-pills"></div>
        <div class="header-controls">
          <button class="minimize-btn" title="Minimize (Alt+G)">−</button>
        </div>
      </div>
      <div class="binding-banner" id="binding-banner"></div>
      <div class="overlay-tabs" id="tabs-container"></div>
      <div class="overlay-content">
        <div class="tab-panel" id="summary-panel">
          <div class="panel-section">
            <div class="section-header">
              <span class="section-title" id="summary-title">Latest Summary</span>
              <span class="section-subtitle">Auto-generated</span>
            </div>
            <div class="panel-body" id="summary-content"></div>
          </div>
          <div class="panel-section">
            <div class="section-header">
              <span class="section-title">Autopilot Notes</span>
            </div>
            <div class="panel-body" id="autopilot-summary"></div>
          </div>
        </div>
        <div class="tab-panel hidden" id="soap-panel">
          <div class="soap-grid">
            <div class="soap-card" data-section="subjective">
              <div class="section-header"><span class="section-title">Subjective</span></div>
              <div class="panel-body" id="soap-subjective"></div>
            </div>
            <div class="soap-card" data-section="objective">
              <div class="section-header"><span class="section-title">Objective</span></div>
              <div class="panel-body" id="soap-objective"></div>
            </div>
            <div class="soap-card" data-section="assessment">
              <div class="section-header"><span class="section-title">Assessment</span></div>
              <div class="panel-body" id="soap-assessment"></div>
            </div>
            <div class="soap-card" data-section="plan">
              <div class="section-header"><span class="section-title">Plan</span></div>
              <div class="panel-body" id="soap-plan"></div>
            </div>
          </div>
        </div>
        <div class="tab-panel hidden" id="transcript-panel"></div>
        <div class="tab-panel hidden" id="tasks-panel">
          <div class="panel-section">
            <div class="section-header">
              <span class="section-title">Tasks</span>
            </div>
            <div class="panel-body" id="tasks-list"></div>
          </div>
          <div class="panel-section">
            <div class="section-header">
              <span class="section-title">Autopilot</span>
            </div>
            <div class="panel-body" id="autopilot-tasks"></div>
          </div>
        </div>
        <div class="tab-panel hidden" id="patient-panel">
          <div class="panel-section">
            <div class="section-header">
              <span class="section-title">Patient Details</span>
            </div>
            <div class="panel-body" id="patient-details"></div>
          </div>
          <div class="panel-section">
            <div class="section-header">
              <span class="section-title">Autopilot</span>
            </div>
            <div class="panel-body" id="patient-autopilot"></div>
          </div>
        </div>
        <div class="tab-panel hidden" id="debug-panel">
          <div class="panel-section">
            <div class="section-header">
              <span class="section-title">Debug Feed</span>
            </div>
            <div class="panel-body" id="debug-log"></div>
          </div>
        </div>
      </div>
      <div class="overlay-footer" id="control-buttons"></div>
    `;

    this.shadowRoot.appendChild(overlay);

    const pillsContainer = this.shadowRoot.getElementById('status-pills');
    const tabsContainer = this.shadowRoot.getElementById('tabs-container');
    const transcriptPanel = this.shadowRoot.getElementById('transcript-panel');
    const controlsContainer = this.shadowRoot.getElementById('control-buttons');

    this.summaryContent = this.shadowRoot.getElementById('summary-content');
    this.summaryTitle = this.shadowRoot.getElementById('summary-title');
    this.soapSections = {
      subjective: this.shadowRoot.getElementById('soap-subjective') as HTMLElement,
      objective: this.shadowRoot.getElementById('soap-objective') as HTMLElement,
      assessment: this.shadowRoot.getElementById('soap-assessment') as HTMLElement,
      plan: this.shadowRoot.getElementById('soap-plan') as HTMLElement
    };
    this.tasksList = this.shadowRoot.getElementById('tasks-list');
    this.autopilotSummary = this.shadowRoot.getElementById('autopilot-summary');
    this.autopilotTasks = this.shadowRoot.getElementById('autopilot-tasks');
    this.patientDetails = this.shadowRoot.getElementById('patient-details');
    this.patientAutopilot = this.shadowRoot.getElementById('patient-autopilot');
    this.debugList = this.shadowRoot.getElementById('debug-log');
    this.bindingBanner = this.shadowRoot.getElementById('binding-banner');

    if (pillsContainer) this.statusPills.mount(pillsContainer);
    if (tabsContainer) this.tabs.mount(tabsContainer);
    if (transcriptPanel) this.transcriptView.mount(transcriptPanel);
    if (controlsContainer) this.controlButtons.mount(controlsContainer);

    const minimizeBtn = this.shadowRoot.querySelector('.minimize-btn');
    minimizeBtn?.addEventListener('click', () => this.toggleVisibility());
  }

  private updateSummaryPanel(): void {
    if (this.summaryTitle) {
      this.summaryTitle.textContent = this.state.summary?.title || 'Latest Summary';
    }

    this.setPanelBody(
      this.summaryContent,
      this.state.summary?.content,
      'Awaiting summary data from the assistant.'
    );

    this.renderAutopilotChips(this.autopilotSummary, 'summary', 'No autopilot notes yet.');
    this.updateBindingBanner();
  }

  private updateSoapPanel(): void {
    if (!this.soapSections) return;

    (Object.keys(this.soapSections) as (keyof SoapNote)[]).forEach(key => {
      const value = this.state.soap[key];
      this.setPanelBody(this.soapSections![key], value, 'No content yet.');
    });
  }

  private updateTasksPanel(): void {
    if (this.tasksList) {
      const tasksForTab = this.filterByTab(this.state.tasks, 'tasks');
      if (tasksForTab.length === 0) {
        this.tasksList.classList.add('empty');
        this.tasksList.textContent = 'No tasks available.';
      } else {
        this.tasksList.classList.remove('empty');
        this.tasksList.innerHTML = tasksForTab
          .map(task => `
            <div class="task-item">
              <span class="task-check ${task.completed ? 'completed' : ''}"></span>
              <span>${task.label}</span>
            </div>
          `)
          .join('');
      }
    }

    this.renderAutopilotChips(this.autopilotTasks, 'tasks', 'No autopilot items.');
  }

  private updatePatientPanel(): void {
    if (this.patientDetails) {
      if (!this.state.patientInfo) {
        this.patientDetails.classList.add('empty');
        this.patientDetails.textContent = 'No patient context yet.';
      } else {
        this.patientDetails.classList.remove('empty');
        const { name, mrn, dob } = this.state.patientInfo;
        this.patientDetails.innerHTML = `
          <div class="patient-field"><span class="patient-label">Name:</span>${name}</div>
          <div class="patient-field"><span class="patient-label">MRN:</span>${mrn}</div>
          ${dob ? `<div class="patient-field"><span class="patient-label">DOB:</span>${dob}</div>` : ''}
        `;
      }
    }

    this.renderAutopilotChips(this.patientAutopilot, 'patient', 'No autopilot guidance.');
  }

  private updateDebugPanel(): void {
    if (!this.debugList) return;

    const entries = this.filterByTab(this.state.debugLogs, 'debug');
    if (entries.length === 0) {
      this.debugList.classList.add('empty');
      this.debugList.textContent = 'No debug messages yet.';
      return;
    }

    this.debugList.classList.remove('empty');
    this.debugList.innerHTML = entries
      .map(entry => `
        <div class="debug-entry" data-level="${entry.level || 'info'}">
          [${this.formatTime(entry.timestamp)}] ${entry.message}
        </div>
      `)
      .join('');
  }

  private updateBindingBanner(): void {
    if (!this.bindingBanner) return;

    if (!this.state.boundTab) {
      this.bindingBanner.classList.remove('active');
      this.bindingBanner.textContent = '';
      return;
    }

    this.bindingBanner.classList.add('active');
    this.bindingBanner.textContent = this.state.isBoundActive
      ? `Websocket feed is active for the ${this.state.boundTab.toUpperCase()} tab.`
      : `Websocket feed is inactive. Controls are disabled for ${this.state.boundTab.toUpperCase()}.`;
  }

  private setPanelBody(element?: HTMLElement | null, value?: string, emptyText?: string): void {
    if (!element) return;
    if (!value) {
      element.classList.add('empty');
      element.textContent = emptyText || 'No data available yet.';
      return;
    }

    element.classList.remove('empty');
    element.textContent = value;
  }

  private renderAutopilotChips(container: HTMLElement | null | undefined, tabId: TabId, emptyText: string): void {
    if (!container) return;
    const notes = this.filterByTab(this.state.autopilotNotes, tabId);
    if (notes.length === 0) {
      container.classList.add('empty');
      container.textContent = emptyText;
      return;
    }

    container.classList.remove('empty');
    container.innerHTML = notes
      .map(note => `
        <span class="autopilot-chip">
          <span class="dot"></span>
          ${note.content}
        </span>
      `)
      .join('');
  }

  private formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  private mergeTaskUpdates(updates: TaskItem[]): TaskItem[] {
    const merged = [...this.state.tasks];
    updates.forEach(update => {
      const idx = merged.findIndex(task => task.id === update.id);
      if (idx >= 0) {
        merged[idx] = { ...merged[idx], ...update };
      } else {
        merged.push(update);
      }
    });
    return merged;
  }

  private mergeAutopilotNotes(updates: AutopilotNote[]): AutopilotNote[] {
    const merged = [...this.state.autopilotNotes];
    updates.forEach(update => {
      const idx = merged.findIndex(note => note.id === update.id);
      if (idx >= 0) {
        merged[idx] = { ...merged[idx], ...update };
      } else {
        merged.push(update);
      }
    });
    return merged;
  }

  private appendDebugLog(entry: DebugLogEntry): void {
    const merged = [...this.state.debugLogs, entry].slice(-100);
    this.setState({ debugLogs: merged });
  }

  private filterByTab<T extends { tabId?: TabId }>(items: T[], tabId: TabId): T[] {
    return items.filter(item => !item.tabId || item.tabId === tabId);
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

      .title-stack {
        display: flex;
        flex-direction: column;
        line-height: 1.1;
      }

      .brand {
        font-size: 14px;
        font-weight: 700;
      }

      .subtitle {
        font-size: 11px;
        opacity: 0.85;
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

      .binding-banner {
        display: none;
        padding: 8px 14px;
        background: #121224;
        color: #cfd1ff;
        border-bottom: 1px solid #2d2d44;
        font-size: 12px;
      }

      .binding-banner.active {
        display: block;
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

      .panel-section + .panel-section {
        margin-top: 12px;
      }

      .section-header {
        display: flex;
        align-items: baseline;
        gap: 8px;
        margin-bottom: 6px;
      }

      .section-title {
        font-size: 13px;
        font-weight: 700;
        color: #f5f5f5;
      }

      .section-subtitle {
        font-size: 11px;
        color: #9aa0c2;
      }

      .panel-body {
        background: #16162a;
        border: 1px solid #2d2d44;
        border-radius: 10px;
        padding: 10px;
        color: #d2d4f0;
        min-height: 64px;
        font-size: 13px;
        line-height: 1.4;
      }

      .panel-body.empty {
        color: #5c6186;
        font-style: italic;
      }

      .soap-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
      }

      .soap-card .panel-body {
        min-height: 80px;
      }

      .task-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 0;
        border-bottom: 1px solid #252542;
      }

      .task-item:last-child {
        border-bottom: none;
      }

      .task-check {
        width: 14px;
        height: 14px;
        border-radius: 4px;
        border: 1px solid #3d3d5c;
        background: #0f0f1f;
      }

      .task-check.completed {
        background: #4caf50;
        border-color: #4caf50;
      }

      .autopilot-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        border-radius: 8px;
        background: rgba(230, 57, 70, 0.12);
        color: #ff7b88;
        font-size: 12px;
        margin: 4px 4px 0 0;
      }

      .autopilot-chip .dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: currentColor;
      }

      .patient-field {
        margin-bottom: 6px;
        font-size: 13px;
      }

      .patient-label {
        color: #8a8db6;
        margin-right: 6px;
      }

      .debug-entry {
        font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
        font-size: 12px;
        padding: 6px 8px;
        border-radius: 6px;
        background: #0f0f1f;
        margin-bottom: 6px;
        border: 1px solid #2d2d44;
      }

      .debug-entry[data-level="warn"] {
        border-color: #ffb74d;
        color: #ffb74d;
      }

      .debug-entry[data-level="error"] {
        border-color: #ef5350;
        color: #ef9a9a;
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
