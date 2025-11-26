import { Bridge } from './bridge';

interface FeedClientOptions {
  websocketUrl?: string;
  feedId?: string;
  maxReconnectAttempts?: number;
}

interface FeedTranscriptPayload {
  feed?: string;
  text?: string;
  isFinal?: boolean;
  is_final?: boolean;
  speaker?: string | number;
  timestamp?: string | number;
  tabId?: string;
  tab_id?: string;
  type?: 'interim' | 'final' | string;
}

interface FeedStatusPayload {
  feed?: string;
  status?: string;
  message?: string;
  tabId?: string;
  tab_id?: string;
}

/**
 * FeedClient
 *
 * Lightweight websocket consumer for agent feed messages. The client listens
 * to transcript/status updates and forwards them through the Bridge so the UI
 * can render diarized interim/final lines without coupling to the audio
 * pipeline.
 */
export class FeedClient {
  private websocket: WebSocket | null = null;
  private readonly bridge: Bridge;
  private readonly tabId: string;
  private readonly websocketUrl: string;
  private readonly feedId: string;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts: number;
  private shouldReconnect = false;

  constructor(bridge: Bridge, tabId: string, options: FeedClientOptions = {}) {
    this.bridge = bridge;
    this.tabId = tabId;
    this.websocketUrl = options.websocketUrl || 'ws://localhost:3001/ws';
    this.feedId = options.feedId || 'A';
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 5;
  }

  public connect(): void {
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) return;

    this.shouldReconnect = true;

    try {
      this.websocket = new WebSocket(this.websocketUrl);
      this.websocket.onopen = () => this.handleOpen();
      this.websocket.onmessage = (event) => this.handleMessage(event.data);
      this.websocket.onerror = (error) => this.handleError(error);
      this.websocket.onclose = () => this.handleClose();
    } catch (error) {
      console.error('[FeedClient] Failed to open websocket:', error);
      this.bridge.emit('server-error', {
        error: 'ASR feed unavailable. Retrying...',
        tabId: this.tabId
      });
    }
  }

  public disconnect(): void {
    this.shouldReconnect = false;
    this.reconnectAttempts = 0;

    if (this.websocket) {
      this.websocket.onclose = null;
      this.websocket.onerror = null;
      this.websocket.onmessage = null;
      this.websocket.onopen = null;
      this.websocket.close();
      this.websocket = null;
    }
  }

  private handleOpen(): void {
    this.reconnectAttempts = 0;
    this.bridge.emit('connection', { connected: true, tabId: this.tabId });
    console.log(`[FeedClient] Connected to feed ${this.feedId}`);
  }

  private handleMessage(raw: string): void {
    try {
      const message = JSON.parse(raw);

      if (message.type === 'transcript') {
        this.handleTranscript(message.data as FeedTranscriptPayload);
        return;
      }

      if (message.type === 'status') {
        this.handleStatus(message.data as FeedStatusPayload);
        return;
      }

      if (message.type === 'error') {
        const errorMessage = message.error || message.data?.error || 'Unknown ASR error';
        this.bridge.emit('server-error', { error: errorMessage, tabId: this.tabId });
      }
    } catch (error) {
      console.error('[FeedClient] Failed to parse message:', error);
    }
  }

  private handleTranscript(data: FeedTranscriptPayload): void {
    const feed = data.feed || this.feedId;
    if (feed !== this.feedId) return;

    const messageTabId = data.tabId || data.tab_id;
    if (messageTabId && messageTabId !== this.tabId) return;

    const timestampValue = data.timestamp ?? Date.now();
    const timestamp = typeof timestampValue === 'string'
      ? Date.parse(timestampValue)
      : Number(timestampValue);

    const speaker = data.speaker ?? 'unknown';
    const isFinal = Boolean(data.isFinal ?? data.is_final ?? (data.type === 'final'));
    const status = isFinal ? 'final' : 'interim';

    this.bridge.emit('transcript', {
      id: `${timestamp}-${status}`,
      speaker: speaker.toString(),
      text: data.text || '',
      timestamp,
      isFinal,
      status,
      feed,
      tabId: this.tabId
    });
  }

  private handleStatus(data: FeedStatusPayload): void {
    const feed = data.feed || this.feedId;
    if (feed !== this.feedId) return;

    const messageTabId = data.tabId || data.tab_id;
    if (messageTabId && messageTabId !== this.tabId) return;

    if (data.status === 'error') {
      const message = data.message || 'ASR feed reported an error.';
      this.bridge.emit('server-error', { error: message, tabId: this.tabId });
    }
  }

  private handleError(error: Event): void {
    console.error('[FeedClient] WebSocket error:', error);
    this.bridge.emit('server-error', {
      error: 'ASR stream encountered an error. Attempting to reconnect.',
      tabId: this.tabId
    });
  }

  private handleClose(): void {
    this.bridge.emit('connection', { connected: false, tabId: this.tabId });

    if (!this.shouldReconnect) {
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.bridge.emit('server-error', {
        error: 'Lost connection to ASR feed after multiple attempts.',
        tabId: this.tabId
      });
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 15000);
    this.reconnectAttempts++;
    console.log(`[FeedClient] Connection closed. Reconnecting in ${delay}ms...`);

    setTimeout(() => this.connect(), delay);
  }
}
