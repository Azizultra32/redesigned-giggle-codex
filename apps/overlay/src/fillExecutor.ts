export interface FillStep {
  selector: string;
  value: string;
  action: 'set_text';
  fieldType?: string;
  label?: string;
}

interface AppliedFieldState {
  element: HTMLElement;
  previousValue: string;
  appliedValue: string;
  selector: string;
}

export interface FillResult {
  applied: number;
  skipped: number;
  failed: number;
  details: Array<{ selector: string; status: 'applied' | 'skipped' | 'failed' }>;
}

/**
 * FillExecutor
 *
 * Applies fill steps to DOM elements in an idempotent manner while tracking
 * previous values to support undo operations.
 */
export class FillExecutor {
  private history: AppliedFieldState[] = [];

  constructor() {}

  public apply(steps: FillStep[]): FillResult {
    const result: FillResult = { applied: 0, skipped: 0, failed: 0, details: [] };

    for (const step of steps) {
      const element = document.querySelector<HTMLElement>(step.selector);

      if (!element) {
        result.failed++;
        result.details.push({ selector: step.selector, status: 'failed' });
        continue;
      }

      const currentValue = this.getElementValue(element);

      if (currentValue === step.value) {
        result.skipped++;
        result.details.push({ selector: step.selector, status: 'skipped' });
        continue;
      }

      const applied = this.setElementValue(element, step.value);
      if (applied) {
        this.history.push({
          element,
          previousValue: currentValue,
          appliedValue: step.value,
          selector: step.selector
        });
        result.applied++;
        result.details.push({ selector: step.selector, status: 'applied' });
      } else {
        result.failed++;
        result.details.push({ selector: step.selector, status: 'failed' });
      }
    }

    return result;
  }

  public undoLast(): FillResult {
    if (this.history.length === 0) {
      return { applied: 0, skipped: 0, failed: 0, details: [] };
    }

    const entries = [...this.history].reverse();
    this.history = [];

    const result: FillResult = { applied: 0, skipped: 0, failed: 0, details: [] };

    for (const entry of entries) {
      if (!document.contains(entry.element)) {
        result.failed++;
        result.details.push({ selector: entry.selector, status: 'failed' });
        continue;
      }

      const currentValue = this.getElementValue(entry.element);
      if (currentValue === entry.previousValue) {
        result.skipped++;
        result.details.push({ selector: entry.selector, status: 'skipped' });
        continue;
      }

      const reverted = this.setElementValue(entry.element, entry.previousValue);
      if (reverted) {
        result.applied++;
        result.details.push({ selector: entry.selector, status: 'applied' });
      } else {
        result.failed++;
        result.details.push({ selector: entry.selector, status: 'failed' });
      }
    }

    return result;
  }

  private getElementValue(element: HTMLElement): string {
    if (element.isContentEditable) {
      return element.textContent?.trim() || '';
    }

    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      return element.value;
    }

    return element.textContent?.trim() || '';
  }

  private setElementValue(element: HTMLElement, value: string): boolean {
    try {
      if (element.isContentEditable) {
        element.textContent = value;
      } else if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        element.value = value;
      } else {
        element.textContent = value;
      }

      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      element.dispatchEvent(new Event('blur', { bubbles: true }));

      return true;
    } catch (error) {
      console.error('[FillExecutor] Failed to set value:', error);
      return false;
    }
  }
}
