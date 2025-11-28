/**
 * AssistMD Truth Package - Type Definitions
 * 
 * All interfaces for the CNS Agent system
 */

// ============================================================================
// Deepgram & Audio
// ============================================================================

export interface WordResult {
  word: string;
  start: number;
  end: number;
  confidence: number;
  speaker: number;
}

export interface TranscriptEvent {
  type: 'interim' | 'final' | 'utterance_end';
  text: string;
  speaker: number;
  start: number;
  end: number;
  confidence: number;
  words: WordResult[];
  isFinal: boolean;
}

// ============================================================================
// Transcript Chunks
// ============================================================================

export interface TranscriptChunk {
  speaker: number;
  text: string;
  start: number;
  end: number;
  word_count: number;
  raw: WordResult[];
}

// ============================================================================
// WebSocket Feed Model (A-E)
// ============================================================================

export type FeedId = 'A' | 'B' | 'C' | 'D' | 'E';
export type FeedStatus = 'connected' | 'disconnected' | 'ready' | 'error';

export interface FeedInfo {
  feed: FeedId;
  label: string;
  status: FeedStatus;
  timestamp: string;
  tabId?: string;
}

export interface StatusMessage {
  type: 'status';
  data: FeedInfo;
}

export interface TranscriptMessage {
  type: 'transcript';
  data: {
    feed: FeedId;
    text: string;
    isFinal: boolean;
    confidence: number;
    speaker: number;
    tabId?: string;
    timestamp: string;
  };
}

export interface AlertMessage {
  type: 'alert';
  data: {
    feed: FeedId;
    severity: 'critical' | 'warning' | 'info';
    message: string;
    keywords?: string[];
    timestamp: string;
  };
}

export interface CommandPayload {
  intent?: string;
  target?: string;
  data?: Record<string, unknown>;
}

export interface CommandMessage {
  type: 'command';
  data: {
    feed: FeedId;
    command: 'trigger_map' | 'smart_fill' | 'undo_fill' | 'dictate';
    payload?: CommandPayload;
    timestamp: string;
  };
}

export type WsMessage = StatusMessage | TranscriptMessage | AlertMessage | CommandMessage;

// ============================================================================
// Supabase Schema (transcripts2 table)
// ============================================================================

export interface TranscriptRun {
  id: number; // BIGINT
  user_id: string; // UUID
  patient_code: string; // Ephemeral ID like "PT-A1B2-C3D4"
  patient_uuid?: string | null; // Real patient UUID (optional)
  transcript?: string; // Full flattened text
  transcript_chunk?: TranscriptChunk[]; // JSONB array
  created_at?: string; // timestamptz
  completed_at?: string | null; // timestamptz
  metadata?: any; // JSONB
  ai_summary?: string;
  ai_short_summary?: string;
  ai_interim_summaries?: any[];
  pii_mapping?: any;
  token_count?: number;
  language?: string;
}

// ============================================================================
// Consent Events
// ============================================================================

export type ConsentEventType = 'audio_consent_granted' | 'audio_consent_revoked' | string;

export interface ConsentEventInput {
  orgId?: string | null;
  clinicianId?: string | null;
  patientRef?: string | null;
  source: 'browser_overlay' | 'dashboard' | 'api';
  eventType: ConsentEventType;
  sessionId?: string | null;
  tabId?: string | null;
  meta?: Record<string, unknown>;
}

// ============================================================================
// Patient Identity (Two-Phase)
// ============================================================================

export interface EphemeralPatient {
  patient_code: string; // e.g., "PT-A1B2-C3D4"
  patient_uuid: null;
}

export interface BoundPatient {
  patient_code: string; // Still the same ephemeral code
  patient_uuid: string; // Real patient UUID from EMR
  metadata: {
    mrn?: string;
    name?: string;
    dob?: string;
  };
}

// ============================================================================
// DOM Recognition
// ============================================================================

export interface DomMap {
  /**
   * Medical record number extracted from the host EHR.
   */
  mrn?: string;

  /**
   * Patient name as displayed in the current chart context.
   */
  name?: string;

  /**
   * Date of birth value, if available.
   */
  dob?: string;

  /**
   * Encounter date (visit date) if surfaced on the page.
   */
  encounterDate?: string;

  /**
   * Optional visit location or clinic identifier.
   */
  location?: string;

  /**
   * Optional attending or ordering provider associated with the chart.
   */
  provider?: string;
}

// ============================================================================
// Session & Configuration
// ============================================================================

export interface SessionConfig {
  transcriptId: number;
  userId: string;
  patientCode: string;
  patientUuid?: string | null;
}
