/**
 * Background Service Worker
 *
 * Handles extension lifecycle, browser action events,
 * and coordination between content scripts and the agent.
 */

// Track connected content scripts
const connectedPorts: Map<number, chrome.runtime.Port> = new Map();
const tabMetadata: Map<number, { overlayTabId?: string; url?: string; patientHint?: unknown }> = new Map();
const mcpPendingRequests: Map<string, (result: McpFillResult) => void> = new Map();

const MCP_AUTOMATION_FLAG = 'mcpAutomationEnabled';
const MCP_TIMEOUT_MS = 5000;

type McpCommand = 'mcp:switch-tab' | 'mcp:fill-sample';

interface McpRequest {
  type: McpCommand;
  targetUrl?: string;
  tabId?: number;
  value?: string;
}

interface McpFillResult {
  success: boolean;
  message: string;
  requestId?: string;
  tabId?: string;
  targetField?: string;
}

// Listen for connections from content scripts
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'ghost-next-overlay') return;

  const tabId = port.sender?.tab?.id;
  if (!tabId) return;

  console.log(`[Background] Content script connected from tab ${tabId}`);
  connectedPorts.set(tabId, port);

  port.onMessage.addListener((message) => {
    handleContentMessage(tabId, message);
  });

  port.onDisconnect.addListener(() => {
    console.log(`[Background] Content script disconnected from tab ${tabId}`);
    connectedPorts.delete(tabId);
    tabMetadata.delete(tabId);
  });

  sendActiveState();
});

// Handle messages from content scripts
function handleContentMessage(tabId: number, message: { type: string; data?: unknown; messageId?: string }) {
  console.log(`[Background] Message from tab ${tabId}:`, message.type);

  switch (message.type) {
    case 'hello':
      tabMetadata.set(tabId, {
        overlayTabId: (message.data as any)?.tabId,
        url: (message.data as any)?.url,
        patientHint: (message.data as any)?.patientHint
      });
      sendActiveState();
      break;

    case 'recording-started':
      updateBadge(tabId, 'REC', '#e63946');
      break;

    case 'recording-stopped':
      updateBadge(tabId, '', '');
      break;

    case 'mcp-fill-result':
      resolveMcpRequest(message.data as McpFillResult | undefined);
      break;

    case 'connection':
      const connected = (message.data as { connected: boolean })?.connected;
      if (!connected) {
        updateBadge(tabId, '!', '#ff9800');
      }
      break;

    default:
      // Forward other messages as needed
      break;
  }
}

function sendActiveState(activeTabId?: number) {
  const updateWithActiveId = (targetActiveId?: number) => {
    connectedPorts.forEach((port, portTabId) => {
      const overlayTabId = tabMetadata.get(portTabId)?.overlayTabId;
      if (!overlayTabId) return;
      port.postMessage({
        type: 'active_tab_changed',
        data: { tabId: overlayTabId, isActive: targetActiveId ? portTabId === targetActiveId : false }
      });
    });
  };

  if (typeof activeTabId === 'number') {
    updateWithActiveId(activeTabId);
    return;
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    updateWithActiveId(tabs[0]?.id);
  });
}

// Update extension badge for a tab
function updateBadge(tabId: number, text: string, color: string) {
  chrome.action.setBadgeText({ text, tabId });
  if (color) {
    chrome.action.setBadgeBackgroundColor({ color, tabId });
  }
}

// Handle browser action click (toolbar icon)
chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return;

  const port = connectedPorts.get(tab.id);
  if (port) {
    // Toggle overlay visibility
    port.postMessage({ type: 'toggle-overlay' });
  } else {
    // Inject content script if not already injected
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['dist/content.js']
    }).catch(err => {
      console.error('[Background] Failed to inject content script:', err);
    });
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  sendActiveState(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.active) {
    sendActiveState(tabId);
  }
});

// Handle extension installation/update
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[Background] Extension installed/updated:', details.reason);

  if (details.reason === 'install') {
    // First-time setup
    chrome.storage.local.set({
      settings: {
        autoConnect: true,
        agentUrl: 'ws://localhost:3001/ws',
        theme: 'dark'
      }
    });
  }

  ensureMcpFlagInitialized();
});

// Handle messages from external sources (if needed)
chrome.runtime.onMessageExternal.addListener((message: McpRequest, sender, sendResponse) => {
  console.log('[Background] External message:', message);

  handleMcpRequest(message)
    .then(sendResponse)
    .catch(error => {
      console.error('[Background] MCP command failed:', error);
      sendResponse({ success: false, error: String(error) });
    });

  return true;
});

// Keep service worker alive during recording
let keepAliveInterval: ReturnType<typeof setInterval> | null = null;

function startKeepAlive() {
  if (keepAliveInterval) return;
  keepAliveInterval = setInterval(() => {
    // Ping to keep service worker alive
    console.log('[Background] Keep-alive ping');
  }, 25000);
}

function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
}

function ensureMcpFlagInitialized(): void {
  chrome.storage.local.get([MCP_AUTOMATION_FLAG], (result) => {
    if (typeof result[MCP_AUTOMATION_FLAG] === 'undefined') {
      chrome.storage.local.set({ [MCP_AUTOMATION_FLAG]: false });
    }
  });
}

async function handleMcpRequest(message?: McpRequest): Promise<Record<string, unknown>> {
  if (!message?.type) {
    return { success: false, error: 'Invalid MCP command payload.' };
  }

  const isEnabled = await isMcpEnabled();
  if (!isEnabled) {
    return { success: false, error: 'MCP automation disabled. Enable the feature flag to proceed.' };
  }

  switch (message.type) {
    case 'mcp:switch-tab':
      return activateTargetTab(message);

    case 'mcp:fill-sample':
      return triggerSampleFill(message);

    default:
      return { success: false, error: `Unsupported MCP command: ${message.type}` };
  }
}

async function activateTargetTab(message: McpRequest): Promise<Record<string, unknown>> {
  const explicitTabId = typeof message.tabId === 'number' ? message.tabId : undefined;
  let targetTab = explicitTabId ? await getTabById(explicitTabId) : undefined;

  if (!targetTab) {
    targetTab = await findTabByUrlHint(message.targetUrl);
  }

  if (!targetTab?.id) {
    return { success: false, error: 'No matching tab found for MCP switch command.' };
  }

  await activateTab(targetTab.id);
  sendActiveState(targetTab.id);

  return {
    success: true,
    tabId: targetTab.id,
    url: targetTab.url,
    message: 'Tab activated via MCP command.'
  };
}

async function triggerSampleFill(message: McpRequest): Promise<Record<string, unknown>> {
  const targetTabId = typeof message.tabId === 'number' ? message.tabId : await getActiveTabId();

  if (!targetTabId) {
    return { success: false, error: 'No active tab available for MCP fill command.' };
  }

  const fillResult = await sendMcpFillCommand(targetTabId, message.value);

  return {
    ...fillResult,
    tabId: targetTabId,
    command: message.type
  };
}

async function getActiveTabId(): Promise<number | undefined> {
  const tabs = await queryTabs({ active: true, currentWindow: true });
  return tabs[0]?.id;
}

function getTabById(tabId: number): Promise<chrome.tabs.Tab | undefined> {
  return new Promise(resolve => {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        resolve(undefined);
        return;
      }
      resolve(tab);
    });
  });
}

function findTabByUrlHint(urlHint?: string): Promise<chrome.tabs.Tab | undefined> {
  const query: chrome.tabs.QueryInfo = urlHint
    ? { url: `*${urlHint}*` }
    : { active: true, currentWindow: true };

  return queryTabs(query).then(tabs => tabs[0]);
}

function queryTabs(query: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]> {
  return new Promise(resolve => chrome.tabs.query(query, resolve));
}

function activateTab(tabId: number): Promise<chrome.tabs.Tab | undefined> {
  return new Promise(resolve => {
    chrome.tabs.update(tabId, { active: true }, (tab) => {
      if (chrome.runtime.lastError) {
        resolve(undefined);
        return;
      }
      resolve(tab);
    });
  });
}

async function sendMcpFillCommand(tabId: number, value?: string): Promise<McpFillResult> {
  const port = connectedPorts.get(tabId);

  if (!port) {
    return {
      success: false,
      message: 'Content script not connected for target tab.'
    };
  }

  const requestId = generateMcpRequestId();
  const overlayTabId = tabMetadata.get(tabId)?.overlayTabId;
  const pendingResult = waitForMcpResponse(requestId);

  port.postMessage({
    type: 'mcp-fill-sample',
    data: { value, requestId, tabId: overlayTabId }
  });

  return pendingResult;
}

function waitForMcpResponse(requestId: string): Promise<McpFillResult> {
  return new Promise(resolve => {
    const timeout = setTimeout(() => {
      mcpPendingRequests.delete(requestId);
      resolve({ success: false, message: 'Timed out waiting for MCP fill result.', requestId });
    }, MCP_TIMEOUT_MS);

    mcpPendingRequests.set(requestId, (result) => {
      clearTimeout(timeout);
      mcpPendingRequests.delete(requestId);
      resolve(result);
    });
  });
}

function resolveMcpRequest(result?: McpFillResult): void {
  if (!result?.requestId) return;

  const resolver = mcpPendingRequests.get(result.requestId);
  if (resolver) {
    resolver(result);
  }
}

function isMcpEnabled(): Promise<boolean> {
  return new Promise(resolve => {
    chrome.storage.local.get([MCP_AUTOMATION_FLAG], (data) => {
      resolve(Boolean(data[MCP_AUTOMATION_FLAG]));
    });
  });
}

function generateMcpRequestId(): string {
  return `mcp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

ensureMcpFlagInitialized();

// Export for testing
export { connectedPorts, handleContentMessage, startKeepAlive, stopKeepAlive };
