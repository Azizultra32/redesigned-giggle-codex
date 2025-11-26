/**
 * WsBridge - Central WebSocket multiplexer for Feed A-E
 * 
 * Feeds:
 * - Feed A: Deepgram Transcription (connected/disconnected/ready)
 * - Feed B: Voice Concierge (command recognition)
 * - Feed C: Emergency Monitor (alert keywords)
 * - Feed D: Patient Summary (AI summarization)
 * - Feed E: Compliance Audit (documentation gaps)
 */

import { WebSocket } from 'ws';
import {
  FeedId,
  FeedStatus,
  FeedInfo,
  StatusMessage,
  TranscriptMessage,
  AlertMessage,
  CommandMessage,
  CommandPayload,
  WsMessage
} from '../types/index.js';

interface ClientMetadata {
  tabId?: string;
  userId?: string;
}

interface ActiveTabChangedMessage {
  type: 'active_tab_changed';
  data: {
    tabId: string | null;
    isActive: boolean;
    userId?: string;
  };
}

interface FeedState {
  feed: FeedId;
  label: string;
  status: FeedStatus;
}

export class WsBridge {
  private clients: Map<WebSocket, ClientMetadata> = new Map();
  private feedStates: Map<FeedId, FeedState> = new Map();

  constructor() {
    // Initialize feed states
    this.feedStates.set('A', { feed: 'A', label: 'Deepgram Transcription', status: 'disconnected' });
    this.feedStates.set('B', { feed: 'B', label: 'Voice Concierge', status: 'ready' });
    this.feedStates.set('C', { feed: 'C', label: 'Emergency Monitor', status: 'ready' });
    this.feedStates.set('D', { feed: 'D', label: 'Patient Summary', status: 'connected' });
    this.feedStates.set('E', { feed: 'E', label: 'Compliance Audit', status: 'connected' });

    console.log('[WsBridge] Initialized with 5 feeds (A-E)');
  }

  /**
   * Add a new WebSocket client and hydrate with current state
   */
  addClient(ws: WebSocket, metadata: ClientMetadata = {}): void {
    this.clients.set(ws, metadata);
    console.log(`[WsBridge] Client added, total: ${this.clients.size}`);

    // Hydrate client with current feed states
    this.hydrateClient(ws);

    // Handle client disconnect
    ws.on('close', () => {
      this.clients.delete(ws);
      console.log(`[WsBridge] Client removed, total: ${this.clients.size}`);
    });
  }

  /**
   * Update client metadata (tab/user association)
   */
  updateClientMetadata(ws: WebSocket, metadata: ClientMetadata): void {
    const existing = this.clients.get(ws) || {};
    this.clients.set(ws, { ...existing, ...metadata });
  }

  /**
   * Hydrate a newly connected client with all feed states
   */
  private hydrateClient(ws: WebSocket): void {
    for (const [feedId, state] of this.feedStates) {
      const message: StatusMessage = {
        type: 'status',
        data: {
          feed: state.feed,
          label: state.label,
          status: state.status,
          timestamp: new Date().toISOString()
        }
      };
      this.sendToClient(ws, message);
    }
    console.log('[WsBridge] Client hydrated with all feed states');
  }

  /**
   * Update feed status and broadcast to all clients
   */
  updateFeedStatus(feedId: FeedId, status: FeedStatus, tabId?: string): void {
    const state = this.feedStates.get(feedId);
    if (!state) {
      console.warn(`[WsBridge] Unknown feed: ${feedId}`);
      return;
    }

    state.status = status;
    this.feedStates.set(feedId, state);

    const message: StatusMessage = {
      type: 'status',
      data: {
        feed: state.feed,
        label: state.label,
        status: state.status,
        timestamp: new Date().toISOString(),
        tabId
      }
    };

    this.broadcast(message);
    console.log(`[WsBridge] Feed ${feedId} (${state.label}) status: ${status}`);
  }

  /**
   * Broadcast a transcript event (Feed A)
   */
  broadcastTranscript(
    text: string,
    isFinal: boolean,
    confidence: number,
    speaker: number,
    tabId?: string
  ): void {
    const message: TranscriptMessage = {
      type: 'transcript',
      data: {
        feed: 'A',
        text,
        isFinal,
        confidence,
        speaker,
        tabId,
        timestamp: new Date().toISOString()
      }
    };
    this.broadcast(message, { tabId });
  }

  /**
   * Broadcast active tab changes per user
   */
  broadcastActiveTabChange(tabId: string | null, userId: string): void {
    const message: ActiveTabChangedMessage = {
      type: 'active_tab_changed',
      data: {
        tabId,
        isActive: false,
        userId
      }
    };

    for (const [client, metadata] of this.clients.entries()) {
      if (client.readyState !== WebSocket.OPEN) continue;
      if (metadata.userId !== userId) continue;

      const isActive = metadata.tabId !== undefined && metadata.tabId === tabId;
      this.sendToClient(client, {
        ...message,
        data: { ...message.data, isActive }
      });
    }
  }

  /**
   * Broadcast an alert (Feed C or E)
   */
  broadcastAlert(
    feedId: FeedId,
    severity: 'critical' | 'warning' | 'info',
    message: string,
    keywords?: string[]
  ): void {
    const alertMessage: AlertMessage = {
      type: 'alert',
      data: {
        feed: feedId,
        severity,
        message,
        keywords,
        timestamp: new Date().toISOString()
      }
    };
    this.broadcast(alertMessage);
  }

  /**
   * Broadcast a command (Feed B)
   */
  broadcastCommand(
    command: 'trigger_map' | 'smart_fill' | 'undo_fill' | 'dictate',
    payload?: CommandPayload
  ): void {
    const message: CommandMessage = {
      type: 'command',
      data: {
        feed: 'B',
        command,
        payload,
        timestamp: new Date().toISOString()
      }
    };
    this.broadcast(message);
  }

  /**
   * Broadcast a message to all connected clients
   */
  private broadcast(message: WsMessage | ActiveTabChangedMessage, filter?: ClientMetadata): void {
    const data = JSON.stringify(message);
    for (const [client, metadata] of this.clients.entries()) {
      if (client.readyState !== WebSocket.OPEN) continue;

      if (filter?.userId && metadata.userId !== filter.userId) continue;
      if (filter?.tabId && metadata.tabId !== filter.tabId) continue;

      client.send(data);
    }
  }

  /**
   * Send a message to a specific client
   */
  private sendToClient(ws: WebSocket, message: WsMessage | ActiveTabChangedMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Get current feed status
   */
  getFeedStatus(feedId: FeedId): FeedStatus | undefined {
    return this.feedStates.get(feedId)?.status;
  }

  /**
   * Get number of connected clients
   */
  getClientCount(): number {
    return this.clients.size;
  }
}
