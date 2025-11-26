/**
 * Content Script - Entry Point
 *
 * This script runs in the context of web pages and is responsible for:
 * 1. Injecting the Ferrari overlay into the page
 * 2. Initializing the runtime and bridge
 * 3. Handling communication with the background service worker
 */

import { FerrariOverlay } from './overlay';
import { Bridge } from './bridge';
import { AudioCapture } from './audio-capture';
import { DOMMapper, DetectedField } from './domMapper';
import { FeedClient } from './feed-client';

interface PatientContext {
  name?: string;
  mrn?: string;
  dob?: string;
}

interface SmartFillStep {
  action: 'switch-tab' | 'click' | 'type' | 'focus-field' | 'wait';
  selector?: string;
  value?: string;
  description?: string;
  durationMs?: number;
  fieldId?: string;
}

// Prevent multiple injections
if ((window as any).__GHOST_NEXT_INJECTED__) {
  console.log('[GHOST-NEXT] Already injected, skipping...');
} else {
  (window as any).__GHOST_NEXT_INJECTED__ = true;
  initializeOverlay();
}

const tabId = `tab-${Date.now()}-${Math.random().toString(16).slice(2)}`;

async function initializeOverlay(): Promise<void> {
  console.log('[GHOST-NEXT] Initializing Ferrari Overlay...');

  try {
    // Initialize bridge for messaging
    const bridge = new Bridge();

    // Initialize audio capture system
    const audioCapture = new AudioCapture(bridge, {}, tabId);

    // Initialize DOM mapper for field detection
    const domMapper = new DOMMapper(bridge);

    // Create and mount the overlay
    const overlay = new FerrariOverlay(bridge, domMapper, tabId);
    overlay.mount();

    // Setup bridge handlers
    setupBridgeHandlers(bridge, audioCapture, domMapper, tabId, () =>
      new FeedClient(bridge, tabId, { feedId: 'A' })
    );

    // Connect to background service worker
    await bridge.connect();

    await overlay.sendHello();

    console.log('[GHOST-NEXT] Ferrari Overlay initialized successfully');
  } catch (error) {
    console.error('[GHOST-NEXT] Failed to initialize overlay:', error);
  }
}

function setupBridgeHandlers(
  bridge: Bridge,
  audioCapture: AudioCapture,
  domMapper: DOMMapper,
  localTabId: string,
  feedClientFactory: () => FeedClient
): void {
  let feedClient: FeedClient | null = null;

  // Handle recording commands
  bridge.on('start-recording', async (payload: { tabId?: string }) => {
    if (payload?.tabId && payload.tabId !== localTabId) return;
    try {
      await audioCapture.start();
      if (!feedClient) {
        feedClient = feedClientFactory();
      }
      feedClient.connect();
      bridge.emit('recording-started', { tabId: localTabId });
    } catch (error) {
      console.error('[GHOST-NEXT] Failed to start recording:', error);
      bridge.emit('recording-error', { error: String(error), tabId: localTabId });
    }
  });

  bridge.on('stop-recording', async (payload: { tabId?: string }) => {
    if (payload?.tabId && payload.tabId !== localTabId) return;
    try {
      await audioCapture.stop();
      feedClient?.disconnect();
      feedClient = null;
      bridge.emit('recording-stopped', { tabId: localTabId });
    } catch (error) {
      console.error('[GHOST-NEXT] Failed to stop recording:', error);
    }
  });

  // Handle DOM mapping commands
  bridge.on('map-fields', () => {
    const fields = domMapper.detectFields();
    bridge.emit('fields-detected', { fields, tabId: localTabId });
  });

  bridge.on('get-patient-info', () => {
    const patientInfo = domMapper.extractPatientInfo();
    if (patientInfo) {
      bridge.emit('patient', { ...patientInfo, tabId: localTabId });
    } else {
      bridge.emit('patient', { tabId: localTabId });
    }
  });

  bridge.on('mcp-fill-sample', async (payload: { value?: string; requestId?: string; tabId?: string }) => {
    if (payload?.tabId && payload.tabId !== localTabId) return;

    const isEnabled = await isMcpAutomationEnabled();
    if (!isEnabled) {
      await bridge.emit('mcp-fill-result', {
        success: false,
        message: 'MCP automation flag is disabled in extension storage.',
        requestId: payload?.requestId,
        tabId: localTabId
      });
      return;
    }

    const result = handleMcpFill(domMapper, payload?.value);

    await bridge.emit('mcp-fill-result', {
      ...result,
      requestId: payload?.requestId,
      tabId: localTabId
    });
  });

  bridge.on('mcp-plan-step', async (payload: {
    step?: SmartFillStep;
    requestId?: string;
    tabId?: string;
    patient?: PatientContext;
  }) => {
    if (payload?.tabId && payload.tabId !== localTabId) return;

    const step = payload?.step;
    if (!step) return;

    const safety = verifyPlanPatientContext(domMapper, step, payload.patient);
    if (!safety.safe) {
      await bridge.emit('mcp-plan-result', {
        success: false,
        message: safety.reason || 'Patient safety check failed before executing Smart Fill step.',
        requestId: payload?.requestId,
        tabId: localTabId,
        patientHint: safety.patientHint
      });
      return;
    }

    const result = await executeSmartFillStep(domMapper, step);

    await bridge.emit('mcp-plan-result', {
      ...result,
      requestId: payload?.requestId,
      tabId: localTabId,
      patientHint: safety.patientHint
    });
  });

  // Handle messages from background service worker
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[GHOST-NEXT] Received message from background:', message);

    switch (message.type) {
      case 'TOGGLE_OVERLAY':
        // Toggle overlay visibility via bridge
        bridge.emit('toggle-overlay', {});
        sendResponse({ success: true });
        break;

      case 'GET_STATUS':
        sendResponse({
          success: true,
          status: {
            injected: true,
            recording: audioCapture.isRecording(),
            connected: bridge.isConnected()
          }
        });
        break;

      case 'TRANSCRIPT_UPDATE':
        bridge.emit('transcript', message.data);
        sendResponse({ success: true });
        break;

      default:
        sendResponse({ success: false, error: 'Unknown message type' });
    }

    return true; // Keep channel open for async response
  });
}

function handleMcpFill(domMapper: DOMMapper, requestedValue?: string): {
  success: boolean;
  message: string;
  targetField?: string;
} {
  try {
    const fields = domMapper.detectFields();
    const targetField = selectFillTarget(fields);

    if (!targetField) {
      return {
        success: false,
        message: 'No writable fields detected in the current DOM.'
      };
    }

    const valueToApply = requestedValue || 'MCP sample fill: hello from AssistMD automation';
    const success = domMapper.setFieldValue(targetField.id, valueToApply);

    return {
      success,
      targetField: targetField.selector,
      message: success
        ? 'Applied sample MCP value to detected field.'
        : 'Failed to write value into the detected field.'
    };
  } catch (error) {
    return {
      success: false,
      message: `MCP fill request failed: ${String(error)}`
    };
  }
}

function isMcpAutomationEnabled(): Promise<boolean> {
  return new Promise(resolve => {
    chrome.storage.local.get(['mcpAutomationEnabled'], (result) => {
      resolve(Boolean(result.mcpAutomationEnabled));
    });
  });
}

function selectFillTarget(fields: DetectedField[]): DetectedField | undefined {
  const priorityOrder: DetectedField['type'][] = ['contenteditable', 'textarea', 'input', 'select'];

  for (const type of priorityOrder) {
    const target = fields.find(field => field.type === type);
    if (target) return target;
  }

  return fields[0];
}

async function executeSmartFillStep(domMapper: DOMMapper, step: SmartFillStep): Promise<{ success: boolean; message: string; targetField?: string }> {
  try {
    switch (step.action) {
      case 'wait': {
        const duration = step.durationMs ?? 300;
        await new Promise(resolve => setTimeout(resolve, duration));
        return { success: true, message: step.description || `Waited ${duration}ms.` };
      }

      case 'click': {
        const target = findTargetElement(domMapper, step);
        if (!target.element) {
          return { success: false, message: 'Target element not found for click step.' };
        }

        target.element.focus();
        target.element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return {
          success: true,
          message: step.description || 'Clicked target element.',
          targetField: target.selector
        };
      }

      case 'type': {
        const target = findTargetElement(domMapper, step);
        if (!target.element) {
          return { success: false, message: 'Target element not found for type step.' };
        }

        const valueToWrite = step.value ?? '';

        if (target.fieldId) {
          const success = domMapper.setFieldValue(target.fieldId, valueToWrite);
          return {
            success,
            message: success ? 'Applied Smart Fill value into field.' : 'Failed to write value via DOM mapper.',
            targetField: target.selector
          };
        }

        applyValueToElement(target.element, valueToWrite);
        return {
          success: true,
          message: step.description || 'Typed value into target element.',
          targetField: target.selector
        };
      }

      case 'focus-field': {
        const target = findTargetElement(domMapper, step);
        if (!target.element) {
          return { success: false, message: 'Target element not found for focus step.' };
        }

        target.element.focus();
        target.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return {
          success: true,
          message: step.description || 'Focused target element.',
          targetField: target.selector
        };
      }

      default:
        return { success: false, message: `Unsupported Smart Fill step: ${step.action}` };
    }
  } catch (error) {
    return { success: false, message: `Smart Fill step failed: ${String(error)}` };
  }
}

function verifyPlanPatientContext(
  domMapper: DOMMapper,
  step: SmartFillStep,
  patient?: PatientContext
): { safe: boolean; reason?: string; patientHint?: PatientContext } {
  if (step.action !== 'type') {
    return { safe: true, patientHint: domMapper.getPatientHint() || undefined };
  }

  const patientHint = domMapper.getPatientHint() || undefined;
  if (patient && patientHint) {
    const mrnMismatch = patient.mrn && patientHint.mrn && normalize(patient.mrn) !== normalize(patientHint.mrn);
    const nameMismatch = patient.name && patientHint.name && normalize(patient.name) !== normalize(patientHint.name);

    if (mrnMismatch || nameMismatch) {
      return {
        safe: false,
        reason: 'Patient context from plan does not match detected patient on page.',
        patientHint
      };
    }
  }

  return { safe: true, patientHint };
}

function findTargetElement(domMapper: DOMMapper, step: SmartFillStep): {
  element?: HTMLElement;
  selector?: string;
  fieldId?: string;
} {
  const fields = domMapper.detectFields();
  const field = fields.find(
    candidate => candidate.id === step.fieldId || (step.selector && candidate.selector === step.selector)
  );

  if (field) {
    return { element: field.element, selector: field.selector, fieldId: field.id };
  }

  if (step.selector) {
    const element = document.querySelector<HTMLElement>(step.selector);
    if (element) {
      return { element, selector: step.selector };
    }
  }

  return {};
}

function applyValueToElement(element: HTMLElement, value: string): void {
  if ('value' in element) {
    (element as HTMLInputElement).value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    element.textContent = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  console.log('[GHOST-NEXT] Page unloading, cleaning up...');
  // Bridge and audio capture will handle their own cleanup
});
