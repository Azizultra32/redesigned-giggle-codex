/**
 * WebSocket Broker
 *
 * Manages WebSocket connections between extension and backend.
 * Handles:
 * - /ws: Command/control channel (JSON messages)
 * - Audio streaming to Deepgram
 * - Transcript broadcast to extension
 */

import { WebSocket, WebSocketServer, RawData } from 'ws';
import { IncomingMessage } from 'http';
import { DeepgramConsumer, TranscriptEvent } from '../audio/deepgram-consumer.js';
import { AggregatedChunk } from '../utils/diarization.js';
import {
  createTranscriptRun,
  saveTranscriptChunks,
  updateTranscriptRun,
  updatePatientInfo,
  TranscriptChunk
} from '../supabase/queries.js';

export interface Session {
  ws: WebSocket;
  userId: string;
  transcriptId: number | null;
  deepgram: DeepgramConsumer | null;
  pendingChunks: TranscriptChunk[];
  isRecording: boolean;
  activeTabId: string | null;
  tabInfo?: TabMetadata;
}

export interface BrokerConfig {
  saveInterval: number; // ms between chunk saves
}

interface TabMetadata {
  tabId: string;
  url?: string;
  title?: string;
  patientHint?: string;
}

export class WebSocketBroker {
  private wss: WebSocketServer;
  private sessions: Map<WebSocket, Session> = new Map();
  private config: BrokerConfig;
  private saveTimers: Map<number, NodeJS.Timeout> = new Map();
  private tabRegistry: Map<string, TabMetadata & { session: Session }> = new Map();

  constructor(wss: WebSocketServer, config?: Partial<BrokerConfig>) {
    this.wss = wss;
    this.config = {
      saveInterval: 5000,
      ...config
    };

    this.wss.on('connection', this.handleConnection.bind(this));
    console.log('[Broker] WebSocket broker initialized');
  }

  private async handleConnection(ws: WebSocket, req: IncomingMessage): Promise<void> {
    const url = new URL(req.url || '', 'http://localhost');
    const userId = url.searchParams.get('userId') || 'anonymous';

    console.log(`[Broker] New connection from user: ${userId}`);

    const session: Session = {
      ws,
      userId,
      transcriptId: null,
      deepgram: null,
      pendingChunks: [],
      isRecording: false,
      activeTabId: null
    };

    this.sessions.set(ws, session);

    ws.on('message', (data) => this.handleMessage(ws, data));
    ws.on('close', () => this.handleClose(ws));
    ws.on('error', (error) => this.handleError(ws, error));

    this.send(ws, { type: 'connected', userId });
  }

  private async handleMessage(ws: WebSocket, data: RawData): Promise<void> {
    const session = this.sessions.get(ws);
    if (!session) return;

    // Binary data = audio
    if (Buffer.isBuffer(data)) {
      if (session.deepgram && session.isRecording) {
        session.deepgram.sendAudio(data);
      }
      return;
    }

    // JSON message
    try {
      const message = JSON.parse(data.toString());
      await this.handleCommand(session, message);
    } catch (error) {
      console.error('[Broker] Failed to parse message:', error);
      this.send(ws, { type: 'error', error: 'Invalid message format' });
    }
  }

  private async handleCommand(session: Session, message: any): Promise<void> {
    const { ws } = session;

    switch (message.type) {
      case 'hello':
        this.registerTab(session, message);
        break;

      case 'bind_audio':
        await this.bindAudio(session, message);
        break;

      case 'start_recording':
        await this.startRecording(session, message);
        break;

      case 'stop_recording':
        await this.stopRecording(session);
        break;

      case 'set_patient':
        await this.setPatient(session, message);
        break;

      case 'ping':
        this.send(ws, { type: 'pong', timestamp: Date.now() });
        break;

      default:
        console.warn(`[Broker] Unknown command: ${message.type}`);
    }
  }

  private registerTab(session: Session, message: any): void {
    const tabId = message.tabId ?? message.tabID ?? message.tab_id;

    if (!tabId) {
      this.send(session.ws, { type: 'error', error: 'tabId is required for hello' });
      return;
    }

    const tabKey = String(tabId);
    const tabInfo: TabMetadata = {
      tabId: tabKey,
      url: message.url,
      title: message.title,
      patientHint: message.patientHint
    };

    session.tabInfo = tabInfo;
    this.tabRegistry.set(tabKey, { ...tabInfo, session });

    console.log(`[Broker] Registered tab ${tabKey} for user ${session.userId}`);
    this.send(session.ws, { type: 'hello_ack', tabId: tabKey });
  }

  private async bindAudio(session: Session, message: any): Promise<void> {
    const tabId = this.getTabIdFromMessage(message, session);

    if (!tabId) {
      this.send(session.ws, { type: 'error', error: 'tabId is required for bind_audio' });
      return;
    }

    await this.startRecordingForTab(session, message, tabId);
  }

  private getTabIdFromMessage(message: any, session: Session): string | null {
    const tabId = message.tabId ?? session.tabInfo?.tabId;
    return tabId ? String(tabId) : null;
  }

  private async startRecording(session: Session, message: any): Promise<void> {
    await this.startRecordingForTab(session, message, this.getTabIdFromMessage(message, session));
  }

  private async startRecordingForTab(
    session: Session,
    message: any,
    tabId: string | null
  ): Promise<void> {
    const { ws, userId } = session;

    if (session.isRecording) {
      this.send(ws, { type: 'error', error: 'Already recording' });
      return;
    }

    try {
      session.activeTabId = tabId;

      const transcriptId = await createTranscriptRun(
        userId,
        message.patientCode,
        message.patientUuid
      );
      session.transcriptId = transcriptId;

      session.deepgram = new DeepgramConsumer({
        onTranscript: (event) => this.handleTranscript(session, event),
        onChunk: (chunk) => this.handleChunk(session, chunk),
        onError: (error) =>
          this.send(ws, { type: 'error', error: error.message, tabId: session.activeTabId || tabId }),
        onClose: () => this.send(ws, { type: 'deepgram_closed', tabId: session.activeTabId || tabId })
      });

      await session.deepgram.connect();
      session.isRecording = true;

      this.startSaveTimer(session);

      this.send(ws, {
        type: 'recording_started',
        transcriptId,
        tabId: session.activeTabId || tabId || undefined
      });

      console.log(
        `[Broker] Recording started${session.activeTabId ? ` for tab ${session.activeTabId}` : ''}: transcript ${transcriptId}`
      );
    } catch (error: any) {
      console.error('[Broker] Failed to start recording:', error);
      this.send(ws, { type: 'error', error: error.message, tabId: session.activeTabId || tabId });
      session.activeTabId = null;
    }
  }

  private async stopRecording(session: Session): Promise<void> {
    const { ws, transcriptId, deepgram } = session;

    if (!session.isRecording) {
      this.send(ws, { type: 'error', error: 'Not recording' });
      return;
    }

    try {
      // Stop Deepgram
      if (deepgram) {
        deepgram.disconnect();
        session.deepgram = null;
      }

      session.isRecording = false;

      // Stop save timer
      if (transcriptId) {
        this.stopSaveTimer(transcriptId);
      }

      // Final save of pending chunks
      await this.savePendingChunks(session);

      // Mark transcript complete
      if (transcriptId) {
        await updateTranscriptRun(transcriptId);
      }

      this.send(ws, {
        type: 'recording_stopped',
        transcriptId,
        tabId: session.activeTabId || undefined
      });

      console.log(`[Broker] Recording stopped: transcript ${transcriptId}`);
    } catch (error: any) {
      console.error('[Broker] Failed to stop recording:', error);
      this.send(ws, { type: 'error', error: error.message });
    }

    session.activeTabId = null;
  }

  private async setPatient(session: Session, message: any): Promise<void> {
    const { ws, transcriptId } = session;

    if (!transcriptId) {
      this.send(ws, { type: 'error', error: 'No active transcript' });
      return;
    }

    try {
      await updatePatientInfo(transcriptId, message.patientCode, message.patientUuid);
      this.send(ws, { type: 'patient_set', patientCode: message.patientCode });
    } catch (error: any) {
      this.send(ws, { type: 'error', error: error.message });
    }
  }

  private handleTranscript(session: Session, event: TranscriptEvent): void {
    // Send to extension for display
    this.send(session.ws, {
      type: 'transcript',
      text: event.text,
      speaker: event.speaker,
      isFinal: event.isFinal,
      start: event.start,
      end: event.end,
      tabId: session.activeTabId || undefined
    });
  }

  private handleChunk(session: Session, chunk: AggregatedChunk): void {
    // Queue chunk for batch save
    session.pendingChunks.push(chunk as TranscriptChunk);

    // Send chunk event to extension
    this.send(session.ws, {
      type: 'chunk',
      speaker: chunk.speaker,
      text: chunk.text,
      wordCount: chunk.word_count,
      duration: chunk.end - chunk.start,
      tabId: session.activeTabId || undefined
    });
  }

  private startSaveTimer(session: Session): void {
    if (!session.transcriptId) return;

    const timer = setInterval(async () => {
      await this.savePendingChunks(session);
    }, this.config.saveInterval);

    this.saveTimers.set(session.transcriptId, timer);
  }

  private stopSaveTimer(transcriptId: number): void {
    const timer = this.saveTimers.get(transcriptId);
    if (timer) {
      clearInterval(timer);
      this.saveTimers.delete(transcriptId);
    }
  }

  private async savePendingChunks(session: Session): Promise<void> {
    if (!session.transcriptId || session.pendingChunks.length === 0) return;

    const chunks = [...session.pendingChunks];
    session.pendingChunks = [];

    try {
      await saveTranscriptChunks(session.transcriptId, chunks);
    } catch (error) {
      // Re-queue chunks on failure
      session.pendingChunks.unshift(...chunks);
      console.error('[Broker] Failed to save chunks, will retry:', error);
    }
  }

  private handleClose(ws: WebSocket): void {
    const session = this.sessions.get(ws);
    if (session) {
      console.log(`[Broker] Connection closed: ${session.userId}`);
      if (session.deepgram) {
        session.deepgram.disconnect();
      }
      if (session.transcriptId) {
        this.stopSaveTimer(session.transcriptId);
        this.savePendingChunks(session);
      }
      if (session.tabInfo?.tabId) {
        this.tabRegistry.delete(session.tabInfo.tabId);
      }
      this.sessions.delete(ws);
    }
  }

  private handleError(ws: WebSocket, error: Error): void {
    console.error('[Broker] WebSocket error:', error);
    const session = this.sessions.get(ws);
    if (session) {
      this.send(ws, { type: 'error', error: error.message });
    }
  }

  private send(ws: WebSocket, message: object): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Broadcast to all connected clients
   */
  broadcast(message: object): void {
    const data = JSON.stringify(message);
    for (const [ws] of this.sessions) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  }

  /**
   * Get active session count
   */
  getSessionCount(): number {
    return this.sessions.size;
  }
}
