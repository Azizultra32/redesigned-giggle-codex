# OpenSpec: Realtime CNS Agent (cns-realtime-diarization-001)

## Purpose
A central nervous system (CNS) backend that:
- Receives live audio from a browser overlay via WebSocket.
- Streams audio to a real-time ASR provider (Deepgram-style) with diarization enabled.
- Aggregates word events into speaker-labelled chunks (≤30 seconds each).
- Persists transcripts and chunks into a `transcripts2` table in Postgres/Supabase.
- Serves HTTP endpoints for patient card and transcript retrieval.
- Exposes a WebSocket hub for transcript, status, autopilot, and VAD updates.
- Integrates a VAD layer and DOM mapping/autopilot hooks (contract defined; implementation can be minimal).

## Suggested Backend Layout
```
backend/
  server.ts               # HTTP + WebSocket entrypoint
  types.ts                # shared backend types
  audio/
    deepgram-consumer.ts  # ASR/diarization client wrapper
    vad-consumer.ts       # VAD wrapper (interface + minimal impl)
  ws/
    broker.ts             # WebSocket hub between overlay and audio pipeline
  supabase/
    client.ts             # DB client creation
    transcripts.ts        # transcripts2 access layer
  utils/
    diarization.ts        # diarization/chunking assembler
    patient.ts            # patient card mapping helper
    dom.ts                # DOM snapshot analysis + autopilot hooks
```

## Core Types (`backend/types.ts`)
### Consumer lifecycle
```ts
export type ConsumerState =
  | "idle"
  | "connecting"
  | "connected"
  | "error"
  | "closed";
```

### Transcript aggregation
```ts
export interface TranscriptChunk {
  speaker: number;      // diarization speaker id
  text: string;         // aggregated text for chunk
  start: number;        // seconds from session start
  end: number;          // seconds from session start
  isFinal: boolean;     // true once chunk is closed
}

export interface TranscriptPayload {
  finalized: TranscriptChunk[];  // all finalized chunks so far
  interim: TranscriptChunk | null; // current open chunk, if any
  fullText: string;              // flattened transcript text
}

export interface TranscriptSession {
  sessionId: string;             // uuid for this recording session
  transcriptId: number | null;   // database transcripts2.id
  userId: string | null;
  patientCode: string | null;    // generated encounter code
  patientUuid: string | null;    // external/EMR patient id
  startedAt: number;             // Date.now() when recording started
  stoppedAt: number | null;
  fullText: string;
  chunks: TranscriptChunk[];
  deepgram: import("../audio/deepgram-consumer").DeepgramConsumer;
  vad: import("../audio/vad-consumer").VADConsumer;
}
```

### WebSocket client context
```ts
export type ClientState =
  | "idle"
  | "recording"
  | "stopping"
  | "error"
  | "closed";

export interface ClientContext {
  id: string;                     // uuid per WS connection
  ws: import("ws").WebSocket;
  state: ClientState;
  session: TranscriptSession | null; // active recording, if any
  userId: string | null;             // future use
}
```

## WebSocket Message Contracts
### Inbound from browser overlay
```ts
export type WsInboundMessage = AudioMessage | EventMessage;

export interface AudioMessage {
  kind: "audio";
  sessionId?: string;     // optional frontend session handle
  format: "pcm16";
  sampleRate: 16000;
  chunkId: number;        // monotonic per client
  data: string;           // base64-encoded PCM 16-bit mono
}

export interface EventMessage {
  kind: "event";
  event: "record-start" | "record-stop" | "command";
  commandName?: "MAP_DOM" | "SMART_FILL" | "SEND_NOTE" | "UNDO_LAST";
  domSnapshot?: unknown;  // raw DOM snapshot object from overlay
  patientContext?: unknown; // optional patient details discovered in UI
  sessionId?: string;     // overlay reference if available
}
```

### Outbound to browser overlay
```ts
export type WsOutboundMessage =
  | TranscriptUpdateMessage
  | StatusMessage
  | AutopilotMessage;

export interface TranscriptUpdateMessage {
  kind: "transcript-update";
  isFinal: boolean;
  speaker: number | null;
  text: string;
  chunkStart: number | null; // seconds
  chunkEnd: number | null;   // seconds
}

export interface StatusMessage {
  kind: "status";
  source: "deepgram" | "supabase" | "backend" | "vad";
  state: "connected" | "disconnected" | "error" | "idle" | "recording";
  message?: string;
}

export interface AutopilotMessage {
  kind: "autopilot";
  ready: boolean;
  surfacesFound: number;
  lastAction?: "mapped_fields" | "sent_note" | "smart_fill_executed";
}
```

## Supabase Client (`backend/supabase/client.ts`)
- **Env:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (required; never exposed to browser).
- **API:** `export function getSupabaseClient(): SupabaseClient;`
- **Behavior:**
  - On first call, throw a clear error if env vars are missing.
  - Create `SupabaseClient` with `auth: { persistSession: false }` and cache it.
  - Subsequent calls return the cached client.

## Transcript Access Layer (`backend/supabase/transcripts.ts`)
### Table expectations
`transcripts2` table (minimum columns used):
- `id` bigint PK
- `user_id` uuid
- `patient_code` text
- `patient_uuid` uuid null
- `language` text
- `transcript` text
- `transcript_chunk` jsonb[]
- `ai_summary` jsonb null
- `ai_short_summary` jsonb null
- `ai_interim_summaries` jsonb[] null
- `created_at` timestamptz
- `completed_at` timestamptz null
- `error` text null

### Types
```ts
export interface CreateTranscriptRunInput {
  userId: string | null;
  patientCode?: string | null;
  patientUuid?: string | null;
  language?: string;
}

export interface CreateTranscriptRunResult {
  id: number;
  patientCode: string;
}

export interface SaveTranscriptChunksOptions {
  fullTranscript?: string;
  completed?: boolean;
}

export interface TranscriptRow { /* mirrors table columns */ }
```

### Functions
- **createTranscriptRun(input): Promise<CreateTranscriptRunResult>**
  - Compute `finalPatientCode` as provided or `PT-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(16).slice(2, 6).toUpperCase()}`.
  - Insert into `transcripts2` and return `{ id, patientCode }`.
  - On Supabase error: throw.
- **saveTranscriptChunks(transcriptId, chunks, options): Promise<void>**
  - Patch object includes `transcript_chunk`; optionally `transcript` and `completed_at` (if `options.completed`).
  - Update `transcripts2` for the given id; throw on error.
- **updatePatientLink(transcriptId, data): Promise<void>**
  - Minimal patch for provided keys (`patientUuid`, `patientCode`); update row and throw on error.
- **getLatestTranscriptForUser(userId): Promise<TranscriptRow | null>**
  - Return null if `userId` is null; otherwise fetch latest row by `created_at`.

## Diarization Utility (`backend/utils/diarization.ts`)
### Types
```ts
export interface DiarizationWord {
  text: string;
  start: number;
  end: number;
  speaker?: number | null;
  punctuated?: string;
}

export interface DiarizedChunk {
  speaker: number;
  text: string;
  start: number;
  end: number;
  isFinal: boolean;
}

export interface DiarizationResult {
  finalized: DiarizedChunk[];
  interim: DiarizedChunk | null;
  fullText: string;
}

export interface DiarizationOptions {
  maxChunkDurationSeconds?: number; // default 30
  fallbackSpeakerId?: number;       // default -1
}

export interface DeepgramWordLike {
  word: string;
  punctuated_word?: string;
  start: number;
  end: number;
  speaker?: number | null;
}

export interface DeepgramEventLike {
  is_final?: boolean;
  channel?: {
    alternatives?: Array<{
      words?: DeepgramWordLike[];
    }>;
  };
}
```

### Class API
```ts
export class DiarizationAssembler {
  constructor(options?: DiarizationOptions);
  snapshot(): DiarizationResult;
  ingest(words: DiarizationWord[], opts?: { isFinal?: boolean }): DiarizationResult;
  ingestDeepgramEvent(event: DeepgramEventLike): DiarizationResult;
}
```

### Behavior
- Maintains `currentChunk`, `persisted`, and `fullText` state.
- Start a new chunk on speaker change or if `end - currentChunk.start ≥ maxChunkDurationSeconds` (default 30s).
- If `opts.isFinal === true` or `event.is_final === true`, finalize any current chunk.
- Append each finalized chunk’s text to `fullText`, separated by newlines.

## ASR Consumer (`backend/audio/deepgram-consumer.ts`)
- Uses `DiarizationAssembler` to aggregate events into `TranscriptPayload`.
- Avoids DB writes directly; emits payloads to upstream handlers.
- Connects to ASR provider with diarization and smart formatting enabled.

## VAD Consumer (`backend/audio/vad-consumer.ts`)
### Types & Lifecycle
```ts
export type VADState = "idle" | "running" | "error" | "stopped";

export interface VADConsumerOptions {
  sampleRate?: number;     // default 16000
  frameSizeMs?: number;    // default 20
  silenceTimeoutMs?: number; // default 5000
  autoStart?: boolean;     // default false
  autoStop?: boolean;      // default false
}

export type VADStatusHandler = (state: VADState) => void;
export type VADSpeechHandler = (event: { type: "speech-start" | "speech-end"; at: number; }) => void;
export type VADCommandHandler = (event: { phrase: string; at: number; }) => void;
```

### Class
```ts
export class VADConsumer {
  constructor(options?: VADConsumerOptions);
  start(handlers?: { status?: VADStatusHandler; speech?: VADSpeechHandler; command?: VADCommandHandler; }): void;
  handleAudio(buffer: Buffer): void;
  stop(): void;
}
```
- Maintain internal VAD state and emit status transitions.
- MVP: `handleAudio` may be a no-op; optional RMS-based speech events.

## WebSocket Broker (`backend/ws/broker.ts`)
### API
```ts
import { WebSocketServer } from "ws";
export interface BrokerOptions { deepgramApiKey: string; }
export function attachBroker(wss: WebSocketServer, options: BrokerOptions): void;
```

### Connection lifecycle
- On connection, create a `ClientContext` with `state="idle"`, `session=null`, `userId=null`.
- Register `message`, `close`, and `error` handlers.

### Message handling
- Parse JSON; on failure send `StatusMessage` with `source: "backend", state: "error", message: "INVALID_JSON"`.
- `audio` messages: validate format/sample rate; ignore if not recording; otherwise forward decoded buffers to Deepgram and VAD consumers.
- `event` messages:
  - `record-start`: create a `TranscriptSession`, call `createTranscriptRun`, instantiate Deepgram/VAD, wire transcript/status/error handlers, and set context state to `recording`.
  - `record-stop`: stop consumers, persist final chunks with `completed: true`, and reset state.
  - `command` (`MAP_DOM`, `SMART_FILL`, `SEND_NOTE`, `UNDO_LAST`): invoke DOM analyzer for `MAP_DOM`, optionally update patient link, and emit `AutopilotMessage` stubs.

### Outbound helper
`send(context, msg)` must guard on `readyState` and catch send errors to avoid crashes.

### Close/error handling
- On close: stop active consumers, mark completion, set `state="closed"`.
- On error: log, set `state="error"`, optionally emit a status message.

## Patient Utility (`backend/utils/patient.ts`)
### Types
```ts
export interface PatientCard {
  name: string;
  dob: string;
  mrn: string;
  reason: string;
  sex: "M" | "F" | "O";
  sessionId: string | null;
  doctor: string;
  autopilotReady: boolean;
  lastTranscript: string | null;
}
```

### Behavior
- `getPatientCardForUser(userId)` fetches the latest transcript; returns a demo profile if none exists.
- When a row exists, use `patient_code` for MRN, `transcript` (or fallback) for reason, and `completed_at != null` for `autopilotReady`.

## DOM Mapping Utility (`backend/utils/dom.ts`)
### Types
```ts
export interface DomField {
  kind: "text" | "textarea" | "number" | "date";
  label?: string;
  selector: string;
  value?: string;
}

export interface DomSnapshot {
  url: string;
  fields: DomField[];
}

export interface DomMappingResult {
  patientUuid: string | null;
  patientCode: string | null;
  surfacesFound: number;
}
```

### Behavior
- `analyzeDomSnapshot(snapshot)` handles malformed input gracefully (returns nulls and `surfacesFound = 0`).
- Baseline implementation: `surfacesFound = snapshot.fields.length`, `patientUuid = null`, `patientCode = null`.

## CNS Server (`backend/server.ts`)
### Environment
- `PORT` (default 8787).
- `DEEPGRAM_API_KEY` (required).
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (required indirectly by `getSupabaseClient`).

### Responsibilities
- Create an Express app with routes:
  - `GET /health` → `{ ok: true, service: "cns-backend", uptime: <number> }`.
  - `GET /demo/patient` → returns `PatientCard` for current/placeholder user.
  - `GET /transcripts/:id` → validate numeric id; fetch row or return `{ ok: false, error: "Not found" }`.
- Create HTTP server + WebSocket server (`/ws`), attach broker with ASR credentials.
- Optional graceful shutdown on SIGINT/SIGTERM.

## Configuration (Env)
- `ASR_API_KEY` (e.g., `DEEPGRAM_API_KEY`)
- `DB_URL` (e.g., `SUPABASE_URL`)
- `DB_SERVICE_ROLE_KEY` (e.g., `SUPABASE_SERVICE_ROLE_KEY`)
- `CNS_PORT` (default 8787)
- `DEMO_DOCTOR_ID` (fallback user id when auth is not wired)
- Missing ASR/DB keys should log clear errors and emit status messages without crashing.

## Behavioral Scenarios
- **Health:** `GET /health` responds with readiness info and feed status.
- **Malformed WS JSON:** server catches parse errors and replies with a backend error status without crashing.
- **VAD silence:** silence produces no transcript chunks; overlay may stay in a listening state.
- **Speaker rollover:** a new chunk starts when speaker id changes.
- **30s cap:** a chunk finalizes when duration exceeds 30 seconds.
- **No dashboard:** CNS + extension + DB + ASR is sufficient for full functionality.

## Reserved / Future Feeds
- Additional feeds (Alerts, Summary, Compliance) can reuse the same broker and status patterns even if inactive initially.
