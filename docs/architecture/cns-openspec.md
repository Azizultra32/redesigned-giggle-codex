# CNS Backend OpenSpec

This document defines a generic Central Nervous System (CNS) backend that powers a browser extension overlay with real-time transcription, diarization, and patient-aware autopilot hooks. It is intentionally free of project-specific branding and is meant to be handed to any coding agent with the instruction: **"Implement exactly this."**

## 0. Purpose

The CNS backend:
- Receives live audio from a browser extension via WebSocket.
- Streams audio to a real-time ASR provider (for example, Deepgram) with diarization.
- Aggregates ASR word events into speaker-labelled chunks no longer than 30 seconds.
- Persists transcripts and chunks in a Postgres/Supabase table named `transcripts2`.
- Exposes HTTP endpoints for a patient card view and transcript retrieval.
- Maintains a WebSocket hub for transcript updates, status, autopilot, and VAD events.
- Integrates with VAD and DOM mapping/autopilot hooks without mandating a full implementation yet.

## 1. System Layout (Backend Folder)

Expected layout (names can vary if behavior matches):

```
backend/
  server.ts                  # HTTP+WS entrypoint
  types.ts                   # shared types

  audio/
    deepgram-consumer.ts     # ASR/diarization client wrapper
    vad-consumer.ts          # VAD wrapper (interface + minimal implementation)

  ws/
    broker.ts                # WebSocket hub between UI and audio pipeline

  supabase/
    client.ts                # DB client
    transcripts.ts           # DB access layer for transcripts2

  utils/
    diarization.ts           # reusable diarization/chunking logic
    patient.ts               # maps DB rows to patient card
    dom.ts                   # DOM snapshot analysis (patient mapping, surfaces)
```

## 2. Global Data Contracts (`backend/types.ts`)

### 2.1 Core Types

```ts
export type ConsumerState =
  | "idle"
  | "connecting"
  | "connected"
  | "error"
  | "closed";

export interface TranscriptChunk {
  speaker: number;      // diarization speaker id
  text: string;         // aggregated text for chunk
  start: number;        // seconds from start of session
  end: number;          // seconds from start of session
  isFinal: boolean;     // true once chunk is closed
}

export interface TranscriptPayload {
  finalized: TranscriptChunk[];      // all finalized chunks so far
  interim: TranscriptChunk | null;   // current open chunk, if any
  fullText: string;                  // full flattened transcript text
}

export interface TranscriptSession {
  sessionId: string;                 // uuid for this recording session
  transcriptId: number | null;       // database transcripts2.id
  userId: string | null;

  patientCode: string | null;        // generated encounter code
  patientUuid: string | null;        // external/EMR patient id

  startedAt: number;                 // Date.now() at record-start
  stoppedAt: number | null;

  fullText: string;
  chunks: TranscriptChunk[];

  deepgram: import("../audio/deepgram-consumer").DeepgramConsumer;
  vad: import("../audio/vad-consumer").VADConsumer;
}
```

### 2.2 WebSocket Client Context

```ts
export type ClientState =
  | "idle"
  | "recording"
  | "stopping"
  | "error"
  | "closed";

export interface ClientContext {
  id: string;                        // uuid per WS connection
  ws: import("ws").WebSocket;
  state: ClientState;
  session: TranscriptSession | null; // active recording, if any
  userId: string | null;             // future use
}
```

### 2.3 WebSocket Message Contracts

**Inbound from browser overlay**

```ts
export type WsInboundMessage = AudioMessage | EventMessage;

export interface AudioMessage {
  kind: "audio";
  sessionId?: string;          // optional frontend session handle
  format: "pcm16";
  sampleRate: 16000;
  chunkId: number;             // monotonic per client
  data: string;                // base64-encoded PCM 16-bit mono
}

export interface EventMessage {
  kind: "event";
  event: "record-start" | "record-stop" | "command";
  commandName?:
    | "MAP_DOM"
    | "SMART_FILL"
    | "SEND_NOTE"
    | "UNDO_LAST";
  domSnapshot?: unknown;       // raw DOM snapshot object from overlay
  patientContext?: unknown;    // optional patient details discovered in UI
  sessionId?: string;          // overlay’s reference if available
}
```

**Outbound to browser overlay**

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
  chunkStart: number | null;   // seconds
  chunkEnd: number | null;     // seconds
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
  lastAction?:
    | "mapped_fields"
    | "sent_note"
    | "smart_fill_executed";
}
```

## 3. Database Client (`backend/supabase/client.ts`)

### 3.1 Environment

Required environment variables (backend only, never exposed to the browser):
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

### 3.2 API

```ts
import { SupabaseClient } from "@supabase/supabase-js";

export function getSupabaseClient(): SupabaseClient;
```

### 3.3 Behavior

- On first call, if either environment variable is missing, throw a clear error.
- Create a `SupabaseClient` with `auth: { persistSession: false }`.
- Cache and return the client on subsequent calls.
- No application logic beyond client creation.

## 4. Transcript DB Access (`backend/supabase/transcripts.ts`)

### 4.1 Target Table (generic)

The database table `transcripts2` includes at least:

- `id` bigint primary key
- `user_id` uuid
- `patient_code` text
- `patient_uuid` uuid nullable
- `language` text
- `transcript` text
- `transcript_chunk` jsonb[]
- `ai_summary` jsonb nullable
- `ai_short_summary` jsonb nullable
- `ai_interim_summaries` jsonb[] nullable
- `created_at` timestamptz
- `completed_at` timestamptz nullable
- `error` text nullable

### 4.2 Types

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

export interface TranscriptRow {
  id: number;
  user_id: string | null;
  patient_code: string;
  patient_uuid: string | null;
  transcript: string | null;
  transcript_chunk: any[] | null;
  ai_summary: any | null;
  ai_short_summary: any | null;
  ai_interim_summaries: any[] | null;
  created_at: string;
  completed_at: string | null;
}
```

### 4.3 Functions

`createTranscriptRun(input): Promise<CreateTranscriptRunResult>`

- Compute `finalPatientCode`:

```ts
const finalPatientCode =
  input.patientCode ??
  `PT-${Date.now().toString(36).toUpperCase()}-${Math.random()
    .toString(16)
    .slice(2, 6)
    .toUpperCase()}`;
```

- Insert into `transcripts2` and return `{ id, patientCode: returned_patient_code }`.
- Throw on any Supabase error.

`saveTranscriptChunks(transcriptId, chunks, options): Promise<void>`

- Build patch:

```ts
const patch: Record<string, any> = {
  transcript_chunk: chunks,
};
if (options?.fullTranscript !== undefined) {
  patch.transcript = options.fullTranscript;
}
if (options?.completed) {
  patch.completed_at = new Date().toISOString();
}
```

- Update `transcripts2` where `id = transcriptId`; throw on error.

`updatePatientLink(transcriptId, data): Promise<void>`

- Build a minimal patch with provided keys and update the row; throw on error.

`getLatestTranscriptForUser(userId): Promise<TranscriptRow | null>`

- Return `null` if `userId` is `null`.
- Query most recent transcript for the user; return row or `null`.

## 5. Diarization Utility (`backend/utils/diarization.ts`)

Generic utility to assemble word streams into diarized chunks.

### 5.1 Types

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

### 5.2 Class API

```ts
export class DiarizationAssembler {
  constructor(options?: DiarizationOptions);

  snapshot(): DiarizationResult;

  ingest(words: DiarizationWord[], opts?: { isFinal?: boolean }): DiarizationResult;

  ingestDeepgramEvent(event: DeepgramEventLike): DiarizationResult;
}
```

### 5.3 Behavior

- Maintain `currentChunk`, `persisted`, and `fullText`.
- Start a new chunk when the speaker changes or when a chunk would exceed `maxChunkDurationSeconds`.
- When `opts.isFinal === true` or `event.is_final === true`, finalize the current chunk.
- Append finalized chunk text to `fullText`, separated by newlines.

## 6. ASR Consumer (`backend/audio/deepgram-consumer.ts`)

- Uses `DiarizationAssembler` to aggregate events into `TranscriptPayload`.
- Emits payloads to upper layers rather than writing directly to the database.

## 7. VAD Consumer (`backend/audio/vad-consumer.ts`)

A minimal interface with stub-friendly behavior.

### 7.1 Types

```ts
export type VADState =
  | "idle"
  | "running"
  | "error"
  | "stopped";

export interface VADConsumerOptions {
  sampleRate?: number;         // default 16000
  frameSizeMs?: number;        // default 20
  silenceTimeoutMs?: number;   // default 5000
  autoStart?: boolean;         // default false
  autoStop?: boolean;          // default false
}

export type VADStatusHandler = (state: VADState) => void;
export type VADSpeechHandler = (event: {
  type: "speech-start" | "speech-end";
  at: number;                  // timestamp or seconds
}) => void;

export type VADCommandHandler = (event: {
  phrase: string;
  at: number;
}) => void;
```

### 7.2 Class

```ts
export class VADConsumer {
  constructor(options?: VADConsumerOptions);

  start(handlers?: {
    status?: VADStatusHandler;
    speech?: VADSpeechHandler;
    command?: VADCommandHandler;
  }): void;

  handleAudio(buffer: Buffer): void;

  stop(): void;
}
```

- Maintain internal `VADState` and invoke status handlers on transitions.
- `handleAudio` can be a no-op for MVP; optionally emit `speech-start`/`speech-end` based on RMS thresholds.

## 8. WebSocket Broker (`backend/ws/broker.ts`)

Central hub between overlay and CNS pipeline.

### 8.1 API

```ts
import { WebSocketServer } from "ws";

export interface BrokerOptions {
  deepgramApiKey: string;
}

export function attachBroker(wss: WebSocketServer, options: BrokerOptions): void;
```

### 8.2 Connection Lifecycle

- On connection, create a `ClientContext` with `state = "idle"`, `session = null`, and `userId = null`.
- Register `message`, `close`, and `error` handlers.

### 8.3 Message Handling

- Parse JSON; on failure, send a backend error status.
- Route `AudioMessage` to `handleAudioMessage` and `EventMessage` to `handleEventMessage`; send an error status for unknown kinds.

#### 8.3.1 `handleEventMessage`

- `record-start`:
  - Ignore if already recording or send status.
  - Create a `TranscriptSession` with new `sessionId` and `startedAt`.
  - Call `createTranscriptRun` with `userId`, `patientCode`, and `patientUuid` if provided.
  - Store returned `transcriptId` and `patientCode`.
  - Instantiate `DeepgramConsumer` and `VADConsumer`.
  - Wire transcript handler to update `session.chunks` and `session.fullText`, persist via `saveTranscriptChunks`, and send `TranscriptUpdateMessage`.
  - Wire status/error handlers to send `StatusMessage` events.
  - Set `context.state = "recording"` and attach the session.
- `record-stop`:
  - If a session exists, stop consumers, save chunks with `completed: true`, set state back to `idle`, and clear the session.
- `command`:
  - For `MAP_DOM`, call `analyzeDomSnapshot`; if patient IDs are discovered and a transcript exists, call `updatePatientLink`; send an `AutopilotMessage` noting `surfacesFound` and `lastAction: "mapped_fields"`.
  - For `SMART_FILL`, `SEND_NOTE`, and `UNDO_LAST`, send stub status/autopilot messages for now.

#### 8.3.2 `handleAudioMessage`

- Validate format/sample rate and presence of data; decode base64 to `Buffer`.
- If not recording or session missing, optionally warn; otherwise forward audio to both `DeepgramConsumer` and `VADConsumer` via `handleAudio`.

### 8.4 Outbound Helper

`send(context, msg)` serializes the message to JSON if the socket is open; log and ignore on send errors.

### 8.5 Close / Error

- On close, stop active consumers, mark session completed, and set state to `closed`.
- On error, log, set state to `error`, and optionally send a backend status message if the socket is still open.

## 9. Patient Utility (`backend/utils/patient.ts`)

### 9.1 Types

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

### 9.2 API

```ts
export async function getPatientCardForUser(
  userId: string | null
): Promise<PatientCard>;
```

### 9.3 Behavior

- Call `getLatestTranscriptForUser(userId)`.
- If no row exists, return a static demo profile with `autopilotReady = false`.
- If a row exists, derive MRN from `patient_code`, reason from `transcript` or a fallback, and set `autopilotReady` when `completed_at` is not null.

## 10. DOM Mapping Utility (`backend/utils/dom.ts`)

### 10.1 Types

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

### 10.2 API

```ts
export function analyzeDomSnapshot(snapshot: DomSnapshot): DomMappingResult;
```

### 10.3 Behavior

- Handle malformed snapshots safely, returning null IDs and `surfacesFound = 0`.
- Baseline logic: `surfacesFound = snapshot.fields.length`, `patientUuid = null`, `patientCode = null`.
- Future heuristics may use labels/values to infer patient identifiers.

## 11. CNS Server (`backend/server.ts`)

### 11.1 Environment

- `PORT` (default 8787)
- `DEEPGRAM_API_KEY` (required)
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` required via Supabase client

### 11.2 Responsibilities

- Create an Express app.
- Routes: `GET /health`, `GET /demo/patient`, `GET /transcripts/:id`.
- Create HTTP server and WebSocket server at `/ws`, then attach the broker with ASR credentials.
- Optionally handle `SIGINT`/`SIGTERM` to close servers gracefully.

### 11.3 HTTP Routes

`/health`
- Returns `{ ok: true, service: "cns-backend", uptime: <number> }`.

`/demo/patient`
- Uses a `userId` (static or null) to call `getPatientCardForUser` and returns its result.

`/transcripts/:id`
- Parse `id` as an integer; return 400 on invalid input.
- Query `transcripts2` via Supabase; return transcript payload or `{ ok: false, error: "Not found" }`.

### 11.4 WebSocket Setup

- Create `WebSocketServer` bound to the HTTP server at path `/ws`.
- Call `attachBroker(wss, { deepgramApiKey: process.env.DEEPGRAΜ_API_KEY! });`.

### 11.5 Shutdown

- Optionally listen for termination signals to close the WS and HTTP servers and exit cleanly.

---

This OpenSpec captures the end-to-end CNS backend contract, including WebSocket/HTTP APIs, ASR + diarization behavior, database integration, VAD hooks, and DOM mapping/autopilot interfaces. It is designed to remain fully generic, enabling implementation without leaking any project-specific branding or paths.
