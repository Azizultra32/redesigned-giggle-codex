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
  raw?: import('./utils/diarization.js').DeepgramWordLike[];
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
  lastSavedChunkCount: number;
  deepgram: import('./audio/deepgram-consumer.js').DeepgramConsumer;
  vad: import('./audio/vad-consumer.js').VADConsumer;
}

export type ClientState =
  | 'idle'
  | 'recording'
  | 'stopping'
  | 'error'
  | 'closed';

export interface ClientContext {
  id: string;
  ws: import('ws').WebSocket;
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
  commandName?: 'MAP_DOM' | 'SMART_FILL' | 'SEND_NOTE' | 'UNDO_LAST' | 'MAP' | 'SEND' | 'SMART_FILL' | 'UNDO' | 'DICTATE' | 'MAP_DOM';
  domSnapshot?: unknown;
  patientContext?: unknown;
  transcriptId?: number;
  sessionId?: string;
}

export type WsOutboundMessage =
  | TranscriptUpdateMessage
  | StatusMessage
  | AutopilotMessage
  | PatientMessage;

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
  state: 'connected' | 'disconnected' | 'error' | 'idle' | 'recording' | 'connecting';
  message?: string;
}

export interface AutopilotMessage {
  kind: 'autopilot';
  ready: boolean;
  surfacesFound: number;
  lastAction?: 'mapped_fields' | 'sent_note' | 'smart_fill_executed';
}

export interface PatientMessage {
  kind: 'patient';
  data: import('./utils/patient.js').PatientCard;
}
