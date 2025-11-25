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
import { DeepgramConsumer } from './audio/consumers/deepgram.js';
import { createTranscriptRun, saveChunk } from './lib/supabase.js';

config();

const app = express();
const PORT = process.env.PORT || 3001;

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

// Create HTTP server
const server = createServer(app);

// WebSocket server
const wss = new WebSocketServer({ server, path: '/ws' });

// Active sessions map
const sessions: Map<WebSocket, {
  deepgram: DeepgramConsumer;
  transcriptRunId: string | null;
  providerId: string;
}> = new Map();

wss.on('connection', async (ws, req) => {
  console.log('[Server] New WebSocket connection');

  // Extract provider ID from query params or headers
  const url = new URL(req.url || '', `http://localhost:${PORT}`);
  const providerId = url.searchParams.get('providerId') || 'anonymous';

  // Create transcript run in Supabase
  let transcriptRunId: string | null = null;
  try {
    transcriptRunId = await createTranscriptRun(providerId);
    console.log(`[Server] Created transcript run: ${transcriptRunId}`);
  } catch (error) {
    console.error('[Server] Failed to create transcript run:', error);
  }

  // Initialize Deepgram consumer
  const deepgram = new DeepgramConsumer({
    onTranscript: async (transcript) => {
      // Send transcript to browser
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'transcript',
          ...transcript
        }));
      }

      // Save to Supabase
      if (transcriptRunId && transcript.is_final) {
        try {
          await saveChunk(transcriptRunId, transcript);
        } catch (error) {
          console.error('[Server] Failed to save chunk:', error);
        }
      }
    },
    onError: (error) => {
      console.error('[Server] Deepgram error:', error);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'error',
          error: error.message
        }));
      }
    }
  });

  sessions.set(ws, { deepgram, transcriptRunId, providerId });

  // Start Deepgram connection
  try {
    await deepgram.connect();
    ws.send(JSON.stringify({ type: 'status', status: 'connected' }));
  } catch (error) {
    console.error('[Server] Failed to connect to Deepgram:', error);
    ws.send(JSON.stringify({
      type: 'error',
      error: 'Failed to connect to transcription service'
    }));
  }

  // Handle incoming audio data
  ws.on('message', (data) => {
    const session = sessions.get(ws);
    if (session && data instanceof Buffer) {
      session.deepgram.sendAudio(data);
    }
  });

  // Handle disconnect
  ws.on('close', () => {
    console.log('[Server] WebSocket disconnected');
    const session = sessions.get(ws);
    if (session) {
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
