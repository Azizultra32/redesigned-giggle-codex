#!/usr/bin/env node
/*
 * Minimal MCP helper script
 *
 * Connects to a remote-debuggable Chrome instance, brings the target tab
 * to the foreground, and dispatches a sample fill command into the page
 * via window.postMessage. The content script picks up the MCP payload and
 * executes the fill if the feature flag is enabled inside the extension.
 */

const CDP = require('chrome-remote-interface');

const FEATURE_FLAG = process.env.ENABLE_MCP_AUTOMATION === 'true';

if (!FEATURE_FLAG) {
  console.log('MCP automation disabled. Set ENABLE_MCP_AUTOMATION=true to run this script.');
  process.exit(0);
}

const targetUrlFilter = process.env.MCP_TARGET_URL || 'localhost';
const fillValue = process.env.MCP_SAMPLE_VALUE || 'MCP sample fill: hello from automation';
const requestId = `cli-${Date.now()}-${Math.random().toString(16).slice(2)}`;

(async () => {
  let client;

  try {
    client = await CDP();
    const { Target, Runtime, Page } = client;

    const { targetInfos } = await Target.getTargets();
    const target = targetInfos.find(
      (info) => info.type === 'page' && info.url && info.url.includes(targetUrlFilter)
    );

    if (!target) {
      console.error('No target tab matched MCP_TARGET_URL filter.');
      return;
    }

    const { sessionId } = await Target.attachToTarget({ targetId: target.targetId, flatten: true });
    await Page.bringToFront({ sessionId });
    await Runtime.enable({ sessionId });

    const expression = `
      (() => {
        window.postMessage({
          source: 'ghost-next-page',
          type: 'mcp-fill-sample',
          data: { value: ${JSON.stringify(fillValue)}, requestId: '${requestId}' }
        }, '*');
        return 'dispatched';
      })();
    `;

    const { result } = await Runtime.evaluate({
      sessionId,
      expression,
      awaitPromise: true,
      returnByValue: true
    });

    console.log('MCP fill command dispatched:', result.value);
    console.log('Target URL:', target.url);
    console.log('Request Id:', requestId);
  } catch (error) {
    console.error('Failed to dispatch MCP fill command:', error.message || error);
  } finally {
    if (client) {
      try {
        await client.close();
      } catch (closeError) {
        console.warn('Error closing CDP client:', closeError.message || closeError);
      }
    }
  }
})();
