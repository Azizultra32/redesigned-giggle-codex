# AssistMD Truth Package

Voice-powered clinical documentation platform with real-time transcription and EHR integration.

**Implementation Status**: ✅ Core architecture complete (Option A)

## Quick Start

```bash
# 1. Start backend
cd apps/cns-agent && npm install && cp .env.example .env
# Edit .env with your DEEPGRAM_API_KEY and SUPABASE credentials
npm run dev

# 2. Build extension
cd apps/overlay && npm install && npm run build

# 3. Load in Chrome
# chrome://extensions/ → Developer mode → Load unpacked → select apps/overlay/

# 4. Or launch with MCP (automated)
./scripts/start-mcp.sh
```

**Keyboard shortcuts:** 
- `Alt+G` - Toggle overlay visibility
- `Alt+R` - Start/stop recording

---

## Documentation

### 📘 Primary Documentation
- **[AssistMD Truth Package](docs/ASSISTMD_TRUTH_PACKAGE.md)** ⭐ - Complete system specification
- **[Apps README](apps/README.md)** - Backend and extension overview
- **[Supabase Schema](docs/architecture/SUPABASE_SCHEMA.md)** - Database reference

### Specifications (`docs/SPEC/`)
| File | Description |
|------|-------------|
| [diarized-transcript.md](docs/SPEC/diarized-transcript.md) | Deepgram payload, chunking rules |
| [supabase-transcripts.md](docs/SPEC/supabase-transcripts.md) | Database schema, queries |
| [overlay-control.md](docs/SPEC/overlay-control.md) | UI state machine, components |
| [agent-contract.md](docs/SPEC/agent-contract.md) | WebSocket message contracts |
| [roadmap.md](docs/SPEC/roadmap.md) | Phase 1-4 implementation plan |

### System Maps (`docs/SYSTEM_MAP/`)
| File | Description |
|------|-------------|
| [FULL_STACK.txt](docs/SYSTEM_MAP/FULL_STACK.txt) | Complete system diagram |
| [OVERLAY.txt](docs/SYSTEM_MAP/OVERLAY.txt) | Extension architecture |
| [AGENT.txt](docs/SYSTEM_MAP/AGENT.txt) | Backend architecture |
| [SUPABASE.txt](docs/SYSTEM_MAP/SUPABASE.txt) | Database schema diagram |
| [MCP.txt](docs/SYSTEM_MAP/MCP.txt) | Chrome MCP integration |

### Operations (`docs/ANTIGRAVITY/`)
| File | Description |
|------|-------------|
| [PLAYBOOK.md](docs/ANTIGRAVITY/PLAYBOOK.md) | Daily workflows |
| [MCP_BOOT.md](docs/ANTIGRAVITY/MCP_BOOT.md) | MCP startup sequence |
| [CHECKLIST.md](docs/ANTIGRAVITY/CHECKLIST.md) | Verification checklists |

### Troubleshooting (`docs/TROUBLESHOOT/`)
| File | Description |
|------|-------------|
| [deepgram-errors.md](docs/TROUBLESHOOT/deepgram-errors.md) | Deepgram error guide |
| [supabase-errors.md](docs/TROUBLESHOOT/supabase-errors.md) | Supabase error guide |

### Additional Notes
- [supabase-notes.md](docs/supabase-notes.md) — Setup and queries
- [mcp-notes.md](docs/mcp-notes.md) — MCP quick reference
- [transcript-migration-plan.md](docs/transcript-migration-plan.md) — Schema migration

---

## Project Structure

```
turbo-enigma/
├── apps/                       # Main applications
│   ├── cns-agent/              # Backend Server (Express + WebSocket)
│   │   ├── src/
│   │   │   ├── types/          # TypeScript interfaces
│   │   │   ├── lib/            # Supabase, WsBridge
│   │   │   ├── audio/          # Deepgram, ChunkAssembler
│   │   │   └── server.ts       # Main HTTP/WS server
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── .env.example
│   │
│   └── overlay/                # Chrome MV3 Extension
│       ├── src/
│       │   ├── overlay.ts      # Ferrari UI (Shadow DOM)
│       │   ├── content.ts      # Content script
│       │   ├── background.ts   # Service worker
│       │   ├── audio-capture.ts# PCM recorder
│       │   └── ui/             # UI components
│       ├── manifest.json
│       └── package.json
│
├── supabase/                   # Database Schemas
│   ├── transcripts2-schema.sql
│   ├── rls-policies.sql
│   └── seed.sql
│
├── docs/                       # Documentation
│   ├── ASSISTMD_TRUTH_PACKAGE.md ⭐ Main spec
│   ├── architecture/
│   │   └── SUPABASE_SCHEMA.md
│   ├── SPEC/                   # Legacy specs
│   ├── SYSTEM_MAP/             # Architecture diagrams
│   └── TROUBLESHOOT/           # Error guides
│
├── scripts/                    # Build & Launch
│   ├── start-mcp.sh            # MCP automation
│   └── build-extension.mjs
│
├── backend/                    # Legacy (deprecated)
└── extension/                  # Legacy (deprecated)
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    AssistMD Truth Package                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────┐    WebSocket     ┌─────────────────────────┐  │
│  │  Chrome Ext     │◄──────────────►  │    Backend Server       │  │
│  │  (Ferrari       │    Audio PCM     │    (Express + WS)       │  │
│  │   Overlay)      │    + Events      │                         │  │
│  │                 │                  │  ┌───────────────────┐  │  │
│  │  ┌───────────┐  │                  │  │   Deepgram ASR    │  │  │
│  │  │ Shadow    │  │                  │  │   (nova-2 +       │  │  │
│  │  │ DOM UI    │  │                  │  │   diarization)    │  │  │
│  │  └───────────┘  │                  │  └───────────────────┘  │  │
│  │                 │                  │           │             │  │
│  │  ┌───────────┐  │  Transcript      │           ▼             │  │
│  │  │ Audio     │  │◄─────────────────│  ┌───────────────────┐  │  │
│  │  │ Capture   │  │                  │  │   ChunkAssembler  │  │  │
│  │  │ (16kHz)   │  │                  │  │   (30s chunks)    │  │  │
│  │  └───────────┘  │                  │  └────────┬──────────┘  │  │
│  └─────────────────┘                  │           │             │  │
│                                       │           ▼             │  │
│                                       │  ┌───────────────────┐  │  │
│                                       │  │   Supabase DB     │  │  │
│                                       │  │   (transcripts2)  │  │  │
│                                       │  └───────────────────┘  │  │
│                                       └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Features

1. **Two-Phase Patient Identity**
   - Phase 1 (Ephemeral): Recording starts with `PT-XXXX-XXXX` code
   - Phase 2 (Real): Bind to actual patient UUID after DOM scan

2. **WebSocket Feed Model (A-E)**
   - Feed A: Deepgram Transcription (implemented)
   - Feed B: Voice Concierge (future)
   - Feed C: Emergency Monitor (future)
   - Feed D: Patient Summary (future)
   - Feed E: Compliance Audit (future)

3. **Chunk Assembly**
   - Words from Deepgram aggregated into 30-second speaker chunks
   - Stored in `transcript_chunk` JSONB array
   - Preserves word-level data for analysis

4. **Single Table Architecture**
   - Only `transcripts2` table (no sessions/transcripts/doctors)
   - One row = one recording session
   - All data in one place (no joins needed)

---

## Environment Variables

### Backend (`apps/cns-agent/.env`)
```env
PORT=3001
DEEPGRAM_API_KEY=your_deepgram_key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_key  # NOT anon key!
DEMO_DOCTOR_ID=00000000-0000-0000-0000-000000000000
```

**Important**: Backend requires `SUPABASE_SERVICE_ROLE_KEY` (not anon key) to bypass RLS.

**Note**: Without Supabase credentials, backend runs in offline mode (no persistence).

---

## API Endpoints

### HTTP
- `GET /health` - Health check with feed statuses
- `GET /demo/patient` - Generate ephemeral patient code
- `POST /dom` - Bind patient via DOM scan
- `GET /patient/current?userId=<uuid>` - Get latest transcript
- `GET /transcripts/:id` - Get specific transcript

### WebSocket
- `ws://localhost:3001/ws?userId=<uuid>` - Real-time updates

See [AssistMD Truth Package](docs/ASSISTMD_TRUTH_PACKAGE.md) for complete API documentation.

---

## Migration from Legacy

This repo implements "Option A" (Clean Repo Spec) which:
- ✅ Moves from dual-world chaos to single canonical agent
- ✅ Aligns schema to use only `transcripts2` table
- ✅ Implements two-phase patient identity flow
- ✅ Uses WsBridge for Feed A-E model
- ✅ Aggregates words into 30-second chunks via ChunkAssembler

### What Changed
- `sessions` table → **NO** sessions table (transcripts2 serves same purpose)
- `transcripts` table → `transcripts2` table
- `doctors` table → `auth.users` + env var
- Multi-insert → Single-insert atomic writes

### What Stayed the Same
- Deepgram integration (nova-2, diarization)
- WebSocket event model
- DOM scanning
- Overlay UI structure

---

## For AI Coding Agents

When building features:

1. **Backend changes** → Read `docs/ASSISTMD_TRUTH_PACKAGE.md` section 6 (Data Flow)
2. **Extension changes** → Read `apps/README.md` overlay section
3. **Database changes** → Use `supabase/transcripts2-schema.sql` as source of truth
4. **Troubleshooting** → Check section 8 in `docs/ASSISTMD_TRUTH_PACKAGE.md`

**Critical**: 
- There are NO `sessions`/`transcripts`/`doctors` tables, only `transcripts2`
- Patient identity is two-phase (ephemeral → real)
- Chunks are aggregated server-side before DB write
- WebSocket uses labeled feeds (A-E), not direct transcript events

---

## License

Proprietary - All rights reserved
