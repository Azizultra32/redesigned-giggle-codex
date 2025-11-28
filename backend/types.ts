import type { DeepgramConsumer } from './audio/deepgram-consumer.js';
import type { VADConsumer } from './audio/vad-consumer.js';
import type WebSocket from 'ws';

export type ConsumerState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'closed';

export interface TranscriptChunk {
  speaker: number;
  text: string;
  start: number;
  end: number;
  isFinal: boolean;
}

export interface TranscriptPayload {
  finalized: TranscriptChunk[];
  interim: TranscriptChunk | null;
  fullText: string;
}

export interface TranscriptSession {
  sessionId: string;
  transcriptId: number | null;
  userId: string | null;
  patientCode: string | null;
  patientUuid: string | null;
  startedAt: number;
  stoppedAt: number | null;
  fullText: string;
  chunks: TranscriptChunk[];
  deepgram: DeepgramConsumer;
  vad: VADConsumer;
}

export type ClientState = 'idle' | 'recording' | 'stopping' | 'error' | 'closed';

export interface ClientContext {
  id: string;
  ws: WebSocket;
  state: ClientState;
  session: TranscriptSession | null;
  userId: string | null;
}

export type WsInboundMessage = AudioMessage | EventMessage;

export interface AudioMessage {
  kind: 'audio';
  sessionId?: string;
  format: 'pcm16';
  sampleRate: 16000;
  chunkId: number;
  data: string;
}

export interface EventMessage {
  kind: 'event';
  event: 'record-start' | 'record-stop' | 'command';
  commandName?: 'MAP_DOM' | 'SMART_FILL' | 'SEND_NOTE' | 'UNDO_LAST';
  domSnapshot?: unknown;
  patientContext?: unknown;
  sessionId?: string;
}

export type WsOutboundMessage =
  | TranscriptUpdateMessage
  | StatusMessage
  | AutopilotMessage;

export interface TranscriptUpdateMessage {
  kind: 'transcript-update';
  isFinal: boolean;
  speaker: number | null;
  text: string;
  chunkStart: number | null;
  chunkEnd: number | null;
}

export interface StatusMessage {
  kind: 'status';
  source: 'deepgram' | 'supabase' | 'backend' | 'vad';
  state: 'connected' | 'disconnected' | 'error' | 'idle' | 'recording';
  message?: string;
}

export interface AutopilotMessage {
  kind: 'autopilot';
  ready: boolean;
  surfacesFound: number;
  lastAction?: 'mapped_fields' | 'sent_note' | 'smart_fill_executed';
}
