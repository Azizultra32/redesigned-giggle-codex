/**
 * CNS Agent Server
 *
 * Express server with WebSocket support for:
 * - Receiving audio streams from browser extension
 * - Processing through Deepgram for transcription
 * - Storing transcripts in Supabase
 */

import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { config } from 'dotenv';
import { DeepgramConsumer, TranscriptResult } from './audio/consumers/deepgram.js';
import {
  createTranscriptRun,
  getTranscriptRun,
  saveTranscriptChunks,
  TranscriptChunk,
  updateTranscriptRun
} from './lib/supabase.js';

config();

const app = express();
const PORT = process.env.PORT || 3001;

const MAX_BUFFERED_CHUNKS = 5;
const FLUSH_INTERVAL_MS = 1500;

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Fetch a transcript run (Summary/History consumers)
app.get('/transcripts/:id', async (req, res) => {
  const transcriptId = Number(req.params.id);

  if (Number.isNaN(transcriptId)) {
    return res.status(400).json({ error: 'Invalid transcript id' });
  }

  try {
    const transcript = await getTranscriptRun(transcriptId);
    if (!transcript) {
      return res.status(404).json({ error: 'Transcript not found' });
    }

    return res.json(transcript);
  } catch (error) {
    console.error('[Server] Failed to fetch transcript run:', error);
    return res.status(500).json({ error: 'Failed to fetch transcript run' });
  }
});

// Create HTTP server
const server = createServer(app);

// WebSocket server
const wss = new WebSocketServer({ server, path: '/ws' });

type SessionState = {
  deepgram: DeepgramConsumer;
  transcriptRunId: number | null;
  providerId: string;
  pendingChunks: TranscriptChunk[];
  flushTimer?: NodeJS.Timeout;
};

const sessions: Map<WebSocket, SessionState> = new Map();

function clearFlushTimer(session: SessionState) {
  if (session.flushTimer) {
    clearTimeout(session.flushTimer);
    session.flushTimer = undefined;
  }
}

function convertTranscriptToChunk(transcript: TranscriptResult): TranscriptChunk | null {
  if (!transcript.words?.length) return null;

  const start = transcript.words[0].start ?? 0;
  const end = transcript.words[transcript.words.length - 1].end ?? start;
  const speakerFromWords = transcript.words.find((word) => word.speaker !== undefined)?.speaker;
  const speakerId = typeof speakerFromWords === 'number' ? speakerFromWords : Number(transcript.speaker) || 0;
  const text = transcript.text.trim();

  if (!text) return null;

  return {
    speaker: speakerId,
    text,
    start,
    end,
    word_count: transcript.words.length,
    raw: transcript.words.map((w) => ({
      word: w.word,
      start: w.start,
      end: w.end,
      confidence: w.confidence,
      speaker: typeof w.speaker === 'number' ? w.speaker : speakerId
    }))
  };
}

async function flushTranscriptChunks(ws: WebSocket): Promise<void> {
  const session = sessions.get(ws);
  if (!session || !session.transcriptRunId || session.pendingChunks.length === 0) return;

  const chunksToSave = [...session.pendingChunks];
  session.pendingChunks = [];
  clearFlushTimer(session);

  try {
    await saveTranscriptChunks(session.transcriptRunId, chunksToSave);
  } catch (error) {
    console.error('[Server] Failed to persist transcript chunks:', error);
    // Requeue chunks to avoid data loss and attempt another flush later
    session.pendingChunks.unshift(...chunksToSave);
    if (!session.flushTimer) {
      session.flushTimer = setTimeout(() => {
        flushTranscriptChunks(ws).catch((flushError) => {
          console.error('[Server] Flush retry failed:', flushError);
        });
      }, FLUSH_INTERVAL_MS);
    }
  }
}

function scheduleFlush(ws: WebSocket, immediate = false) {
  const session = sessions.get(ws);
  if (!session || !session.transcriptRunId) return;

  if (immediate) {
    flushTranscriptChunks(ws).catch((error) => {
      console.error('[Server] Immediate flush failed:', error);
    });
    return;
  }

  if (!session.flushTimer) {
    session.flushTimer = setTimeout(() => {
      flushTranscriptChunks(ws).catch((error) => {
        console.error('[Server] Scheduled flush failed:', error);
      });
    }, FLUSH_INTERVAL_MS);
  }
}

wss.on('connection', async (ws, req) => {
  console.log('[Server] New WebSocket connection');

  // Extract provider ID from query params or headers
  const url = new URL(req.url || '', `http://localhost:${PORT}`);
  const providerId = url.searchParams.get('providerId') || 'anonymous';

  // Create transcript run in Supabase
  let transcriptRunId: number | null = null;
  try {
    transcriptRunId = await createTranscriptRun(providerId);
    console.log(`[Server] Created transcript run: ${transcriptRunId}`);
  } catch (error) {
    console.error('[Server] Failed to create transcript run:', error);
  }

  const sessionState: SessionState = {
    deepgram: new DeepgramConsumer({
      onTranscript: async (transcript) => {
        // Send transcript to browser
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: 'transcript',
              ...transcript
            })
          );
        }

        // Buffer diarized chunks for Supabase
        const session = sessions.get(ws);
        if (!session || !transcriptRunId) return;

        if (transcript.is_final) {
          const chunk = convertTranscriptToChunk(transcript);
          if (chunk) {
            session.pendingChunks.push(chunk);
            if (session.pendingChunks.length >= MAX_BUFFERED_CHUNKS) {
              scheduleFlush(ws, true);
            } else {
              scheduleFlush(ws);
            }
          }
        }
      },
      onError: (error) => {
        console.error('[Server] Deepgram error:', error);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: 'error',
              error: error.message
            })
          );
        }
      },
      onUtteranceEnd: () => scheduleFlush(ws, true),
      onClose: () => scheduleFlush(ws, true)
    }),
    transcriptRunId,
    providerId,
    pendingChunks: []
  };

  sessions.set(ws, sessionState);

  // Start Deepgram connection
  try {
    await sessionState.deepgram.connect();
    ws.send(JSON.stringify({ type: 'status', status: 'connected' }));
  } catch (error) {
    console.error('[Server] Failed to connect to Deepgram:', error);
    ws.send(
      JSON.stringify({
        type: 'error',
        error: 'Failed to connect to transcription service'
      })
    );
  }

  // Handle incoming audio data
  ws.on('message', (data) => {
    const session = sessions.get(ws);
    if (session && data instanceof Buffer) {
      session.deepgram.sendAudio(data);
    }
  });

  // Handle disconnect
  ws.on('close', async () => {
    console.log('[Server] WebSocket disconnected');
    const session = sessions.get(ws);
    if (session) {
      clearFlushTimer(session);
      await flushTranscriptChunks(ws);
      if (session.transcriptRunId) {
        try {
          await updateTranscriptRun(session.transcriptRunId);
        } catch (error) {
          console.error('[Server] Failed to mark transcript complete:', error);
        }
      }
      session.deepgram.disconnect();
      sessions.delete(ws);
    }
  });

  ws.on('error', (error) => {
    console.error('[Server] WebSocket error:', error);
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`🚀 GHOST-NEXT Agent running on port ${PORT}`);
  console.log(`   WebSocket: ws://localhost:${PORT}/ws`);
  console.log(`   Health: http://localhost:${PORT}/health`);
});

export { app, server };
