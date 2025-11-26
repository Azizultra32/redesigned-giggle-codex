import { FieldSummary, PatientInfo } from '../domMapper';

export interface MappingPanelState {
  fields: FieldSummary[];
  patient: PatientInfo | null;
  lastUpdated: number | null;
}

export class MappingPanel {
  private shadowRoot: ShadowRoot;
  private container: HTMLElement | null = null;
  private state: MappingPanelState = { fields: [], patient: null, lastUpdated: null };

  constructor(shadowRoot: ShadowRoot) {
    this.shadowRoot = shadowRoot;
  }

  public mount(container: HTMLElement): void {
    this.container = container;
    this.render();
  }

  public update(state: Partial<MappingPanelState>): void {
    this.state = { ...this.state, ...state };
    this.render();
  }

  private render(): void {
    if (!this.container) return;

    this.container.innerHTML = '';

    const styles = document.createElement('style');
    styles.textContent = `
      .mapping-wrapper { padding: 8px 10px; }
      .mapping-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
      .pill { background: rgba(255, 255, 255, 0.08); padding: 4px 8px; border-radius: 12px; font-size: 11px; color: #ddd; }
      .fields-list { display: flex; flex-direction: column; gap: 8px; max-height: 320px; overflow: auto; }
      .field-card { border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px; padding: 8px; background: rgba(0, 0, 0, 0.2); }
      .field-title { font-size: 13px; color: #fff; margin: 0 0 4px; display: flex; justify-content: space-between; align-items: center; }
      .field-meta { font-size: 11px; color: #aaa; margin: 2px 0; }
      .field-preview { font-size: 12px; color: #ccc; line-height: 1.4; white-space: pre-line; }
      .empty { color: #888; font-size: 12px; }
    `;

    const wrapper = document.createElement('div');
    wrapper.className = 'mapping-wrapper';

    const header = document.createElement('div');
    header.className = 'mapping-header';
    header.innerHTML = `
      <div>
        <div style="font-size:13px;font-weight:600;color:#fff;">Mapped Fields</div>
        <div class="field-meta">${this.state.fields.length} detected</div>
      </div>
      <div class="pill">${this.getPatientLabel()}</div>
    `;

    const list = document.createElement('div');
    list.className = 'fields-list';

    if (!this.state.fields.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No fields mapped yet. Press Map to refresh.';
      list.appendChild(empty);
    } else {
      this.state.fields.forEach(field => {
        const card = document.createElement('div');
        card.className = 'field-card';
        card.innerHTML = `
          <div class="field-title">
            <span>${field.label || field.selector}</span>
            <span class="pill">${field.fieldType}</span>
          </div>
          <div class="field-meta">${field.selector} · ${field.type} · ${(field.confidence * 100).toFixed(0)}% confidence</div>
          <div class="field-preview">${field.valuePreview || '<empty>'}</div>
        `;
        list.appendChild(card);
      });
    }

    wrapper.appendChild(header);
    wrapper.appendChild(list);

    this.container.appendChild(styles);
    this.container.appendChild(wrapper);
  }

  private getPatientLabel(): string {
    if (!this.state.patient) return 'Patient: unknown';
    const { name, mrn } = this.state.patient;
    return `Patient: ${name || 'Unknown'}${mrn ? ` · MRN ${mrn}` : ''}`;
  }
}
