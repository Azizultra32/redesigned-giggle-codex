/**
 * Transcript View Component
 *
 * Displays real-time transcription with speaker diarization.
 * Shows interim and final transcript lines with timestamps.
 */

export interface TranscriptLine {
  id: string;
  speaker: string;
  text: string;
  timestamp: number;
  isFinal: boolean;
  status?: 'interim' | 'final';
  feed?: string;
}

export class TranscriptView {
  private shadowRoot: ShadowRoot;
  private container: HTMLElement | null = null;
  private linesContainer: HTMLElement | null = null;
  private lines: TranscriptLine[] = [];
  private autoScroll: boolean = true;
  private maxVisibleLines = 300;

  constructor(shadowRoot: ShadowRoot) {
    this.shadowRoot = shadowRoot;
  }

  public mount(container: HTMLElement): void {
    this.container = container;
    this.render();
  }

  public updateLines(lines: TranscriptLine[]): void {
    this.lines = lines;
    this.renderLines();
  }

  public addLine(line: TranscriptLine): void {
    const existingIndex = this.lines.findIndex(l => l.id === line.id);
    if (existingIndex >= 0) {
      this.lines[existingIndex] = line;
    } else {
      this.lines.push(line);
    }
    this.renderLines();
  }

  public clear(): void {
    this.lines = [];
    if (this.linesContainer) {
      this.linesContainer.innerHTML = '';
      this.showEmptyState();
    }
  }

  private render(): void {
    if (!this.container) return;

    // Add styles
    const styles = document.createElement('style');
    styles.textContent = this.getStyles();
    this.container.appendChild(styles);

    // Create transcript wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'transcript-wrapper';

    // Header with controls
    const header = document.createElement('div');
    header.className = 'transcript-header';
    header.innerHTML = `
      <span class="transcript-title">Live Transcript</span>
      <div class="transcript-controls">
        <label class="auto-scroll-toggle">
          <input type="checkbox" checked />
          <span>Auto-scroll</span>
        </label>
      </div>
    `;

    const autoScrollCheckbox = header.querySelector('input');
    autoScrollCheckbox?.addEventListener('change', (e) => {
      this.autoScroll = (e.target as HTMLInputElement).checked;
    });

    // Lines container
    this.linesContainer = document.createElement('div');
    this.linesContainer.className = 'transcript-lines';

    wrapper.appendChild(header);
    wrapper.appendChild(this.linesContainer);
    this.container.appendChild(wrapper);

    this.showEmptyState();
  }

  private renderLines(): void {
    if (!this.linesContainer) return;

    // Clear existing content
    this.linesContainer.innerHTML = '';

    if (this.lines.length === 0) {
      this.showEmptyState();
      return;
    }

    const start = Math.max(0, this.lines.length - this.maxVisibleLines);
    const visibleLines = this.lines.slice(start);
    const hiddenCount = this.lines.length - visibleLines.length;

    if (hiddenCount > 0) {
      const overflowNotice = document.createElement('div');
      overflowNotice.className = 'overflow-notice';
      overflowNotice.textContent = `Showing latest ${visibleLines.length} entries. ${hiddenCount} older lines hidden for performance.`;
      this.linesContainer.appendChild(overflowNotice);
    }

    visibleLines.forEach(line => {
      const lineEl = document.createElement('div');
      lineEl.className = `transcript-line ${line.isFinal ? 'final' : 'interim'}`;
      lineEl.dataset.lineId = line.id;

      const header = document.createElement('div');
      header.className = 'line-header';

      const speakerBadge = document.createElement('span');
      speakerBadge.className = 'speaker-badge';
      const normalizedSpeaker = line.speaker?.toLowerCase?.() || line.speaker || 'unknown';
      speakerBadge.dataset.speaker = normalizedSpeaker;
      speakerBadge.textContent = this.getSpeakerLabel(line.speaker);

      const statusBadge = document.createElement('span');
      statusBadge.className = `status-badge ${line.isFinal ? 'final' : 'interim'}`;
      statusBadge.textContent = line.isFinal ? 'Final' : 'Interim';

      const timestamp = document.createElement('span');
      timestamp.className = 'timestamp';
      timestamp.textContent = this.formatTime(line.timestamp);

      header.appendChild(speakerBadge);
      header.appendChild(statusBadge);
      header.appendChild(timestamp);

      const textEl = document.createElement('div');
      textEl.className = 'line-text';
      textEl.textContent = line.text;

      lineEl.appendChild(header);
      lineEl.appendChild(textEl);

      this.linesContainer!.appendChild(lineEl);
    });

    // Auto-scroll to bottom
    if (this.autoScroll) {
      this.linesContainer.scrollTop = this.linesContainer.scrollHeight;
    }
  }

  private getSpeakerLabel(speaker: string): string {
    // Map speaker IDs to friendly labels
    const speakerMap: Record<string, string> = {
      '0': 'Doctor',
      'doctor': 'Doctor',
      'dr': 'Doctor',
      'provider': 'Doctor',
      'clinician': 'Doctor',
      '1': 'Patient',
      'patient': 'Patient',
      'pt': 'Patient',
      'assistant': 'Assistant',
      'scribe': 'Assistant',
      'agent': 'Assistant',
      'unknown': 'Speaker'
    };

    const normalized = speaker?.toLowerCase?.() || 'unknown';
    return speakerMap[normalized] || `Speaker ${speaker}`;
  }

  private formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  private showEmptyState(): void {
    if (!this.linesContainer) return;

    this.linesContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🎙️</div>
        <p>No transcript yet</p>
        <p class="empty-hint">Start recording to see real-time transcription</p>
      </div>
    `;
  }

  private getStyles(): string {
    return `
      .transcript-wrapper {
        display: flex;
        flex-direction: column;
        height: 280px;
      }

      .transcript-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding-bottom: 8px;
        border-bottom: 1px solid #2d2d44;
        margin-bottom: 8px;
      }

      .transcript-title {
        font-size: 12px;
        font-weight: 600;
        color: #888;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .auto-scroll-toggle {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        color: #666;
        cursor: pointer;
      }

      .auto-scroll-toggle input {
        width: 14px;
        height: 14px;
        accent-color: #e63946;
      }

      .transcript-lines {
        flex: 1;
        overflow-y: auto;
        padding-right: 4px;
      }

      .speaker-group {
        margin-bottom: 16px;
      }

      .overflow-notice {
        font-size: 11px;
        color: #888;
        padding: 4px 0 8px;
      }

      .speaker-badge {
        font-size: 11px;
        font-weight: 600;
        padding: 2px 8px;
        border-radius: 10px;
        text-transform: uppercase;
      }

      .line-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 4px;
      }

      .speaker-badge[data-speaker="0"],
      .speaker-badge[data-speaker="doctor"],
      .speaker-badge[data-speaker="dr"],
      .speaker-badge[data-speaker="provider"],
      .speaker-badge[data-speaker="clinician"] {
        background: rgba(76, 175, 80, 0.2);
        color: #4caf50;
      }

      .speaker-badge[data-speaker="1"],
      .speaker-badge[data-speaker="patient"],
      .speaker-badge[data-speaker="pt"] {
        background: rgba(33, 150, 243, 0.2);
        color: #2196f3;
      }

      .speaker-badge[data-speaker="assistant"],
      .speaker-badge[data-speaker="scribe"],
      .speaker-badge[data-speaker="agent"] {
        background: rgba(156, 39, 176, 0.2);
        color: #ce93d8;
      }

      .timestamp {
        font-size: 10px;
        color: #555;
        margin-left: auto;
      }

      .transcript-line {
        font-size: 13px;
        line-height: 1.5;
        color: #ddd;
        padding: 8px 6px;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.02);
        margin-bottom: 8px;
        border: 1px solid rgba(255, 255, 255, 0.04);
      }

      .line-text {
        white-space: pre-wrap;
      }

      .status-badge {
        font-size: 10px;
        padding: 2px 6px;
        border-radius: 6px;
        border: 1px solid transparent;
      }

      .status-badge.final {
        background: rgba(76, 175, 80, 0.15);
        color: #7cd67f;
        border-color: rgba(76, 175, 80, 0.25);
      }

      .status-badge.interim {
        background: rgba(255, 152, 0, 0.15);
        color: #ffb74d;
        border-color: rgba(255, 152, 0, 0.25);
      }

      .transcript-line.interim .line-text {
        color: #b0b0b0;
        font-style: italic;
      }

      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: #555;
        text-align: center;
      }

      .empty-icon {
        font-size: 48px;
        margin-bottom: 12px;
        opacity: 0.5;
      }

      .empty-state p {
        margin: 4px 0;
        font-size: 14px;
      }

      .empty-hint {
        font-size: 12px !important;
        color: #444;
      }
    `;
  }
}
