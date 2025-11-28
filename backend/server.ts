import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { config } from 'dotenv';
import { attachBroker } from './ws/broker.js';
import { getPatientCardForUser } from './utils/patient.js';
import { getSupabaseClient } from './supabase/client.js';

config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.CNS_PORT || process.env.PORT || 8787);

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'cns-backend', uptime: process.uptime() });
});

app.get('/demo/patient', async (_req, res) => {
  const userId = process.env.DEMO_DOCTOR_ID ?? null;
  const card = await getPatientCardForUser(userId);
  res.json(card);
});

app.get('/transcripts/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: 'Invalid transcript id' });
    return;
  }

  try {
    const client = getSupabaseClient();
    const { data, error } = await client.from('transcripts2').select('*').eq('id', id).single();
    if (error && error.code !== 'PGRST116') {
      throw error;
    }
    if (!data) {
      res.status(404).json({ ok: false, error: 'Not found' });
      return;
    }

    res.json({ ok: true, transcript: data });
  } catch (err: any) {
    console.error('[Server] failed to fetch transcript', err);
    res.status(500).json({ ok: false, error: 'Failed to fetch transcript' });
  }
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

attachBroker(wss, { deepgramApiKey: process.env.DEEPGRAM_API_KEY || '' });

server.listen(PORT, () => {
  if (!process.env.DEEPGRAM_API_KEY) {
    console.error('[Startup] Missing DEEPGRAM_API_KEY');
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[Startup] Missing Supabase configuration');
  }
  console.log(`CNS backend listening on ${PORT}`);
});

process.on('SIGINT', () => server.close());
process.on('SIGTERM', () => server.close());

export { app, server };
