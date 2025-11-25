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
import { TranscriptChunk, TranscriptEvent, DomMap } from './types/index.js';

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
  transcriptId: number | null;
  deepgram: DeepgramConsumer | null;
  pendingChunks: TranscriptChunk[];
  isRecording: boolean;
  saveTimer: NodeJS.Timeout | null;
}

const sessions = new Map<WebSocket, Session>();

wss.on('connection', (ws: WebSocket, req) => {
  const url = new URL(req.url || '', 'http://localhost');
  const userId = url.searchParams.get('userId') || DEMO_DOCTOR_ID;

  console.log(`[Server] WebSocket connection from user: ${userId}`);

  // Create session
  const session: Session = {
    ws,
    userId,
    transcriptId: null,
    deepgram: null,
    pendingChunks: [],
    isRecording: false,
    saveTimer: null
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
});

/**
 * Handle WebSocket messages
 */
async function handleMessage(session: Session, data: any): Promise<void> {
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
 * Start recording
 */
async function startRecording(session: Session, message: any): Promise<void> {
  if (session.isRecording) {
    send(session.ws, { type: 'error', error: 'Already recording' });
    return;
  }

  try {
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
        // Broadcast transcript via WsBridge (Feed A)
        wsBridge.broadcastTranscript(
          event.text,
          event.isFinal,
          event.confidence,
          event.speaker
        );
      },
      onChunk: (chunk: TranscriptChunk) => {
        // Queue chunk for batch save
        session.pendingChunks.push(chunk);
      },
      onError: (error: Error) => {
        console.error('[Server] Deepgram error:', error);
        wsBridge.updateFeedStatus('A', 'error');
        send(session.ws, { type: 'error', error: error.message });
      },
      onClose: () => {
        wsBridge.updateFeedStatus('A', 'disconnected');
      }
    });

    await session.deepgram.connect();
    session.isRecording = true;

    // Update Feed A status
    wsBridge.updateFeedStatus('A', 'connected');

    // Start periodic save timer (every 5 seconds)
    session.saveTimer = setInterval(async () => {
      await savePendingChunks(session);
    }, 5000);

    send(session.ws, {
      type: 'recording_started',
      transcriptId,
      patientCode
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
    wsBridge.updateFeedStatus('A', 'disconnected');

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
