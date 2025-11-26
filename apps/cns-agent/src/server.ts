/**
 * AssistMD Truth Package - CNS Agent Server
 * 
 * Express server with WebSocket support for:
 * - /ws: WebSocket with Feed A-E model
 * - /health: Health check
 * - /dom: DOM recognition for patient binding
 * - /patient/current: Get latest transcript for user
 * - /transcripts/:id: Get specific transcript
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { config } from 'dotenv';
import { WsBridge } from './lib/ws-bridge.js';
import { DeepgramConsumer } from './audio/deepgram-consumer.js';
import {
  createTranscriptRun,
  saveTranscriptChunks,
  completeTranscriptRun,
  updatePatientInfo,
  getTranscript,
  getLatestTranscript,
  generateEphemeralPatientCode,
  getTranscriptsByPatientCode,
  isSupabaseOffline
} from './lib/supabase.js';
import { TranscriptChunk, TranscriptEvent, DomMap, TranscriptRun } from './types/index.js';

// Load environment variables
config();

const app = express();
const PORT = process.env.PORT || 3001;
const DEMO_DOCTOR_ID = process.env.DEMO_DOCTOR_ID || '00000000-0000-0000-0000-000000000000';

// Middleware
app.use(cors({
  origin: '*', // Allow all origins for development
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true
}));
app.use(express.json());

// ============================================================================
// HTTP Endpoints
// ============================================================================

/**
 * Health check
 */
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    service: 'cns-agent',
    feeds: {
      A: wsBridge.getFeedStatus('A'),
      B: wsBridge.getFeedStatus('B'),
      C: wsBridge.getFeedStatus('C'),
      D: wsBridge.getFeedStatus('D'),
      E: wsBridge.getFeedStatus('E')
    }
  });
});

/**
 * Generate demo patient code (ephemeral)
 */
app.get('/demo/patient', (_req: Request, res: Response) => {
  const patientCode = generateEphemeralPatientCode();
  res.json({
    patientCode,
    message: 'Ephemeral patient code generated'
  });
});

/**
 * DOM recognition - bind patient to transcript (Phase 2)
 */
app.post('/dom', async (req: Request, res: Response) => {
  try {
    const { transcriptId, domMap } = req.body as {
      transcriptId: number;
      domMap: DomMap;
    };

    if (!transcriptId || !domMap) {
      res.status(400).json({ error: 'Missing transcriptId or domMap' });
      return;
    }

    // TODO: Lookup real patient UUID from EMR based on MRN
    // For now, generate a mock patient UUID
    const patientUuid = `patient-${domMap.mrn || 'unknown'}`;

    await updatePatientInfo(transcriptId, patientUuid, domMap);

    res.json({
      success: true,
      transcriptId,
      patientUuid,
      metadata: domMap
    });
  } catch (error: any) {
    console.error('[Server] /dom error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get latest transcript for user (for /patient/current)
 */
app.get('/patient/current', async (req: Request, res: Response) => {
  try {
    const userId = (req.query.userId as string) || DEMO_DOCTOR_ID;
    
    const transcript = await getLatestTranscript(userId);
    
    if (!transcript) {
      res.status(404).json({ error: 'No transcript found for user' });
      return;
    }

    res.json(transcript);
  } catch (error: any) {
    console.error('[Server] /patient/current error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * List transcripts, optionally filtered by patient_code
 */
app.get('/transcripts', async (req: Request, res: Response) => {
  try {
    const patientCode = req.query.patient_code as string | undefined;
    const transcripts = await getTranscriptsByPatientCode(patientCode);

    res.json(transcripts.map(formatTranscriptResponse));
  } catch (error: any) {
    console.error('[Server] /transcripts error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get specific transcript by ID
 */
app.get('/transcripts/:id', async (req: Request, res: Response) => {
  try {
    const transcriptId = parseInt(req.params.id);
    
    if (isNaN(transcriptId)) {
      res.status(400).json({ error: 'Invalid transcript ID' });
      return;
    }

    const transcript = await getTranscript(transcriptId);
    
    if (!transcript) {
      res.status(404).json({ error: 'Transcript not found' });
      return;
    }

    res.json(formatTranscriptResponse(transcript));
  } catch (error: any) {
    console.error('[Server] /transcripts/:id error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// WebSocket Setup
// ============================================================================

const server = createServer(app);

// Initialize WsBridge
const wsBridge = new WsBridge();

// WebSocket server
const wss = new WebSocketServer({
  server,
  path: '/ws'
});

// Session management
type PatientHint = string | Record<string, unknown> | null;

interface Session {
  ws: WebSocket;
  userId: string;
  tabId: string | null;
  url?: string;
  patientHint?: PatientHint;
  lastPatientHint?: PatientHint;
  transcriptId: number | null;
  deepgram: DeepgramConsumer | null;
  pendingChunks: TranscriptChunk[];
  isRecording: boolean;
  saveTimer: NodeJS.Timeout | null;
  saveInProgress: boolean;
}

const sessions = new Map<WebSocket, Session>();
const sessionsByUser = new Map<string, Map<string, Session>>();
const activeTabByUser = new Map<string, string>();

wss.on('connection', (ws: WebSocket, req) => {
  const url = new URL(req.url || '', 'http://localhost');
  const userId = url.searchParams.get('userId') || DEMO_DOCTOR_ID;

  console.log(`[Server] WebSocket connection from user: ${userId}`);

  // Create session
  const session: Session = {
    ws,
    userId,
    tabId: null,
    transcriptId: null,
    deepgram: null,
    pendingChunks: [],
    isRecording: false,
    saveTimer: null,
    saveInProgress: false
  };

  sessions.set(ws, session);

  // Add to WsBridge for Feed status broadcasting
  wsBridge.addClient(ws);

  // Handle messages
  ws.on('message', async (data) => {
    await handleMessage(session, data);
  });

  // Handle close
  ws.on('close', () => {
    console.log(`[Server] WebSocket disconnected: ${userId}`);
    cleanupSession(session);
    sessions.delete(ws);
  });

  // Handle error
  ws.on('error', (error) => {
    console.error('[Server] WebSocket error:', error);
    cleanupSession(session);
  });

  // Send welcome message
  send(ws, { type: 'connected', userId });

  if (isSupabaseOffline()) {
    send(ws, {
      type: 'error',
      error: 'Supabase credentials missing; running in offline mock mode. Transcript data will not persist.',
      severity: 'warning'
    });
  }
});

/**
 * Handle WebSocket messages
 */
async function handleMessage(session: Session, data: any): Promise<void> {
  // Binary data = audio
  if (Buffer.isBuffer(data)) {
    if (!isActiveSession(session)) {
      // Ignore audio from non-active tabs to prevent cross-tab contamination
      return;
    }

    if (session.deepgram && session.isRecording) {
      session.deepgram.sendAudio(data);
    }
    return;
  }

  // JSON message
  try {
    const message = JSON.parse(data.toString());
    await handleCommand(session, message);
  } catch (error) {
    console.error('[Server] Failed to parse message:', error);
    send(session.ws, { type: 'error', error: 'Invalid message format' });
  }
}

/**
 * Handle JSON commands
 */
async function handleCommand(session: Session, message: any): Promise<void> {
  switch (message.type) {
    case 'hello':
      handleHello(session, message);
      break;

    case 'bind_audio':
      handleBindAudio(session, message);
      break;

    case 'start_recording':
      await startRecording(session, message);
      break;

    case 'stop_recording':
      await stopRecording(session);
      break;

    case 'ping':
      send(session.ws, { type: 'pong', timestamp: Date.now() });
      break;

    default:
      console.warn(`[Server] Unknown command: ${message.type}`);
  }
}

/**
 * Handle hello handshake to register tab metadata
 */
function handleHello(session: Session, message: any): void {
  const { tabId, url, patientHint, patientHints } = message;

  if (!tabId) {
    send(session.ws, { type: 'error', error: 'Missing tabId in hello payload' });
    return;
  }

  if (patientHints !== undefined && patientHint === undefined) {
    console.warn('[Server] Received deprecated "patientHints" field. Use "patientHint" instead.');
  }

  session.tabId = tabId;
  session.url = url;
  session.patientHint = patientHint ?? patientHints ?? session.patientHint ?? null;

  addSessionForUser(session);

  send(session.ws, {
    type: 'hello_ack',
    tabId: session.tabId,
    url: session.url,
    patientHint: session.patientHint
  });
}

/**
 * Bind audio input to a specific tab for the user
 */
function handleBindAudio(session: Session, message: any): void {
  const { tabId } = message;
  const targetTabId = tabId || session.tabId;

  if (!targetTabId) {
    send(session.ws, { type: 'error', error: 'No tabId provided to bind_audio' });
    return;
  }

  const userSessions = sessionsByUser.get(session.userId);
  if (!userSessions || !userSessions.has(targetTabId)) {
    send(session.ws, { type: 'error', error: `Tab ${targetTabId} not registered for user` });
    return;
  }

  const currentActive = activeTabByUser.get(session.userId);
  if (currentActive === targetTabId) {
    send(session.ws, { type: 'active_tab_changed', tabId: targetTabId });
    return;
  }

  setActiveTab(session.userId, targetTabId);
}

/**
 * Start recording
 */
async function startRecording(session: Session, message: any): Promise<void> {
  if (!isActiveSession(session)) {
    send(session.ws, { type: 'error', error: 'This tab is not the active recorder. Please bind audio to this tab first.' });
    return;
  }

  if (session.isRecording) {
    send(session.ws, { type: 'error', error: 'Already recording' });
    return;
  }

  if (!session.tabId) {
    send(session.ws, { type: 'error', error: 'Missing tabId. Send hello before starting recording.' });
    return;
  }

  try {
    const patientHint = message.patientHint ?? session.patientHint ?? null;
    session.patientHint = patientHint;

    if (session.lastPatientHint && session.lastPatientHint !== patientHint) {
      console.log(`[Server] Patient hint changed for user ${session.userId} (tab ${session.tabId}), starting new transcript run`);
      session.transcriptId = null;
    }

    // Generate ephemeral patient code
    const patientCode = message.patientCode || generateEphemeralPatientCode();

    // Create transcript run in Supabase
    const transcriptId = await createTranscriptRun(
      session.userId,
      patientCode,
      message.patientUuid || null
    );
    session.transcriptId = transcriptId;

    // Initialize Deepgram
    session.deepgram = new DeepgramConsumer({
      onTranscript: (event: TranscriptEvent) => {
        if (!isActiveSession(session)) return;

        // Broadcast transcript via WsBridge (Feed A)
        wsBridge.broadcastTranscript(
          event.text,
          event.isFinal,
          event.confidence,
          event.speaker,
          session.tabId || undefined
        );
      },
      onChunk: (chunk: TranscriptChunk) => {
        if (!isActiveSession(session)) return;

        // Queue chunk for batch save
        session.pendingChunks.push(chunk);

        // Persist as we go to keep transcript_chunk and transcript text fresh
        void savePendingChunks(session);
      },
      onError: (error: Error) => {
        console.error('[Server] Deepgram error:', error);
        wsBridge.updateFeedStatus('A', 'error', session.tabId || undefined);
        send(session.ws, { type: 'error', error: error.message });
      },
      onClose: () => {
        wsBridge.updateFeedStatus('A', 'disconnected', session.tabId || undefined);
      }
    });

    await session.deepgram.connect();
    session.isRecording = true;
    session.lastPatientHint = patientHint;

    // Update Feed A status
    wsBridge.updateFeedStatus('A', 'connected', session.tabId || undefined);

    // Start periodic save timer (every 5 seconds)
    session.saveTimer = setInterval(async () => {
      await savePendingChunks(session);
    }, 5000);

    send(session.ws, {
      type: 'recording_started',
      transcriptId,
      patientCode,
      tabId: session.tabId,
      userId: session.userId,
      patientHint
    });

    console.log(`[Server] Recording started: transcript ${transcriptId}, patient code ${patientCode}`);
  } catch (error: any) {
    console.error('[Server] Failed to start recording:', error);
    send(session.ws, { type: 'error', error: error.message });
  }
}

/**
 * Stop recording
 */
async function stopRecording(session: Session): Promise<void> {
  if (!isActiveSession(session)) {
    send(session.ws, { type: 'error', error: 'Only the active tab can stop recording' });
    return;
  }

  if (!session.isRecording) {
    send(session.ws, { type: 'error', error: 'Not recording' });
    return;
  }

  try {
    // Stop Deepgram
    if (session.deepgram) {
      session.deepgram.disconnect();
      session.deepgram = null;
    }

    session.isRecording = false;

    // Stop save timer
    if (session.saveTimer) {
      clearInterval(session.saveTimer);
      session.saveTimer = null;
    }

    // Final save of pending chunks
    await savePendingChunks(session);

    // Mark transcript complete
    if (session.transcriptId) {
      await completeTranscriptRun(session.transcriptId);
    }

    // Update Feed A status
    wsBridge.updateFeedStatus('A', 'disconnected', session.tabId || undefined);

    send(session.ws, {
      type: 'recording_stopped',
      transcriptId: session.transcriptId,
      tabId: session.tabId
    });

    console.log(`[Server] Recording stopped: transcript ${session.transcriptId}`);

    session.transcriptId = null;
  } catch (error: any) {
    console.error('[Server] Failed to stop recording:', error);
    send(session.ws, { type: 'error', error: error.message });
  }
}

/**
 * Track sessions by user and tab for cross-tab coordination
 */
function addSessionForUser(session: Session): void {
  if (!session.tabId) return;

  const userSessions = sessionsByUser.get(session.userId) || new Map<string, Session>();
  userSessions.set(session.tabId, session);
  sessionsByUser.set(session.userId, userSessions);

  if (!activeTabByUser.has(session.userId)) {
    setActiveTab(session.userId, session.tabId);
  }
}

function removeSession(session: Session): void {
  const userSessions = sessionsByUser.get(session.userId);
  if (!userSessions || !session.tabId) return;

  userSessions.delete(session.tabId);

  if (userSessions.size === 0) {
    sessionsByUser.delete(session.userId);
    activeTabByUser.delete(session.userId);
    broadcastActiveTabChange(session.userId, null);
    return;
  }

  sessionsByUser.set(session.userId, userSessions);

  if (activeTabByUser.get(session.userId) === session.tabId) {
    const nextTabId = userSessions.keys().next().value as string | undefined;
    if (nextTabId) {
      setActiveTab(session.userId, nextTabId);
    }
  }
}

function setActiveTab(userId: string, tabId: string): void {
  const userSessions = sessionsByUser.get(userId);
  if (!userSessions || !userSessions.has(tabId)) {
    console.warn(`[Server] Attempted to set active tab ${tabId} for user ${userId}, but tab not registered`);
    return;
  }

  activeTabByUser.set(userId, tabId);
  broadcastActiveTabChange(userId, tabId);
}

function broadcastActiveTabChange(userId: string, tabId: string | null): void {
  const userSessions = sessionsByUser.get(userId);
  if (!userSessions) return;

  for (const session of userSessions.values()) {
    send(session.ws, { type: 'active_tab_changed', tabId });
  }
}

function isActiveSession(session: Session): boolean {
  if (!session.tabId) return false;
  return activeTabByUser.get(session.userId) === session.tabId;
}

/**
 * Save pending chunks to Supabase
 */
async function savePendingChunks(session: Session): Promise<void> {
  if (!session.transcriptId || session.pendingChunks.length === 0 || session.saveInProgress) return;

  const chunks = [...session.pendingChunks];
  session.pendingChunks = [];
  session.saveInProgress = true;

  try {
    await saveTranscriptChunks(session.transcriptId, chunks);
  } catch (error) {
    // Re-queue chunks on failure
    session.pendingChunks.unshift(...chunks);
    console.error('[Server] Failed to save chunks, will retry:', error);
  } finally {
    session.saveInProgress = false;

    // If new chunks arrived while saving, persist them too
    if (session.pendingChunks.length > 0) {
      await savePendingChunks(session);
    }
  }
}

/**
 * Cleanup session
 */
function cleanupSession(session: Session): void {
  if (session.deepgram) {
    session.deepgram.disconnect();
  }
  if (session.saveTimer) {
    clearInterval(session.saveTimer);
  }
  if (session.transcriptId) {
    savePendingChunks(session);
  }

  removeSession(session);
}

/**
 * Send message to WebSocket client
 */
function send(ws: WebSocket, message: object): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function formatTranscriptResponse(transcript: TranscriptRun): object {
  return {
    id: transcript.id,
    user_id: transcript.user_id,
    patient_code: transcript.patient_code,
    patient_uuid: transcript.patient_uuid,
    created_at: transcript.created_at,
    completed_at: transcript.completed_at,
    transcript: transcript.transcript,
    transcript_chunk: transcript.transcript_chunk,
    ai_summary: transcript.ai_summary,
    ai_short_summary: transcript.ai_short_summary,
    ai_interim_summaries: transcript.ai_interim_summaries,
    metadata: transcript.metadata,
    language: transcript.language
  };
}

// ============================================================================
// Server Startup
// ============================================================================

server.listen(PORT, () => {
  console.log('');
  console.log('========================================');
  console.log('   AssistMD Truth Package - CNS Agent');
  console.log('========================================');
  console.log(`   Port:      ${PORT}`);
  console.log(`   WebSocket: ws://localhost:${PORT}/ws`);
  console.log(`   Health:    http://localhost:${PORT}/health`);
  console.log(`   Demo:      http://localhost:${PORT}/demo/patient`);
  console.log('========================================');
  console.log('');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Server] SIGTERM received, shutting down...');
  server.close(() => {
    console.log('[Server] Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[Server] SIGINT received, shutting down...');
  server.close(() => {
    console.log('[Server] Server closed');
    process.exit(0);
  });
});

export { app, server, wsBridge };
