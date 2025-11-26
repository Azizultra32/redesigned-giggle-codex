/**
 * FeedBadges Component
 *
 * Renders compact badges for Feed A-E statuses with color-coded states.
 */

export type FeedStatus = 'connected' | 'disconnected' | 'ready' | 'error';

export interface FeedStatusInfo {
  feed: string;
  label?: string;
  status: FeedStatus;
  timestamp?: string;
}

export class FeedBadges {
  private shadowRoot: ShadowRoot;
  private container: HTMLElement | null = null;
  private statuses: Map<string, FeedStatusInfo> = new Map();

  constructor(shadowRoot: ShadowRoot) {
    this.shadowRoot = shadowRoot;
  }

  public mount(container: HTMLElement): void {
    this.container = container;
    this.render();
  }

  public update(status: FeedStatusInfo): void {
    this.statuses.set(status.feed, status);
    this.updateBadges();
  }

  private render(): void {
    if (!this.container) return;

    const styles = document.createElement('style');
    styles.textContent = this.getStyles();

    const wrapper = document.createElement('div');
    wrapper.className = 'feed-badges';
    wrapper.innerHTML = `<div class="badges-row"></div>`;

    this.container.appendChild(styles);
    this.container.appendChild(wrapper);

    this.updateBadges();
  }

  private updateBadges(): void {
    if (!this.container) return;

    const row = this.container.querySelector('.badges-row');
    if (!row) return;

    row.innerHTML = '';
    const sorted = Array.from(this.statuses.values()).sort((a, b) => a.feed.localeCompare(b.feed));

    sorted.forEach((status) => {
      const badge = document.createElement('div');
      badge.className = `feed-badge status-${status.status}`;
      badge.title = `${status.label || 'Feed'} (${status.feed}) — ${status.status}`;
      badge.innerHTML = `
        <span class="feed-id">${status.feed}</span>
        <span class="feed-label">${status.label || 'Unknown'}</span>
      `;
      row.appendChild(badge);
    });
  }

  private getStyles(): string {
    return `
      .feed-badges {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 6px 12px;
        background: rgba(255, 255, 255, 0.02);
        border-bottom: 1px solid #2d2d44;
      }

      .badges-row {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }

      .feed-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 8px;
        border-radius: 10px;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.2px;
        background: rgba(255, 255, 255, 0.06);
        color: #e2e8f0;
        border: 1px solid rgba(255, 255, 255, 0.08);
      }

      .feed-id {
        padding: 2px 6px;
        border-radius: 6px;
        background: rgba(0, 0, 0, 0.3);
        font-size: 10px;
      }

      .feed-badge.status-connected {
        border-color: rgba(76, 175, 80, 0.5);
        color: #b2f5ea;
      }

      .feed-badge.status-ready {
        border-color: rgba(255, 193, 7, 0.5);
        color: #ffe082;
      }

      .feed-badge.status-error {
        border-color: rgba(244, 67, 54, 0.7);
        color: #ff8a80;
      }

      .feed-badge.status-disconnected {
        border-color: rgba(158, 158, 158, 0.4);
        color: #cfd8dc;
      }
    `;
  }
}
