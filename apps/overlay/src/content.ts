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
import { SmartFillExecutor, SmartFillStep } from './smartFill';

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
    const smartFillExecutor = new SmartFillExecutor(domMapper, bridge);

    // Create and mount the overlay
    const overlay = new FerrariOverlay(bridge, domMapper, tabId);
    overlay.mount();

    // Setup bridge handlers
    setupBridgeHandlers(bridge, audioCapture, domMapper, smartFillExecutor, tabId);

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
  smartFillExecutor: SmartFillExecutor,
  localTabId: string
): void {
  // Handle recording commands
  bridge.on('start-recording', async (payload: { tabId?: string }) => {
    if (payload?.tabId && payload.tabId !== localTabId) return;
    try {
      await audioCapture.start();
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
      bridge.emit('recording-stopped', { tabId: localTabId });
    } catch (error) {
      console.error('[GHOST-NEXT] Failed to stop recording:', error);
    }
  });

  // Handle DOM mapping commands
  bridge.on('map-fields', () => {
    const snapshot = domMapper.getMappingSnapshot();
    bridge.emit('fields-detected', { ...snapshot, tabId: localTabId });

    if (snapshot.patientHint) {
      bridge.emit('patient', { ...snapshot.patientHint, tabId: localTabId });
    }
  });

  bridge.on('get-patient-info', () => {
    const patientInfo = domMapper.extractPatientInfo();
    if (patientInfo) {
      bridge.emit('patient', { ...patientInfo, tabId: localTabId });
    } else {
      bridge.emit('patient', { tabId: localTabId });
    }
  });

  bridge.on('smart-fill-steps', async (payload: { steps?: SmartFillStep[]; requestId?: string; tabId?: string }) => {
    if (payload?.tabId && payload.tabId !== localTabId) return;
    if (!payload?.steps?.length) {
      await bridge.emit('smart-fill-result', {
        success: false,
        message: 'No Smart Fill steps provided.',
        steps: [],
        requestId: payload?.requestId,
        tabId: localTabId
      });
      return;
    }

    const result = await smartFillExecutor.execute(payload.steps, payload.requestId);
    await bridge.emit('smart-fill-result', { ...result, tabId: localTabId });
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

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  console.log('[GHOST-NEXT] Page unloading, cleaning up...');
  // Bridge and audio capture will handle their own cleanup
});
