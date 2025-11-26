import { Bridge } from './bridge';
import { DOMMapper, DomMap } from './domMapper';
import { FillExecutor, FillResult, FillStep } from './fillExecutor';

interface DomMapMessage {
  type: 'dom_map';
  tabId: string;
  domMap: DomMap;
}

interface FillStepMessage {
  type: 'fill_steps';
  steps: FillStep[];
  requestId?: string;
  tabId?: string;
}

const DEFAULT_WEBSOCKET_URL = 'ws://localhost:3001/ws';

/**
 * DomMapClient
 *
 * Keeps a lightweight WebSocket connection to send DOM maps to the backend
 * and apply returned fill steps safely on the page.
 */
export class DomMapClient {
  private websocket: WebSocket | null = null;
  private bridge: Bridge;
  private domMapper: DOMMapper;
  private tabId: string;
  private fillExecutor: FillExecutor;
  private websocketUrl: string;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(bridge: Bridge, domMapper: DOMMapper, tabId: string, websocketUrl?: string) {
    this.bridge = bridge;
    this.domMapper = domMapper;
    this.tabId = tabId;
    this.websocketUrl = websocketUrl || DEFAULT_WEBSOCKET_URL;
    this.fillExecutor = new FillExecutor();

    this.connect();
  }

  public async sendDomMap(): Promise<DomMap | null> {
    const domMap = this.domMapper.buildDomMap();

    if (!domMap) {
      console.warn('[DomMapClient] No DOM map available to send');
      return null;
    }

    await this.ensureConnection();

    const message: DomMapMessage = { type: 'dom_map', domMap, tabId: this.tabId };
    this.websocket?.send(JSON.stringify(message));
    this.bridge.emit('dom-map', { tabId: this.tabId, domMap });

    return domMap;
  }

  public undoLastFill(): FillResult {
    const result = this.fillExecutor.undoLast();
    this.bridge.emit('fill-undo', { tabId: this.tabId, result });
    return result;
  }

  private async ensureConnection(): Promise<void> {
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) return;

    if (!this.websocket || this.websocket.readyState === WebSocket.CLOSED) {
      this.connect();
    }

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('WebSocket connection timeout')), 5000);
      const checkInterval = setInterval(() => {
        if (this.websocket?.readyState === WebSocket.OPEN) {
          clearTimeout(timeout);
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
    });
  }

  private connect(): void {
    try {
      this.websocket = new WebSocket(this.websocketUrl);
      this.websocket.onopen = () => {
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        this.bridge.emit('connection', { connected: true, tabId: this.tabId });
      };

      this.websocket.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      this.websocket.onerror = (error) => {
        console.error('[DomMapClient] WebSocket error', error);
        this.bridge.emit('server-error', { error: 'DomMap websocket error', tabId: this.tabId });
      };

      this.websocket.onclose = () => {
        this.bridge.emit('connection', { connected: false, tabId: this.tabId });
        this.scheduleReconnect();
      };
    } catch (error) {
      console.error('[DomMapClient] Failed to open WebSocket', error);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, 1500);
  }

  private handleMessage(raw: string): void {
    let message: FillStepMessage;
    try {
      message = JSON.parse(raw);
    } catch (error) {
      console.error('[DomMapClient] Failed to parse message', error);
      return;
    }

    if (message.type !== 'fill_steps') return;
    if (message.tabId && message.tabId !== this.tabId) return;

    const result = this.fillExecutor.apply(message.steps || []);
    this.bridge.emit('fill-steps', { tabId: this.tabId, steps: message.steps, result });
  }
}
