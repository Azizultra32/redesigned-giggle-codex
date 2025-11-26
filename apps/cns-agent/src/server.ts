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
  generateEphemeralPatientCode
} from './lib/supabase.js';
import { TranscriptChunk, TranscriptEvent, DomMap, PatientHints, TranscriptRun } from './types/index.js';

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

    res.json(transcript);
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
interface Session {
  ws: WebSocket;
  userId: string;
  tabId?: string;
  tabTitle?: string;
  tabUrl?: string;
  patientHints?: PatientHints;
  transcriptId: number | null;
  deepgram: DeepgramConsumer | null;
  pendingChunks: TranscriptChunk[];
  isRecording: boolean;
  saveTimer: NodeJS.Timeout | null;
  isActiveTab: boolean;
}

const sessions = new Map<WebSocket, Session>();
const userSessions = new Map<string, Map<string, Session>>();
const activeTabs = new Map<string, string>();

wss.on('connection', (ws: WebSocket, req) => {
  const url = new URL(req.url || '', 'http://localhost');
  const userId = url.searchParams.get('userId') || DEMO_DOCTOR_ID;

  console.log(`[Server] WebSocket connection from user: ${userId}`);

  // Create session
  const session: Session = {
    ws,
    userId,
    tabId: undefined,
    tabTitle: undefined,
    tabUrl: undefined,
    patientHints: undefined,
    transcriptId: null,
    deepgram: null,
    pendingChunks: [],
    isRecording: false,
    saveTimer: null,
    isActiveTab: false
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
    unregisterSession(session);
    sessions.delete(ws);
  });

  // Handle error
  ws.on('error', (error) => {
    console.error('[Server] WebSocket error:', error);
    cleanupSession(session);
    unregisterSession(session);
  });

  // Send welcome message
  send(ws, { type: 'connected', userId });
});

/**
 * Handle WebSocket messages
 */
async function handleMessage(session: Session, data: any): Promise<void> {
  // Binary data = audio
  if (Buffer.isBuffer(data)) {
    if (!ensureActiveTab(session, 'audio')) {
      return;
    }

    if (session.deepgram && session.isRecording) {
      session.deepgram.sendAudio(data);
    } else {
      send(session.ws, { type: 'error', error: 'No active recording for this tab' });
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
      await handleHello(session, message);
      break;

    case 'bind_audio':
      handleBindAudio(session, message);
      break;

    case 'start_recording':
      if (ensureActiveTab(session, 'start_recording')) {
        await startRecording(session, message);
      }
      break;

    case 'stop_recording':
      if (ensureActiveTab(session, 'stop_recording')) {
        await stopRecording(session);
      }
      break;

    case 'ping':
      send(session.ws, { type: 'pong', timestamp: Date.now() });
      break;

    default:
      console.warn(`[Server] Unknown command: ${message.type}`);
  }
}

/**
 * Handle initial hello message to register tab context and patient hints
 */
async function handleHello(session: Session, message: any): Promise<void> {
  const tabId = message.tabId as string | undefined;

  if (!tabId) {
    send(session.ws, { type: 'error', error: 'Missing tabId in hello message' });
    return;
  }

  session.tabId = tabId;
  session.tabTitle = message.title || message.tabTitle;
  session.tabUrl = message.url || message.tabUrl;
  session.patientHints = mergePatientHints(session, message.patientHints, message);

  registerSession(session);

  if (!activeTabs.has(session.userId)) {
    setActiveTab(session.userId, tabId, session);
  } else {
    session.isActiveTab = activeTabs.get(session.userId) === tabId;
  }

  send(session.ws, {
    type: 'hello_ack',
    tabId,
    isActive: session.isActiveTab,
    title: session.tabTitle,
    url: session.tabUrl
  });
}

/**
 * Handle bind_audio requests to mark this tab as active for audio/control
 */
function handleBindAudio(session: Session, message: any): void {
  const requestedTabId = (message.tabId as string | undefined) || session.tabId;

  if (!requestedTabId) {
    send(session.ws, { type: 'error', error: 'Missing tabId for bind_audio' });
    return;
  }

  session.tabId = requestedTabId;
  registerSession(session);
  setActiveTab(session.userId, requestedTabId, session);

  send(session.ws, {
    type: 'bind_audio_ack',
    tabId: requestedTabId,
    isActive: session.isActiveTab
  });
}

/**
 * Start recording
 */
async function startRecording(session: Session, message: any): Promise<void> {
  if (session.isRecording) {
    send(session.ws, { type: 'error', error: 'Already recording' });
    return;
  }

  if (!session.tabId) {
    send(session.ws, { type: 'error', error: 'Tab not registered. Send hello first.' });
    return;
  }

  try {
    // Merge patient hints
    const patientHints = mergePatientHints(session, message.patientHints, message);
    session.patientHints = patientHints;

    // Generate patient identifiers based on hints
    const patientCode = message.patientCode || patientHints.patientCode || generateEphemeralPatientCode();
    const patientUuid = message.patientUuid ?? patientHints.patientUuid ?? null;

    const latestTranscript = await getLatestTranscript(session.userId);

    if (!patientHintsMatch(latestTranscript, patientHints)) {
      send(session.ws, {
        type: 'patient_hint_mismatch',
        message: 'Incoming patient hints do not match the latest transcript. Starting a fresh run to avoid mixing patients.',
        latestTranscriptId: latestTranscript?.id,
        latestPatientCode: latestTranscript?.patient_code || null,
        latestPatientUuid: latestTranscript?.patient_uuid || null
      });
    }

    // Create transcript run in Supabase
    const transcriptId = await createTranscriptRun(session.userId, patientCode, patientUuid);
    session.transcriptId = transcriptId;

    // Initialize Deepgram
    session.deepgram = new DeepgramConsumer({
      onTranscript: (event: TranscriptEvent) => {
        // Broadcast transcript via WsBridge (Feed A)
        wsBridge.broadcastTranscript(
          event.text,
          event.isFinal,
          event.confidence,
          event.speaker,
          session.tabId
        );
      },
      onChunk: (chunk: TranscriptChunk) => {
        // Queue chunk for batch save
        session.pendingChunks.push(chunk);
      },
      onError: (error: Error) => {
        console.error('[Server] Deepgram error:', error);
        wsBridge.updateFeedStatus('A', 'error', session.tabId);
        send(session.ws, { type: 'error', error: error.message });
      },
      onClose: () => {
        wsBridge.updateFeedStatus('A', 'disconnected', session.tabId);
      }
    });

    await session.deepgram.connect();
    session.isRecording = true;

    // Update Feed A status
    wsBridge.updateFeedStatus('A', 'connected', session.tabId);

    // Start periodic save timer (every 5 seconds)
    session.saveTimer = setInterval(async () => {
      await savePendingChunks(session);
    }, 5000);

    send(session.ws, {
      type: 'recording_started',
      transcriptId,
      patientCode,
      patientUuid,
      tabId: session.tabId
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
    wsBridge.updateFeedStatus('A', 'disconnected', session.tabId);

    send(session.ws, {
      type: 'recording_stopped',
      transcriptId: session.transcriptId
    });

    console.log(`[Server] Recording stopped: transcript ${session.transcriptId}`);
  } catch (error: any) {
    console.error('[Server] Failed to stop recording:', error);
    send(session.ws, { type: 'error', error: error.message });
  }
}

/**
 * Merge patient hints from session, hello, and command payloads
 */
function mergePatientHints(session: Session, incoming?: PatientHints, message?: any): PatientHints {
  const merged: PatientHints = { ...(session.patientHints || {}) };

  if (incoming) {
    Object.assign(merged, incoming);
  }

  if (message) {
    if (message.patientCode) merged.patientCode = message.patientCode;
    if (message.patientUuid) merged.patientUuid = message.patientUuid;
    if (message.mrn) merged.mrn = message.mrn;
  }

  return merged;
}

/**
 * Compare incoming patient hints with latest transcript to avoid mixing patients
 */
function patientHintsMatch(transcript: TranscriptRun | null, hints?: PatientHints): boolean {
  if (!transcript || !hints) return true;

  if (transcript.patient_uuid && hints.patientUuid && transcript.patient_uuid !== hints.patientUuid) {
    return false;
  }

  if (transcript.patient_code && hints.patientCode && transcript.patient_code !== hints.patientCode) {
    return false;
  }

  const transcriptMrn = (transcript.metadata as any)?.mrn;
  if (transcriptMrn && hints.mrn && transcriptMrn !== hints.mrn) {
    return false;
  }

  return true;
}

/**
 * Register session by user and tab
 */
function registerSession(session: Session): void {
  if (!session.tabId) return;

  let userMap = userSessions.get(session.userId);
  if (!userMap) {
    userMap = new Map<string, Session>();
    userSessions.set(session.userId, userMap);
  }

  userMap.set(session.tabId, session);
}

/**
 * Remove session from tracking maps
 */
function unregisterSession(session: Session): void {
  if (!session.tabId) return;

  const userMap = userSessions.get(session.userId);
  if (userMap) {
    userMap.delete(session.tabId);

    if (userMap.size === 0) {
      userSessions.delete(session.userId);
    }
  }

  if (session.isActiveTab) {
    const nextSession = userMap ? Array.from(userMap.values())[0] : undefined;

    if (nextSession?.tabId) {
      setActiveTab(session.userId, nextSession.tabId, nextSession);
    } else {
      activeTabs.delete(session.userId);
    }
  }
}

/**
 * Ensure only active tabs can control audio/recording
 */
function ensureActiveTab(session: Session, action: string): boolean {
  if (!session.tabId) {
    send(session.ws, { type: 'error', error: `Tab not registered for ${action}` });
    return false;
  }

  if (!session.isActiveTab) {
    send(session.ws, {
      type: 'error',
      error: `Tab ${session.tabId} is inactive for ${action}. Call bind_audio to activate.`
    });
    return false;
  }

  return true;
}

/**
 * Flip active tab for a user and notify all clients
 */
function setActiveTab(userId: string, tabId: string, sourceSession?: Session): void {
  const userMap = userSessions.get(userId);

  if (!userMap || !userMap.has(tabId)) {
    console.warn(`[Server] Attempted to activate unknown tab ${tabId} for user ${userId}`);
    return;
  }

  for (const session of userMap.values()) {
    session.isActiveTab = session.tabId === tabId;
  }

  activeTabs.set(userId, tabId);

  const targetSession = userMap.get(tabId) || sourceSession;
  wsBridge.broadcastActiveTabChange(userId, tabId, targetSession?.tabTitle, targetSession?.tabUrl);
}

/**
 * Save pending chunks to Supabase
 */
async function savePendingChunks(session: Session): Promise<void> {
  if (!session.transcriptId || session.pendingChunks.length === 0) return;

  const chunks = [...session.pendingChunks];
  session.pendingChunks = [];

  try {
    await saveTranscriptChunks(session.transcriptId, chunks);
  } catch (error) {
    // Re-queue chunks on failure
    session.pendingChunks.unshift(...chunks);
    console.error('[Server] Failed to save chunks, will retry:', error);
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
}

/**
 * Send message to WebSocket client
 */
function send(ws: WebSocket, message: object): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
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
