import { Bridge } from './bridge';
import { DOMMapper, DetectedField } from './domMapper';

export type SmartFillAction = 'focus' | 'setValue' | 'insertText';

export interface SmartFillStep {
  action: SmartFillAction;
  selector: string;
  value?: string;
  summary?: string;
}

export interface SmartFillResult {
  success: boolean;
  message: string;
  steps: StepResult[];
  requestId?: string;
}

interface StepResult {
  selector: string;
  success: boolean;
  message: string;
}

export class SmartFillExecutor {
  private domMapper: DOMMapper;
  private bridge: Bridge;
  private undoHistory: { fieldId: string; previousValue: string }[] = [];

  constructor(domMapper: DOMMapper, bridge: Bridge) {
    this.domMapper = domMapper;
    this.bridge = bridge;
  }

  public async execute(steps: SmartFillStep[], requestId?: string): Promise<SmartFillResult> {
    const results: StepResult[] = [];

    for (const step of steps) {
      const stepResult = this.performStep(step);
      results.push(stepResult);

      if (!stepResult.success) {
        return this.emitResult({
          success: false,
          message: `Stopped on failed step for selector ${step.selector}: ${stepResult.message}`,
          steps: results,
          requestId
        });
      }
    }

    return this.emitResult({
      success: true,
      message: 'Smart Fill executed successfully.',
      steps: results,
      requestId
    });
  }

  /**
   * Placeholder undo handler. Replays previous values when available.
   */
  public undoLast(): boolean {
    const lastChange = this.undoHistory.pop();
    if (!lastChange) return false;

    return this.domMapper.setFieldValue(lastChange.fieldId, lastChange.previousValue);
  }

  private emitResult(result: SmartFillResult): SmartFillResult {
    this.bridge.emit('smart-fill-result', result);
    return result;
  }

  private performStep(step: SmartFillStep): StepResult {
    const targetField = this.domMapper.findFieldBySelector(step.selector);

    if (!targetField) {
      return {
        selector: step.selector,
        success: false,
        message: 'Selector not found in detected fields.'
      };
    }

    if (!this.isFieldWritable(targetField)) {
      return {
        selector: step.selector,
        success: false,
        message: 'Field is read-only or not suitable for Smart Fill.'
      };
    }

    if (step.action === 'focus') {
      targetField.element.focus();
      return { selector: step.selector, success: true, message: 'Focused field.' };
    }

    if (!step.value) {
      return {
        selector: step.selector,
        success: false,
        message: 'No value provided for write action.'
      };
    }

    const previousValue = this.readCurrentValue(targetField);
    this.undoHistory.push({ fieldId: targetField.id, previousValue });

    const rawValue = step.action === 'insertText' ? `${previousValue}\n${step.value}` : step.value;
    const valueToApply = rawValue.substring(0, 5000); // Defensive clamp
    const writeSuccess = this.domMapper.setFieldValue(targetField.id, valueToApply);

    return {
      selector: step.selector,
      success: writeSuccess,
      message: writeSuccess ? 'Value applied.' : 'Failed to apply value.'
    };
  }

  private isFieldWritable(field: DetectedField): boolean {
    const element = field.element as HTMLInputElement;
    if (element instanceof HTMLInputElement && element.type === 'password') return false;
    if (element.hasAttribute('readonly') || element.getAttribute('aria-disabled') === 'true') return false;
    if ((element as HTMLInputElement).disabled) return false;

    return true;
  }

  private readCurrentValue(field: DetectedField): string {
    if (field.type === 'contenteditable') {
      return field.element.textContent || '';
    }

    return (field.element as HTMLInputElement).value || '';
  }
}
