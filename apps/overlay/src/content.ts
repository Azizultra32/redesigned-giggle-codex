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
import { DOMMapper } from './domMapper';
import { DomMapClient } from './domMapClient';

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

    // Initialize DOM map client for backend coordination
    const domMapClient = new DomMapClient(bridge, domMapper, tabId);

    // Create and mount the overlay
    const overlay = new FerrariOverlay(bridge, domMapper, domMapClient, tabId);
    overlay.mount();

    // Setup bridge handlers
    setupBridgeHandlers(bridge, audioCapture, domMapper, domMapClient, tabId);

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
  domMapClient: DomMapClient,
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
    const fields = domMapper.detectFields();
    bridge.emit('fields-detected', { fields, tabId: localTabId });
    domMapClient.sendDomMap().catch(error => {
      console.error('[GHOST-NEXT] Failed to send DOM map:', error);
    });
  });

  bridge.on('get-patient-info', () => {
    const patientInfo = domMapper.extractPatientInfo();
    if (patientInfo) {
      bridge.emit('patient', { ...patientInfo, tabId: localTabId });
    } else {
      bridge.emit('patient', { tabId: localTabId });
    }
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

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  console.log('[GHOST-NEXT] Page unloading, cleaning up...');
  // Bridge and audio capture will handle their own cleanup
});
