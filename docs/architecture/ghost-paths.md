# GHOST Layout and Paths

## 0. High-level layout
```
ghost/
  backend/      ← CNS / Agent / Deepgram / Supabase
  extension/    ← Ferrari overlay Chrome MV3
  scripts/      ← start-mcp, build, smoke
  docs/         ← truth sources
```

## 1. Path A — Extension → Backend (direct WS)
Sequence:
1. Doctor opens EHR page.
2. `extension/content.js` injects `overlay.js` via `assistmd-root` container.
3. `overlay.js` builds the Ferrari UI (SOAP/Summary/Tasks/Transcript tabs) inside a Shadow DOM, wiring buttons (`Record`, `Map`, `Smart Fill`, `Send`, `Undo`, `Dictate`) and transcript view. DOM mapping exposes `window.Anchor.*` (map, fill, send, undo, dictate).
4. `overlay.js` opens `ws://localhost:8787/ws` and exchanges:
   - Outbound: `{type: "audio", data: <PCM>}`, `{type: "command", action: "map_current_page", payload}`, `{type: "dictate_start"|"dictate_stop"}`.
   - Inbound: `{type: "transcript"|"status"|"alert", data: ...}`.
5. `backend/server.ts` handles `/ws`: registers client with WsBridge, routes audio to `DeepgramConsumer.handleAudio`, routes commands to Autopilot/DOM/Smart Fill handlers, toggles VAD/Voice Concierge.
6. `backend/audio/deepgram-consumer.ts` streams PCM to Deepgram, emits `transcript`/`error` events. `server.ts` forwards transcripts via WsBridge.
7. WsBridge broadcasts `{transcript|status|alert}` to all clients.
8. `overlay.js` appends transcript chunks (speaker, text, timings, confidence, raw words) and updates status/alert UI (Autopilot pill, errors).

Files: `extension/content.js`, `extension/overlay.js`, `backend/server.ts`, `backend/audio/deepgram-consumer.ts`, `backend/ws/broker.ts` (if split).

## 2. Path B — Extension + MCP/Console → Backend
Sequence:
1. `scripts/start-mcp.sh` kills old Chrome, builds `extension/dist-bundle`, launches Chrome with remote-debugging + extension loaded, then runs `scripts/mcp-helper.mjs` to connect DevTools, enable extension, and open the demo EHR (or target URL). Keeps DevTools open for agents.
2. MCP tools (`scripts/mcp-helper.mjs` or `tools/rtfmbro-mcp/context7`) expose actions like `anchor_map_page`/`anchor_fill_fields` that execute in the EHR tab: `window.Anchor.mapCurrentPage()`, `window.Anchor.fill(...)`.
3. `overlay.js` + WebSocket behave exactly like Path A (same WS, same UI). Difference: MCP issues the button actions programmatically via DevTools instead of a human click.
4. Backend pieces (`server.ts`, `deepgram-consumer.ts`, WsBridge) are identical to Path A.

Files: `scripts/start-mcp.sh`, `scripts/build-extension.mjs`, `tools/context7/`, `tools/rtfmbro-mcp/`, plus the Path A components.

## 3. Path C — Backend → Supabase (`public.transcripts2`)
Table columns: `id bigint PK`, `user_id uuid`, `created_at timestamptz`, `ai_summary jsonb`, `ai_short_summary jsonb`, `ai_interim_summaries jsonb[]`, `transcript_chunk jsonb[]`, `transcript text`, `patient_code text not null default ''`, `patient_uuid uuid`, `patient_tag int`, `language text`, `error text`, etc.

Flow:
1. Deepgram transcript events arrive in `backend/audio/deepgram-consumer.ts`, parsed into `words[]` with speaker/start/end. Chunk assembler builds `TranscriptChunkPayload` items (`speaker`, `text`, `start`, `end`, `word_count`, `raw`).
2. Chunks accumulate in memory (`persistedChunks`, `transcriptParts`).
3. `saveTranscriptChunks(transcriptId, chunks, { fullTranscript?, completed? })` persists to Supabase.
4. `backend/lib/supabase.ts`:
   - `getSupabase()` uses `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (or anon for dev).
   - `createTranscriptRun({ doctorId, patientCode, patientUuid, language })` inserts a `transcripts2` row with empty `transcript_chunk`/`ai_interim_summaries` and returns identifiers.
   - `saveTranscriptChunks(...)` updates `transcript_chunk`, optional `transcript`, and `completed_at` when finished.

## 4. Path D — Backend → Dashboard (Control Center)
Sequence:
1. `backend/server.ts` hosts WsBridge on `/ws` with feeds (A: Deepgram, B: Voice Concierge, C: Emergency, D: Patient Summary, E: Compliance).
2. On connection, WsBridge hydrates client with feed status. On events, it broadcasts transcript/status/alert/command per feed.
3. Dashboard app (future `dashboard/` or `apps/assist-dashboard/`) connects to `/ws`, rendering feed tiles, live transcript log, alerts, and quick actions (Map, Smart Fill, Autopilot check via backend routes).

Files: `backend/server.ts`, `backend/ws/broker.ts` (if split), future `dashboard/` consumer.

## 5. Path E — DOM Mapping & Smart Fill
Forward (Map):
1. `overlay.js` "Map" builds DOM snapshot (`mapDom(document.body)`) capturing patient info and fields.
2. Sends via WS or HTTP (`/dom`) as `{ map, patient }`.
3. Backend (`routes/transcripts.ts` or `routes/dom.ts`) normalizes to canonical JSON, updates `transcripts2` patient metadata, and may store interim summaries/metadata.

Backward (Smart Fill / Send / Undo):
1. `POST /actions/fill` receives `{ transcriptId, mapId, plan, fields }`.
2. Backend may call LLM to expand plan sections, then converts plan+DOM mapping into browser steps (`focus`, `setValue`, `insertText`, etc.) and responds `{ ok, steps, planSummary }`.
3. `overlay.js` posts `{type:'assistmd/fill', steps}` to the page; content handler executes against selectors, updating fields and showing progress/confirmation.

## 6. Path F — MCP / Context7 / Supabase AI (out-of-band)
1. `tools/context7/` MCP server exposes `supabase_query`, `deepgram_docs`, etc., using configured Supabase credentials for schema/doc lookups.
2. `tools/rtfmbro-mcp/` exposes Chrome/DevTools controls (`open_url`, `run_script_in_tab`, `window.Anchor.*` helpers) for external agents.
3. Backend is unchanged; only `scripts/start-mcp.sh` needs to launch Chrome with extension + MCP hooks.

## 7. Path unification
- One overlay (`extension/overlay.js`) and one backend (`backend/server.ts` + `backend/audio/deepgram-consumer.ts` + `backend/supabase/*`).
- Two launch modes: human-driven (load extension + backend) and MCP-driven (`scripts/start-mcp.sh` loads extension + DevTools + backend). Both use the same WS contract and DOM APIs.
