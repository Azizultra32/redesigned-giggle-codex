import { FeedState, PatientInfo, StatusLogEntry } from '../types';

interface PatientCardProps {
  patient: PatientInfo | null;
  feeds: FeedState[];
  statusLog: StatusLogEntry[];
}

export class PatientCard {
  private shadowRoot: ShadowRoot;
  private container: HTMLElement | null = null;
  private props: PatientCardProps = { patient: null, feeds: [], statusLog: [] };

  constructor(shadowRoot: ShadowRoot) {
    this.shadowRoot = shadowRoot;
  }

  public mount(container: HTMLElement): void {
    this.container = container;
    this.render();
  }

  public update(props: PatientCardProps): void {
    this.props = props;
    this.updateCard();
  }

  private render(): void {
    if (!this.container) return;

    const styles = document.createElement('style');
    styles.textContent = this.getStyles();

    const card = document.createElement('div');
    card.className = 'patient-card';
    card.innerHTML = `
      <div class="card-header">
        <div>
          <div class="card-label">Patient</div>
          <div class="card-title" data-testid="patient-name">Unknown</div>
        </div>
        <div class="patient-tags">
          <span class="pill" data-tag="mrn">MRN: --</span>
          <span class="pill" data-tag="code">Code: --</span>
          <span class="pill optional" data-tag="uuid">UUID: --</span>
        </div>
      </div>
      <div class="card-body">
        <div class="card-section">
          <div class="section-title">Feed Indicators</div>
          <div class="feed-grid" data-testid="feed-grid"></div>
        </div>
        <div class="card-section">
          <div class="section-title">Status Log</div>
          <div class="status-log" data-testid="status-log"></div>
        </div>
      </div>
    `;

    this.container.appendChild(styles);
    this.container.appendChild(card);

    this.updateCard();
  }

  private updateCard(): void {
    if (!this.container) return;

    const nameEl = this.container.querySelector('[data-testid="patient-name"]');
    const mrnEl = this.container.querySelector('[data-tag="mrn"]');
    const codeEl = this.container.querySelector('[data-tag="code"]');
    const uuidEl = this.container.querySelector('[data-tag="uuid"]');
    const feedGrid = this.container.querySelector('[data-testid="feed-grid"]');
    const statusLog = this.container.querySelector('[data-testid="status-log"]');

    if (nameEl) {
      nameEl.textContent = this.props.patient?.name || 'Unknown patient';
    }

    if (mrnEl) {
      mrnEl.textContent = `MRN: ${this.props.patient?.mrn || '--'}`;
    }

    if (codeEl) {
      const code = this.props.patient?.patient_code || 'n/a';
      codeEl.textContent = `Code: ${code}`;
    }

    if (uuidEl) {
      const uuid = this.props.patient?.patient_uuid;
      uuidEl.textContent = `UUID: ${uuid || 'n/a'}`;
      uuidEl.classList.toggle('optional', !uuid);
    }

    if (feedGrid) {
      feedGrid.innerHTML = '';
      this.props.feeds.forEach(feed => {
        const feedEl = document.createElement('div');
        feedEl.className = 'feed-chip';
        feedEl.setAttribute('data-state', feed.status);
        feedEl.innerHTML = `
          <div class="feed-label">${feed.label}</div>
          <div class="feed-note">${feed.note || 'Idle'}</div>
        `;
        feedGrid.appendChild(feedEl);
      });
    }

    if (statusLog) {
      statusLog.innerHTML = '';
      const entries = this.props.statusLog.slice(-6).reverse();
      entries.forEach(entry => {
        const row = document.createElement('div');
        row.className = `log-row tone-${entry.tone}`;
        const timestamp = new Date(entry.timestamp).toLocaleTimeString('en-US', { hour12: false });
        row.innerHTML = `
          <span class="log-time">${timestamp}</span>
          <span class="log-message">${entry.message}</span>
        `;
        statusLog.appendChild(row);
      });
    }
  }

  private getStyles(): string {
    return `
      .patient-card {
        background: linear-gradient(145deg, rgba(255, 255, 255, 0.04), rgba(0, 0, 0, 0.05));
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 12px;
        padding: 12px 14px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .card-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }

      .card-label {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.4px;
        color: #888;
      }

      .card-title {
        font-size: 18px;
        font-weight: 700;
        color: #fff;
      }

      .patient-tags {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }

      .pill {
        background: rgba(0, 0, 0, 0.2);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 10px;
        padding: 4px 8px;
        font-size: 11px;
        color: #d5d7da;
      }

      .pill.optional {
        opacity: 0.5;
      }

      .card-body {
        display: grid;
        grid-template-columns: 1fr;
        gap: 10px;
      }

      .card-section {
        background: rgba(0, 0, 0, 0.2);
        border-radius: 10px;
        padding: 10px;
        border: 1px solid rgba(255, 255, 255, 0.06);
      }

      .section-title {
        font-size: 12px;
        font-weight: 600;
        color: #b0b3c0;
        margin-bottom: 6px;
      }

      .feed-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
        gap: 8px;
      }

      .feed-chip {
        padding: 8px;
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.06);
      }

      .feed-chip[data-state='streaming'] {
        border-color: rgba(76, 175, 80, 0.45);
        box-shadow: 0 0 0 1px rgba(76, 175, 80, 0.15);
      }

      .feed-chip[data-state='pending'] {
        border-color: rgba(255, 193, 7, 0.45);
      }

      .feed-chip[data-state='error'] {
        border-color: rgba(244, 67, 54, 0.55);
      }

      .feed-label {
        font-size: 12px;
        font-weight: 700;
        color: #fff;
      }

      .feed-note {
        font-size: 11px;
        color: #9ea1ad;
        margin-top: 2px;
      }

      .status-log {
        display: flex;
        flex-direction: column;
        gap: 4px;
        max-height: 150px;
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
      }

      .log-row.tone-warning {
        border: 1px solid rgba(255, 193, 7, 0.4);
      }

      .log-row.tone-error {
        border: 1px solid rgba(244, 67, 54, 0.5);
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
    `;
  }
}
