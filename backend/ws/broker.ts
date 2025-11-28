import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import {
  AutopilotMessage,
  ClientContext,
  ConsumerState,
  StatusMessage,
  TranscriptPayload,
  TranscriptSession,
  WsInboundMessage,
  WsOutboundMessage
} from '../types.js';
import { DeepgramConsumer } from '../audio/deepgram-consumer.js';
import { VADConsumer, mapVadStateToConsumer } from '../audio/vad-consumer.js';
import {
  createTranscriptRun,
  saveTranscriptChunks,
  updatePatientLink
} from '../supabase/transcripts.js';
import { analyzeDomSnapshot } from '../utils/dom.js';
import { getPatientCardForUser } from '../utils/patient.js';

export interface BrokerOptions {
  deepgramApiKey: string;
}

export function attachBroker(wss: WebSocketServer, options: BrokerOptions): void {
  wss.on('connection', async (ws) => {
    const context: ClientContext = {
      id: randomUUID(),
      ws,
      state: 'idle',
      session: null,
      userId: null
    };

    await sendPatientCard(context);
    sendStatus(context, { source: 'backend', state: 'idle', message: 'connected' });

    ws.on('message', (raw) => handleMessage(context, raw, options));
    ws.on('close', () => handleClose(context));
    ws.on('error', (err) => {
      console.error('[WS] error', err);
      context.state = 'error';
    });
  });
}

type StatusUpdate = Omit<StatusMessage, 'kind'>;

async function handleMessage(
  context: ClientContext,
  raw: WebSocket.RawData,
  options: BrokerOptions
): Promise<void> {
  let msg: WsInboundMessage;
  try {
    msg = JSON.parse(raw.toString());
  } catch (err) {
    console.error('[WS] invalid JSON', err);
    sendStatus(context, {
      source: 'backend',
      state: 'error',
      message: 'invalid JSON'
    });
    return;
  }

  if (msg.kind === 'audio') {
    await handleAudioMessage(context, msg);
    return;
  }

  if (msg.kind === 'event') {
    await handleEventMessage(context, msg, options);
    return;
  }

  sendStatus(context, { source: 'backend', state: 'error', message: 'UNKNOWN_KIND' });
}

async function handleEventMessage(
  context: ClientContext,
  msg: WsInboundMessage & { kind: 'event' },
  options: BrokerOptions
): Promise<void> {
  switch (msg.event) {
    case 'record-start':
      await startSession(context, msg, options);
      break;
    case 'record-stop':
      await stopSession(context);
      break;
    case 'command':
      await handleCommand(context, msg);
      break;
    default:
      sendStatus(context, { source: 'backend', state: 'error', message: 'UNKNOWN_EVENT' });
  }
}

async function startSession(context: ClientContext, msg: any, options: BrokerOptions): Promise<void> {
  if (context.session) {
    sendStatus(context, { source: 'backend', state: 'error', message: 'already recording' });
    return;
  }

  const sessionId = msg.sessionId ?? randomUUID();

  let transcriptId: number | null = null;
  let patientCode: string | null = null;

  try {
    const result = await createTranscriptRun({
      userId: context.userId,
      patientCode: msg.patientContext?.patientCode ?? null,
      patientUuid: msg.patientContext?.patientUuid ?? null,
      language: msg.patientContext?.language ?? null
    });
    transcriptId = result.id;
    patientCode = result.patientCode;
  } catch (err) {
    console.error('[Broker] failed to create transcript run', err);
    sendStatus(context, { source: 'supabase', state: 'error', message: 'failed to create transcript' });
    return;
  }

  const deepgram = new DeepgramConsumer({
    apiKey: options.deepgramApiKey,
    onTranscript: (payload) => handleTranscriptPayload(context, payload),
    onStatus: (state, message) => sendStatus(context, mapConsumerStatus('deepgram', state, message)),
    onError: (err) => sendStatus(context, { source: 'deepgram', state: 'error', message: err.message })
  });

  const vad = new VADConsumer();
  vad.start({
    status: (state) => sendStatus(context, mapConsumerStatus('vad', mapVadStateToConsumer(state)))
  });

  const session: TranscriptSession = {
    sessionId,
    transcriptId,
    userId: context.userId,
    patientCode,
    patientUuid: msg.patientContext?.patientUuid ?? null,
    startedAt: Date.now(),
    stoppedAt: null,
    fullText: '',
    chunks: [],
    lastSavedChunkCount: 0,
    deepgram,
    vad
  };

  context.session = session;
  context.state = 'recording';

  try {
    await deepgram.start();
  } catch (err) {
    console.error('[Broker] failed to start deepgram', err);
    sendStatus(context, { source: 'deepgram', state: 'error', message: (err as Error).message });
  }
}

async function stopSession(context: ClientContext): Promise<void> {
  if (!context.session) return;

  const session = context.session;
  context.state = 'stopping';

  session.deepgram.stop();
  session.vad.stop();
  session.stoppedAt = Date.now();

  await persistChunks(context, true);

  context.session = null;
  context.state = 'idle';
  sendStatus(context, { source: 'backend', state: 'idle', message: 'stopped' });
}

async function handleAudioMessage(context: ClientContext, msg: any): Promise<void> {
  if (msg.format !== 'pcm16' || msg.sampleRate !== 16000 || !msg.data) {
    sendStatus(context, { source: 'backend', state: 'error', message: 'invalid audio format' });
    return;
  }

  if (!context.session || context.state !== 'recording') {
    sendStatus(context, { source: 'backend', state: 'error', message: 'not recording' });
    return;
  }

  const buffer = Buffer.from(msg.data, 'base64');
  context.session.deepgram.handleAudio(buffer);
  context.session.vad.handleAudio(buffer);
}

async function handleTranscriptPayload(context: ClientContext, payload: TranscriptPayload): Promise<void> {
  const session = context.session;
  if (!session) return;

  session.fullText = payload.fullText;
  session.chunks = payload.finalized;

  await emitTranscriptUpdates(context, payload);
  await persistChunks(context, false);
}

async function persistChunks(context: ClientContext, completed: boolean): Promise<void> {
  const session = context.session;
  if (!session || session.transcriptId === null) return;

  const finalized = session.chunks;
  if (finalized.length === 0) return;

  if (session.lastSavedChunkCount === finalized.length && !completed) return;

  try {
    await saveTranscriptChunks(session.transcriptId, finalized, {
      fullTranscript: session.fullText,
      completed
    });
    session.lastSavedChunkCount = finalized.length;
    if (completed) {
      sendStatus(context, { source: 'supabase', state: 'connected', message: 'transcript saved' });
    }
  } catch (err) {
    console.error('[Broker] failed to persist chunks', err);
    sendStatus(context, { source: 'supabase', state: 'error', message: 'failed to save transcript' });
  }
}

async function emitTranscriptUpdates(context: ClientContext, payload: TranscriptPayload): Promise<void> {
  const session = context.session;
  if (!session) return;

  const newFinalized = payload.finalized.slice(session.lastSavedChunkCount);
  for (const chunk of newFinalized) {
    send(context, {
      kind: 'transcript-update',
      isFinal: true,
      speaker: chunk.speaker,
      text: chunk.text,
      chunkStart: chunk.start,
      chunkEnd: chunk.end
    });
  }

  if (payload.interim) {
    send(context, {
      kind: 'transcript-update',
      isFinal: false,
      speaker: payload.interim.speaker,
      text: payload.interim.text,
      chunkStart: payload.interim.start,
      chunkEnd: payload.interim.end
    });
  }
}

async function handleCommand(context: ClientContext, msg: any): Promise<void> {
  if (msg.commandName === 'MAP_DOM') {
    const result = analyzeDomSnapshot(msg.domSnapshot);
    if (context.session?.transcriptId) {
      await updatePatientLink(context.session.transcriptId, {
        patientCode: result.patientCode ?? undefined,
        patientUuid: result.patientUuid ?? undefined
      });
    }

    const autopilot: AutopilotMessage = {
      kind: 'autopilot',
      ready: true,
      surfacesFound: result.surfacesFound,
      lastAction: 'mapped_fields'
    };
    send(context, autopilot);
  }
}

function handleClose(context: ClientContext): void {
  if (context.session) {
    context.session.deepgram.stop();
    context.session.vad.stop();
  }
  context.state = 'closed';
}

function send(context: ClientContext, msg: WsOutboundMessage): void {
  if (context.ws.readyState !== WebSocket.OPEN) return;
  try {
    context.ws.send(JSON.stringify(msg));
  } catch (err) {
    console.error('[WS] send error', err);
    context.state = 'error';
  }
}

function sendStatus(context: ClientContext, msg: StatusUpdate): void {
  send(context, { ...msg, kind: 'status' });
}

function mapConsumerStatus(source: StatusMessage['source'], state: ConsumerState, message?: string): StatusUpdate {
  const mappedState: StatusMessage['state'] =
    state === 'closed' ? 'disconnected' : state === 'connecting' ? 'connecting' : state === 'idle' ? 'idle' : state === 'error' ? 'error' : 'connected';

  return { source, state: mappedState, message };
}

async function sendPatientCard(context: ClientContext): Promise<void> {
  const card = await getPatientCardForUser(context.userId);
  send(context, { kind: 'patient', data: card });
}
