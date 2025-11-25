/**
 * GHOST-NEXT Backend Server
 *
 * Express server with WebSocket support for:
 * - /ws: Command/control channel for extension
 * - /audio-stream: Alternative audio streaming endpoint
 * - /demo/patient: Demo patient code generator
 * - /health: Health check
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { config } from 'dotenv';
import { WebSocketBroker } from './ws/broker.js';
import { generateDemoPatientCode, validatePatientCode } from './utils/patient.js';

// Load environment variables
config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: ['chrome-extension://*', 'http://localhost:*'],
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true
}));
app.use(express.json());

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    service: 'ghost-next-backend'
  });
});

// Demo patient code generator
app.get('/demo/patient', (_req: Request, res: Response) => {
  const patientCode = generateDemoPatientCode();
  res.json({
    patientCode,
    message: 'Demo patient code generated'
  });
});

// Validate patient code
app.post('/demo/patient/validate', (req: Request, res: Response) => {
  const { patientCode } = req.body;

  if (!patientCode) {
    res.status(400).json({ valid: false, error: 'Missing patientCode' });
    return;
  }

  const valid = validatePatientCode(patientCode);
  res.json({ valid, patientCode });
});

// Create HTTP server
const server = createServer(app);

// WebSocket server on /ws path
const wss = new WebSocketServer({
  server,
  path: '/ws'
});

// Initialize WebSocket broker
const broker = new WebSocketBroker(wss, {
  saveInterval: 5000 // Save chunks every 5 seconds
});

// Alternative audio streaming WebSocket (for simpler clients)
const audioWss = new WebSocketServer({
  server,
  path: '/audio-stream'
});

audioWss.on('connection', (ws, req) => {
  console.log('[Server] Audio stream connection');
  // Redirect to main broker - audio clients should use /ws
  ws.send(JSON.stringify({
    type: 'redirect',
    message: 'Please use /ws endpoint for full functionality'
  }));
});

// Server stats endpoint
app.get('/stats', (_req: Request, res: Response) => {
  res.json({
    activeSessions: broker.getSessionCount(),
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

// Start server
server.listen(PORT, () => {
  console.log('');
  console.log('========================================');
  console.log('   GHOST-NEXT Backend Server');
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
    console.log('[Server] HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[Server] SIGINT received, shutting down...');
  server.close(() => {
    console.log('[Server] HTTP server closed');
    process.exit(0);
  });
});

export { app, server, broker };
