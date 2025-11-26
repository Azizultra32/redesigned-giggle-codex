/**
 * DebugLog Component
 *
 * Renders a simple event timeline for status and alert transitions.
 */

export interface DebugLogEntry {
  id: string;
  type: 'status' | 'alert' | 'autopilot';
  message: string;
  detail?: string;
  timestamp: string;
  feed?: string;
}

export class DebugLog {
  private shadowRoot: ShadowRoot;
  private container: HTMLElement | null = null;
  private entries: DebugLogEntry[] = [];

  constructor(shadowRoot: ShadowRoot) {
    this.shadowRoot = shadowRoot;
  }

  public mount(container: HTMLElement): void {
    this.container = container;
    this.render();
  }

  public update(entries: DebugLogEntry[]): void {
    this.entries = entries;
    this.renderEntries();
  }

  private render(): void {
    if (!this.container) return;

    const styles = document.createElement('style');
    styles.textContent = this.getStyles();

    const wrapper = document.createElement('div');
    wrapper.className = 'debug-log';
    wrapper.innerHTML = '<div class="log-entries"></div>';

    this.container.appendChild(styles);
    this.container.appendChild(wrapper);

    this.renderEntries();
  }

  private renderEntries(): void {
    if (!this.container) return;
    const list = this.container.querySelector('.log-entries');
    if (!list) return;

    list.innerHTML = '';

    this.entries.forEach((entry) => {
      const row = document.createElement('div');
      row.className = `log-entry type-${entry.type}`;
      row.innerHTML = `
        <div class="log-meta">
          <span class="log-type">${entry.feed || entry.type.toUpperCase()}</span>
          <span class="log-time">${new Date(entry.timestamp).toLocaleTimeString()}</span>
        </div>
        <div class="log-message">${entry.message}</div>
        ${entry.detail ? `<div class="log-detail">${entry.detail}</div>` : ''}
      `;
      list.appendChild(row);
    });
  }

  private getStyles(): string {
    return `
      .debug-log {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .log-entries {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .log-entry {
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 8px;
        padding: 8px 10px;
      }

      .log-entry .log-meta {
        display: flex;
        justify-content: space-between;
        font-size: 11px;
        color: #9fa6b2;
        margin-bottom: 4px;
      }

      .log-entry .log-type {
        font-weight: 600;
        letter-spacing: 0.2px;
      }

      .log-entry .log-message {
        color: #e5e7eb;
        font-size: 13px;
        font-weight: 600;
      }

      .log-entry .log-detail {
        color: #cbd5e1;
        font-size: 12px;
        margin-top: 2px;
      }

      .log-entry.type-alert {
        border-color: rgba(244, 67, 54, 0.5);
      }

      .log-entry.type-autopilot {
        border-color: rgba(100, 181, 246, 0.5);
      }

      .log-entry.type-status {
        border-color: rgba(255, 193, 7, 0.4);
      }
    `;
  }
}
