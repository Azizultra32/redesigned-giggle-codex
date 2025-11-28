import { WebSocketServer, WebSocket, RawData } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { DeepgramConsumer } from '../audio/deepgram-consumer.js';
import { VADConsumer } from '../audio/vad-consumer.js';
import {
  AudioMessage,
  AutopilotMessage,
  ClientContext,
  ConsumerState,
  EventMessage,
  StatusMessage,
  TranscriptUpdateMessage,
  WsInboundMessage,
  WsOutboundMessage,
} from '../types.js';
import {
  createTranscriptRun,
  saveTranscriptChunks,
  updatePatientLink,
} from '../supabase/transcripts.js';
import { analyzeDomSnapshot } from '../utils/dom.js';

export interface BrokerOptions {
  deepgramApiKey: string;
}

export function attachBroker(wss: WebSocketServer, options: BrokerOptions): void {
  wss.on('connection', (ws) => {
    const context: ClientContext = {
      id: uuidv4(),
      ws,
      state: 'idle',
      session: null,
      userId: null,
    };

    ws.on('message', (raw) => handleMessage(context, raw, options));
    ws.on('close', () => handleClose(context));
    ws.on('error', () => handleError(context));
  });
}

function handleMessage(context: ClientContext, raw: RawData, options: BrokerOptions): void {
  let msg: WsInboundMessage;
  try {
    const payload = Buffer.isBuffer(raw)
      ? raw
      : raw instanceof ArrayBuffer
        ? Buffer.from(new Uint8Array(raw))
        : Buffer.from(raw as any);
    msg = JSON.parse(payload.toString());
  } catch {
    sendStatus(context, { kind: 'status', source: 'backend', state: 'error', message: 'INVALID_JSON' });
    return;
  }

  if (msg.kind === 'audio') {
    handleAudioMessage(context, msg);
  } else if (msg.kind === 'event') {
    void handleEventMessage(context, msg, options);
  } else {
    sendStatus(context, { kind: 'status', source: 'backend', state: 'error', message: 'UNKNOWN_KIND' });
  }
}

async function handleEventMessage(context: ClientContext, msg: EventMessage, options: BrokerOptions): Promise<void> {
  if (msg.event === 'record-start') {
    if (context.state === 'recording') return;
    const sessionId = uuidv4();
    const { id: transcriptId, patientCode } = await createTranscriptRun({
      userId: context.userId,
      patientCode: (msg.patientContext as any)?.patientCode ?? null,
      patientUuid: (msg.patientContext as any)?.patientUuid ?? null,
    });

    const deepgram = new DeepgramConsumer(
      { apiKey: options.deepgramApiKey },
      {
        onTranscript: (payload) => {
          if (!context.session) return;
          context.session.chunks = payload.interim
            ? payload.finalized.concat({ ...payload.interim })
            : payload.finalized;
          context.session.fullText = payload.fullText;
          if (context.session.transcriptId) {
            void saveTranscriptChunks(context.session.transcriptId, context.session.chunks, {
              fullTranscript: payload.fullText,
            }).catch((err) => sendStatus(context, { kind: 'status', source: 'supabase', state: 'error', message: String(err) }));
          }

          const lastChunk = payload.interim ?? payload.finalized[payload.finalized.length - 1];
          if (lastChunk) {
            sendTranscript(context, {
              kind: 'transcript-update',
              isFinal: lastChunk.isFinal,
              speaker: lastChunk.speaker,
              text: lastChunk.text,
              chunkStart: lastChunk.start,
              chunkEnd: lastChunk.end,
            });
          }
        },
        onStatus: (state: ConsumerState, message?: string) =>
          sendStatus(context, { kind: 'status', source: 'deepgram', state: mapConsumerState(state), message }),
        onError: (err) => sendStatus(context, { kind: 'status', source: 'deepgram', state: 'error', message: err.message }),
      },
    );

    const vad = new VADConsumer();
    vad.start({ status: (state) => sendStatus(context, { kind: 'status', source: 'vad', state: mapVadState(state) }) });

    context.session = {
      sessionId,
      transcriptId,
      userId: context.userId,
      patientCode,
      patientUuid: (msg.patientContext as any)?.patientUuid ?? null,
      startedAt: Date.now(),
      stoppedAt: null,
      chunks: [],
      fullText: '',
      deepgram,
      vad,
    };

    context.state = 'recording';
    await deepgram.start();
    sendStatus(context, { kind: 'status', source: 'backend', state: 'recording' });
  } else if (msg.event === 'record-stop') {
    if (!context.session) return;
    context.session.deepgram.stop();
    context.session.vad.stop();
    context.session.stoppedAt = Date.now();
    if (context.session.transcriptId) {
      await saveTranscriptChunks(context.session.transcriptId, context.session.chunks, {
        fullTranscript: context.session.fullText,
        completed: true,
      }).catch((err) => sendStatus(context, { kind: 'status', source: 'supabase', state: 'error', message: String(err) }));
    }
    context.state = 'idle';
    context.session = null;
    sendStatus(context, { kind: 'status', source: 'backend', state: 'idle' });
  } else if (msg.event === 'command') {
    if (msg.commandName === 'MAP_DOM' && context.session?.transcriptId) {
      const result = analyzeDomSnapshot(msg.domSnapshot as any);
      await updatePatientLink(context.session.transcriptId, {
        patientUuid: result.patientUuid,
        patientCode: result.patientCode ?? context.session.patientCode,
      }).catch((err) => sendStatus(context, { kind: 'status', source: 'supabase', state: 'error', message: String(err) }));
      sendAutopilot(context, {
        kind: 'autopilot',
        ready: true,
        surfacesFound: result.surfacesFound,
        lastAction: 'mapped_fields',
      });
    } else {
      sendAutopilot(context, { kind: 'autopilot', ready: false, surfacesFound: 0 });
    }
  }
}

function handleAudioMessage(context: ClientContext, msg: AudioMessage): void {
  if (msg.format !== 'pcm16' || msg.sampleRate !== 16000 || !msg.data) {
    sendStatus(context, { kind: 'status', source: 'backend', state: 'error', message: 'INVALID_AUDIO' });
    return;
  }

  if (context.state !== 'recording' || !context.session) {
    return;
  }

  const buffer = Buffer.from(msg.data, 'base64');
  context.session.deepgram.handleAudio(buffer);
  context.session.vad.handleAudio(buffer);
}

function handleClose(context: ClientContext): void {
  if (context.session) {
    context.session.deepgram.stop();
    context.session.vad.stop();
  }
  context.state = 'closed';
}

function handleError(context: ClientContext): void {
  context.state = 'error';
  sendStatus(context, { kind: 'status', source: 'backend', state: 'error', message: 'WS_ERROR' });
}

function send(context: ClientContext, msg: WsOutboundMessage): void {
  if (context.ws.readyState !== WebSocket.OPEN) return;
  try {
    context.ws.send(JSON.stringify(msg));
  } catch {
    // ignore
  }
}

function sendStatus(context: ClientContext, status: StatusMessage): void {
  send(context, status);
}

function sendTranscript(context: ClientContext, msg: TranscriptUpdateMessage): void {
  send(context, msg);
}

function sendAutopilot(context: ClientContext, msg: AutopilotMessage): void {
  send(context, msg);
}

function mapConsumerState(state: ConsumerState): StatusMessage['state'] {
  switch (state) {
    case 'connected':
      return 'connected';
    case 'connecting':
      return 'recording';
    case 'error':
      return 'error';
    case 'closed':
      return 'disconnected';
    default:
      return 'idle';
  }
}

function mapVadState(state: any): StatusMessage['state'] {
  if (state === 'running') return 'recording';
  if (state === 'stopped') return 'disconnected';
  if (state === 'error') return 'error';
  return 'idle';
}
