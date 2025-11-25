/**
 * GHOST-NEXT Background Service Worker
 *
 * MV3 service worker for:
 * - Extension icon click handling
 * - Communication between tabs
 * - State persistence
 */

// Extension state
const state = {
  activeTabId: null,
  isRecording: false
};

// Handle extension icon click
chrome.action.onClicked.addListener(async (tab) => {
  console.log('[GHOST BG] Icon clicked on tab:', tab.id);

  // Toggle recording in the content script
  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'toggle_recording'
    });
    console.log('[GHOST BG] Toggle response:', response);
  } catch (error) {
    console.error('[GHOST BG] Failed to send message:', error);
  }
});

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[GHOST BG] Message received:', message.type);

  switch (message.type) {
    case 'recording_started':
      state.isRecording = true;
      state.activeTabId = sender.tab?.id;
      updateIcon(true);
      sendResponse({ success: true });
      break;

    case 'recording_stopped':
      state.isRecording = false;
      updateIcon(false);
      sendResponse({ success: true });
      break;

    case 'get_state':
      sendResponse(state);
      break;

    default:
      sendResponse({ error: 'Unknown message type' });
  }

  return true; // Keep channel open for async response
});

// Update extension icon based on recording state
function updateIcon(isRecording) {
  const iconPath = isRecording ? 'assets/icon-recording' : 'assets/icon';

  chrome.action.setIcon({
    path: {
      16: `${iconPath}16.png`,
      32: `${iconPath}32.png`,
      48: `${iconPath}48.png`,
      128: `${iconPath}128.png`
    }
  }).catch(() => {
    // Icons might not exist yet
    console.log('[GHOST BG] Icon update skipped - icons not found');
  });
}

// Handle tab close - stop recording if active tab closes
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === state.activeTabId) {
    state.isRecording = false;
    state.activeTabId = null;
    updateIcon(false);
  }
});

// Service worker initialization
console.log('[GHOST BG] Service worker initialized');
