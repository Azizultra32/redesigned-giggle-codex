import { RecorderState } from '../types';

interface RecorderPillState {
  state: RecorderState;
  message?: string;
}

export class RecorderPill {
  private shadowRoot: ShadowRoot;
  private container: HTMLElement | null = null;
  private state: RecorderPillState = { state: 'idle' };

  constructor(shadowRoot: ShadowRoot) {
    this.shadowRoot = shadowRoot;
  }

  public mount(container: HTMLElement): void {
    this.container = container;
    this.render();
  }

  public update(state: RecorderPillState): void {
    this.state = state;
    this.updatePill();
  }

  private render(): void {
    if (!this.container) return;

    const styles = document.createElement('style');
    styles.textContent = this.getStyles();
    const pill = document.createElement('div');
    pill.className = 'recorder-pill';
    pill.innerHTML = `
      <span class="recorder-dot"></span>
      <div class="recorder-text">
        <span class="recorder-label">Recorder</span>
        <span class="recorder-state"></span>
      </div>
    `;

    this.container.appendChild(styles);
    this.container.appendChild(pill);

    this.updatePill();
  }

  private updatePill(): void {
    if (!this.container) return;
    const pill = this.container.querySelector('.recorder-pill') as HTMLElement | null;
    const stateEl = this.container.querySelector('.recorder-state');
    const dot = this.container.querySelector('.recorder-dot');

    if (pill && stateEl && dot) {
      pill.setAttribute('data-state', this.state.state);
      stateEl.textContent = this.getStateLabel();
      dot.className = `recorder-dot state-${this.state.state}`;
      pill.title = this.state.message || this.getStateLabel();
    }
  }

  private getStateLabel(): string {
    switch (this.state.state) {
      case 'connecting':
        return 'Connecting';
      case 'listening':
        return 'Listening';
      case 'error':
        return 'Error';
      default:
        return 'Idle';
    }
  }

  private getStyles(): string {
    return `
      .recorder-pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        background: rgba(0, 0, 0, 0.25);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 16px;
        padding: 6px 12px;
        color: #fff;
        font-size: 12px;
        letter-spacing: 0.2px;
        min-width: 120px;
      }

      .recorder-pill[data-state='connecting'] {
        background: linear-gradient(135deg, rgba(255, 193, 7, 0.18), rgba(255, 152, 0, 0.15));
        border-color: rgba(255, 193, 7, 0.4);
      }

      .recorder-pill[data-state='listening'] {
        background: linear-gradient(135deg, rgba(76, 175, 80, 0.18), rgba(56, 142, 60, 0.15));
        border-color: rgba(76, 175, 80, 0.45);
      }

      .recorder-pill[data-state='error'] {
        background: linear-gradient(135deg, rgba(244, 67, 54, 0.18), rgba(229, 57, 53, 0.15));
        border-color: rgba(244, 67, 54, 0.45);
      }

      .recorder-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: #757575;
        box-shadow: 0 0 0 0 rgba(255, 255, 255, 0.2);
        transition: all 0.3s ease;
      }

      .recorder-dot.state-connecting {
        background: #ffc107;
        animation: pulse 1s infinite;
      }

      .recorder-dot.state-listening {
        background: #66bb6a;
        animation: breathe 1.6s infinite;
      }

      .recorder-dot.state-error {
        background: #ef5350;
      }

      .recorder-text {
        display: flex;
        flex-direction: column;
        line-height: 1.2;
      }

      .recorder-label {
        font-size: 11px;
        color: rgba(255, 255, 255, 0.65);
      }

      .recorder-state {
        font-size: 12px;
        font-weight: 700;
      }

      @keyframes pulse {
        0% { box-shadow: 0 0 0 0 rgba(255, 193, 7, 0.4); }
        70% { box-shadow: 0 0 0 10px rgba(255, 193, 7, 0); }
        100% { box-shadow: 0 0 0 0 rgba(255, 193, 7, 0); }
      }

      @keyframes breathe {
        0% { box-shadow: 0 0 0 0 rgba(102, 187, 106, 0.25); }
        50% { box-shadow: 0 0 0 8px rgba(102, 187, 106, 0); }
        100% { box-shadow: 0 0 0 0 rgba(102, 187, 106, 0.25); }
      }
    `;
  }
}
