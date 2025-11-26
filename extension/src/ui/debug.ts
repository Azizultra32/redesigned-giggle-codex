/**
 * Debug Panel
 *
 * Displays live diagnostic badges for the overlay including:
 * - Connection and audio feed status
 * - DOM coverage snapshot
 * - Transcript availability
 * - Autopilot readiness signal
 */

export interface DebugState {
  isConnected: boolean;
  isRecording: boolean;
  feedStatus: 'connected' | 'recording' | 'stopped' | 'disconnected' | 'error';
  domCoverage: number;
  transcriptAvailable: boolean;
  autopilotReady: boolean;
  autopilotMessage: string;
}

export class DebugPanel {
  private shadowRoot: ShadowRoot;
  private container: HTMLElement | null = null;
  private state: DebugState = {
    isConnected: false,
    isRecording: false,
    feedStatus: 'disconnected',
    domCoverage: 0,
    transcriptAvailable: false,
    autopilotReady: false,
    autopilotMessage: 'Waiting for DOM coverage and transcript'
  };

  constructor(shadowRoot: ShadowRoot) {
    this.shadowRoot = shadowRoot;
  }

  public mount(container: HTMLElement): void {
    this.container = container;
    this.render();
  }

  public update(state: Partial<DebugState>): void {
    this.state = { ...this.state, ...state };
    this.updateStatus();
  }

  private render(): void {
    if (!this.container) return;

    const styles = document.createElement('style');
    styles.textContent = this.getStyles();

    this.container.innerHTML = `
      <div class="debug-grid">
        <div class="debug-card">
          <div class="label">Connection</div>
          <div class="badge" data-state="disconnected" id="connection-badge">Offline</div>
        </div>
        <div class="debug-card">
          <div class="label">Feed</div>
          <div class="badge" data-state="disconnected" id="feed-badge">Disconnected</div>
        </div>
        <div class="debug-card">
          <div class="label">Recording</div>
          <div class="badge" data-state="idle" id="recording-badge">Idle</div>
        </div>
        <div class="debug-card">
          <div class="label">DOM Coverage</div>
          <div class="metric"> <span id="coverage-value">0%</span></div>
          <div class="progress"><div class="progress-bar" id="coverage-bar" style="width:0%"></div></div>
        </div>
        <div class="debug-card">
          <div class="label">Transcript</div>
          <div class="badge" data-state="missing" id="transcript-badge">Waiting</div>
        </div>
        <div class="debug-card wide">
          <div class="label">Autopilot</div>
          <div class="badge" data-state="pending" id="autopilot-badge">Pending</div>
          <div class="description" id="autopilot-message"></div>
        </div>
      </div>
    `;

    this.container.appendChild(styles);
    this.updateStatus();
  }

  private updateStatus(): void {
    if (!this.container) return;

    const connectionBadge = this.container.querySelector('#connection-badge') as HTMLElement;
    const feedBadge = this.container.querySelector('#feed-badge') as HTMLElement;
    const recordingBadge = this.container.querySelector('#recording-badge') as HTMLElement;
    const coverageValue = this.container.querySelector('#coverage-value') as HTMLElement;
    const coverageBar = this.container.querySelector('#coverage-bar') as HTMLElement;
    const transcriptBadge = this.container.querySelector('#transcript-badge') as HTMLElement;
    const autopilotBadge = this.container.querySelector('#autopilot-badge') as HTMLElement;
    const autopilotMessage = this.container.querySelector('#autopilot-message') as HTMLElement;

    if (connectionBadge) {
      connectionBadge.dataset.state = this.state.isConnected ? 'connected' : 'disconnected';
      connectionBadge.textContent = this.state.isConnected ? 'Connected' : 'Disconnected';
    }

    if (feedBadge) {
      feedBadge.dataset.state = this.state.feedStatus;
      const labelMap: Record<DebugState['feedStatus'], string> = {
        connected: 'Connected',
        recording: 'Recording',
        stopped: 'Stopped',
        disconnected: 'Disconnected',
        error: 'Error'
      };
      feedBadge.textContent = labelMap[this.state.feedStatus];
    }

    if (recordingBadge) {
      recordingBadge.dataset.state = this.state.isRecording ? 'recording' : 'idle';
      recordingBadge.textContent = this.state.isRecording ? 'Recording' : 'Idle';
    }

    if (coverageValue && coverageBar) {
      const coverage = Math.max(0, Math.min(100, Math.round(this.state.domCoverage)));
      coverageValue.textContent = `${coverage}%`;
      coverageBar.style.width = `${coverage}%`;
    }

    if (transcriptBadge) {
      transcriptBadge.dataset.state = this.state.transcriptAvailable ? 'ready' : 'missing';
      transcriptBadge.textContent = this.state.transcriptAvailable ? 'Available' : 'Waiting';
    }

    if (autopilotBadge && autopilotMessage) {
      autopilotBadge.dataset.state = this.state.autopilotReady ? 'ready' : 'pending';
      autopilotBadge.textContent = this.state.autopilotReady ? 'Ready' : 'Pending';
      autopilotMessage.textContent = this.state.autopilotMessage;
    }
  }

  private getStyles(): string {
    return `
      .debug-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }

      .debug-card {
        background: #111827;
        border: 1px solid #2d2d44;
        border-radius: 8px;
        padding: 8px 10px;
        color: #e5e7eb;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .debug-card.wide {
        grid-column: span 2;
      }

      .label {
        font-size: 11px;
        font-weight: 600;
        color: #9ca3af;
        text-transform: uppercase;
        letter-spacing: 0.4px;
      }

      .badge {
        display: inline-flex;
        align-items: center;
        padding: 4px 8px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 700;
        width: fit-content;
        text-transform: capitalize;
      }

      .badge[data-state='connected'] { background: rgba(76, 175, 80, 0.15); color: #4caf50; }
      .badge[data-state='disconnected'] { background: rgba(244, 67, 54, 0.15); color: #f87171; }
      .badge[data-state='recording'] { background: rgba(244, 67, 54, 0.2); color: #ef4444; }
      .badge[data-state='idle'], .badge[data-state='stopped'] { background: rgba(156, 163, 175, 0.2); color: #d1d5db; }
      .badge[data-state='error'] { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
      .badge[data-state='ready'] { background: rgba(52, 211, 153, 0.15); color: #34d399; }
      .badge[data-state='pending'], .badge[data-state='missing'] { background: rgba(250, 204, 21, 0.15); color: #fbbf24; }

      .metric {
        font-size: 16px;
        font-weight: 700;
      }

      .progress {
        height: 6px;
        background: #1f2937;
        border-radius: 4px;
        overflow: hidden;
      }

      .progress-bar {
        height: 100%;
        background: linear-gradient(90deg, #34d399, #10b981);
        width: 0%;
      }

      .description {
        font-size: 12px;
        color: #d1d5db;
      }
    `;
  }
}
