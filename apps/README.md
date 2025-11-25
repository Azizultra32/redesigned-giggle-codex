# AssistMD Truth Package - Applications

This directory contains the two main applications of the AssistMD system:

## apps/cns-agent/ - Backend Server

The CNS (Clinical Notation System) Agent is the Node.js backend that handles:
- **Deepgram Integration**: Real-time audio transcription with speaker diarization
- **Supabase Storage**: Transcript persistence using `transcripts2` table only
- **WebSocket Feeds**: Broadcasting transcripts, alerts, and commands via Feed A-E model
- **HTTP API**: Patient management, transcript retrieval, and DOM binding

### Quick Start
```bash
cd apps/cns-agent
cp .env.example .env
# Edit .env with your credentials
npm install
npm run dev
```

### API Endpoints
- `GET /health` - Health check with feed statuses
- `GET /demo/patient` - Generate ephemeral patient code
- `POST /dom` - Bind patient via DOM scan
- `GET /patient/current?userId=<uuid>` - Get latest transcript
- `GET /transcripts/:id` - Get specific transcript

### WebSocket
- `ws://localhost:3001/ws?userId=<uuid>` - Connect for real-time updates

See [../../docs/ASSISTMD_TRUTH_PACKAGE.md](../../docs/ASSISTMD_TRUTH_PACKAGE.md) for full API documentation.

---

## apps/overlay/ - Chrome Extension

The AssistMD Ghost Overlay is a Chrome MV3 extension that provides:
- **Ferrari UI**: Floating Shadow DOM interface for EHR pages
- **Audio Capture**: 16kHz PCM recording via WebAudio
- **Real-time Display**: Live transcript with speaker labels
- **DOM Scanning**: Automatic patient info extraction from EHR
- **WebSocket Client**: Feed A-E status monitoring

### Quick Start
```bash
cd apps/overlay
npm install
npm run build
```

### Load Extension
1. Open Chrome: `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select `apps/overlay/` directory

### Keyboard Shortcuts
- `Alt+G` - Toggle overlay visibility
- `Alt+R` - Start/stop recording

---

## Architecture

```
┌─────────────────┐         WebSocket          ┌──────────────────┐
│  Chrome Ext     │◄───────────────────────────►│  CNS Agent       │
│  (apps/overlay) │     Audio PCM + Events     │  (apps/cns-agent)│
│                 │                             │                  │
│  - Audio Capture│                             │  - Deepgram ASR  │
│  - Ferrari UI   │                             │  - WsBridge      │
│  - DOM Scanner  │                             │  - ChunkAssembler│
└─────────────────┘                             └────────┬─────────┘
                                                         │
                                                         ▼
                                                ┌─────────────────┐
                                                │  Supabase       │
                                                │  (transcripts2) │
                                                └─────────────────┘
```

---

## Development Workflow

1. **Start Backend**:
   ```bash
   cd apps/cns-agent && npm run dev
   ```

2. **Build Extension**:
   ```bash
   cd apps/overlay && npm run build
   ```

3. **Load Extension in Chrome** (see above)

4. **Or use MCP script** (automated):
   ```bash
   ./scripts/start-mcp.sh
   ```

---

## Key Concepts

### Two-Phase Patient Identity
1. **Ephemeral** (Recording Start): Generate `PT-XXXX-XXXX` code immediately
2. **Real** (DOM Binding): Link to actual patient UUID after DOM scan

### WebSocket Feed Model
- **Feed A**: Deepgram Transcription
- **Feed B**: Voice Concierge (future)
- **Feed C**: Emergency Monitor (future)
- **Feed D**: Patient Summary (future)
- **Feed E**: Compliance Audit (future)

### Chunk Assembly
Words from Deepgram are aggregated into 30-second speaker-specific chunks before database write.

---

For complete documentation, see:
- [AssistMD Truth Package](../../docs/ASSISTMD_TRUTH_PACKAGE.md) - Full system specification
- [Supabase Schema](../../docs/architecture/SUPABASE_SCHEMA.md) - Database reference

---

**Status**: ✅ Implemented  
**Version**: 1.0.0  
**Last Updated**: 2025-11-25
