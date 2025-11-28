import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { attachBroker } from './ws/broker.js';
import { getPatientCardForUser } from './utils/patient.js';
import { getSupabaseClient } from './supabase/client.js';
import { config } from 'dotenv';

config();

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'cns-backend', uptime: process.uptime() });
});

app.get('/demo/patient', async (_req, res) => {
  const card = await getPatientCardForUser(null);
  res.json(card);
});

app.get('/transcripts/:id', async (req, res) => {
  const transcriptId = Number(req.params.id);
  if (Number.isNaN(transcriptId)) {
    res.status(400).json({ ok: false, error: 'Invalid id' });
    return;
  }

  try {
    const { data } = await getSupabaseClient()
      .from('transcripts2')
      .select('*')
      .eq('id', transcriptId)
      .single();
    if (!data) {
      res.status(404).json({ ok: false, error: 'Not found' });
      return;
    }
    res.json({ ok: true, transcript: data });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

const server = createServer(app);

const wss = new WebSocketServer({ server, path: '/ws' });
const apiKey = process.env.DEEPGRAM_API_KEY;
if (!apiKey) {
  throw new Error('DEEPGRAM_API_KEY is required');
}
attachBroker(wss, { deepgramApiKey: apiKey });

const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;
server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`CNS backend listening on http://localhost:${PORT}`);
});

process.on('SIGINT', () => server.close());
process.on('SIGTERM', () => server.close());

export { app, server };
