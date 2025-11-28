/**
 * Supabase Client Library - AssistMD Truth Package
 * 
 * CRITICAL: Uses ONLY the transcripts2 table
 * NO sessions, transcripts, or doctors tables
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { TranscriptChunk, TranscriptRun, DomMap, ConsentEventInput } from '../types/index.js';

let supabase: SupabaseClient | null = null;

/**
 * Get or create Supabase client
 */
function getClient(): SupabaseClient {
  if (supabase) return supabase;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY; // Service role, not anon key!

  if (!url || !key) {
    console.warn('[Supabase] Missing credentials (SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY), running in offline mode');
    console.warn('[Supabase] Mock client active - no data will be persisted');

    // Return a more realistic mock client for offline development
    const mockTranscripts = new Map<number, TranscriptRun>();
    const mockConsentEvents: any[] = [];
    let nextTranscriptId = 1;
    let nextConsentId = 1;

    return {
      from: (table: string) => {
        if (table === 'transcripts2') {
          return {
            insert: (data: any) => {
              const recordData = Array.isArray(data) ? data[0] : data;
              const id = nextTranscriptId++;
              const record = { ...recordData, id, created_at: new Date().toISOString() } as TranscriptRun;
              mockTranscripts.set(id, record);
              console.log(`[Supabase Mock] Inserted transcript with id ${id}`);

              return {
                select: () => ({
                  single: async () => ({ data: { id }, error: null })
                }),
                single: async () => ({ data: { id }, error: null })
              };
            },
            select: () => {
              const builder: any = {
                _filter: null as { column: string; value: any } | null,
                _order: null as { column: string; ascending: boolean } | null,
                _limit: null as number | null,
                eq(column: string, value: any) {
                  this._filter = { column, value };
                  return this;
                },
                order(column: string, options?: { ascending?: boolean }) {
                  this._order = { column, ascending: options?.ascending !== false };
                  return this;
                },
                limit(count: number) {
                  this._limit = count;
                  return this;
                },
                async single() {
                  let rows = Array.from(mockTranscripts.values());
                  if (this._filter) {
                    rows = rows.filter((row: any) => row[this._filter.column] === this._filter.value);
                  }
                  if (this._order) {
                    const { column, ascending } = this._order;
                    rows = rows.sort((a: any, b: any) => {
                      const aVal = a[column];
                      const bVal = b[column];
                      if (aVal === bVal) return 0;
                      return ascending ? (aVal > bVal ? 1 : -1) : (aVal < bVal ? 1 : -1);
                    });
                  }
                  if (this._limit !== null) {
                    rows = rows.slice(0, this._limit);
                  }

                  const data = rows[0] || null;
                  return { data, error: data ? null : { code: 'PGRST116', message: 'Not found' } };
                }
              };

              return builder;
            },
            update: (updates: any) => ({
              eq: async (_column: string, value: any) => {
                const existing = mockTranscripts.get(value);
                const updated = existing ? { ...existing, ...updates } : null;
                if (updated) {
                  mockTranscripts.set(value, updated as TranscriptRun);
                }
                return { data: updated, error: null };
              }
            })
          };
        }

        if (table === 'consent_events') {
          return {
            insert: async (data: any) => {
              const record = {
                id: `mock-consent-${nextConsentId++}`,
                created_at: new Date().toISOString(),
                ...data
              };
              mockConsentEvents.push(record);
              console.log(`[Supabase Mock] Logged consent event ${record.id}`);
              return { data: record, error: null };
            },
            select: async () => ({ data: mockConsentEvents, error: null }),
            eq: function() { return this; },
            order: function() { return this; },
            limit: function() { return this; },
            single: async () => ({ data: mockConsentEvents.at(-1) || null, error: null })
          };
        }

        console.warn(`[Supabase Mock] Table '${table}' not supported in mock mode`);
        return {
          insert: async () => ({ data: null, error: null }),
          select: async () => ({ data: null, error: null }),
          update: async () => ({ data: null, error: null }),
          single: async () => ({ data: null, error: null }),
          eq: function() { return this; },
          order: function() { return this; },
          limit: function() { return this; }
        };
      }
    } as unknown as SupabaseClient;
  }

  supabase = createClient(url, key);
  console.log('[Supabase] Client initialized with service role key');
  return supabase;
}

/**
 * Create a new transcript run (Phase 1: Ephemeral Patient)
 * Returns the BIGINT id
 */
export async function createTranscriptRun(
  userId: string,
  patientCode: string,
  patientUuid?: string | null
): Promise<number> {
  const client = getClient();

  const { data, error } = await client
    .from('transcripts2')
    .insert({
      user_id: userId,
      patient_code: patientCode,
      patient_uuid: patientUuid || null,
      language: 'en',
      transcript_chunk: [],
      ai_interim_summaries: [],
      transcript: ''
    })
    .select('id')
    .single();

  if (error) {
    console.error('[Supabase] Failed to create transcript run:', error);
    throw new Error(`Failed to create transcript run: ${error.message}`);
  }

  console.log(`[Supabase] Created transcript run ${data.id} for user ${userId}, patient code ${patientCode}`);
  return data.id;
}

/**
 * Save transcript chunks (append to transcript_chunk array)
 * Also updates the flattened transcript text
 */
export async function saveTranscriptChunks(
  transcriptId: number,
  chunks: TranscriptChunk[]
): Promise<void> {
  if (!chunks || chunks.length === 0) return;

  const client = getClient();

  // Get existing chunks
  const { data: existing, error: fetchError } = await client
    .from('transcripts2')
    .select('transcript_chunk')
    .eq('id', transcriptId)
    .single();

  if (fetchError) {
    console.error('[Supabase] Failed to fetch existing chunks:', fetchError);
    throw new Error(`Failed to fetch existing chunks: ${fetchError.message}`);
  }

  // Append new chunks
  const existingChunks = (existing?.transcript_chunk as TranscriptChunk[]) || [];
  const updatedChunks = [...existingChunks, ...chunks];

  // Build full transcript text with speaker labels
  const fullTranscript = updatedChunks
    .map((c: TranscriptChunk) => `[Speaker ${c.speaker}]: ${c.text}`)
    .join('\n');

  const { error: updateError } = await client
    .from('transcripts2')
    .update({
      transcript_chunk: updatedChunks,
      transcript: fullTranscript
    })
    .eq('id', transcriptId);

  if (updateError) {
    console.error('[Supabase] Failed to save chunks:', updateError);
    throw new Error(`Failed to save chunks: ${updateError.message}`);
  }

  console.log(`[Supabase] Saved ${chunks.length} chunks to transcript ${transcriptId} (total: ${updatedChunks.length})`);
}

/**
 * Update transcript run - mark as completed
 */
export async function completeTranscriptRun(transcriptId: number): Promise<void> {
  const client = getClient();

  const { error } = await client
    .from('transcripts2')
    .update({
      completed_at: new Date().toISOString()
    })
    .eq('id', transcriptId);

  if (error) {
    console.error('[Supabase] Failed to complete transcript run:', error);
    throw new Error(`Failed to complete transcript run: ${error.message}`);
  }

  console.log(`[Supabase] Marked transcript ${transcriptId} as completed`);
}

/**
 * Update patient info on transcript (Phase 2: Real Patient Binding)
 */
export async function updatePatientInfo(
  transcriptId: number,
  patientUuid: string,
  metadata?: DomMap
): Promise<void> {
  const client = getClient();

  const updateData: any = {
    patient_uuid: patientUuid
  };

  if (metadata) {
    updateData.metadata = metadata;
  }

  const { error } = await client
    .from('transcripts2')
    .update(updateData)
    .eq('id', transcriptId);

  if (error) {
    console.error('[Supabase] Failed to update patient info:', error);
    throw new Error(`Failed to update patient info: ${error.message}`);
  }

  console.log(`[Supabase] Updated patient info for transcript ${transcriptId}, patient UUID ${patientUuid}`);
}

/**
 * Get full transcript with chunks
 */
export async function getTranscript(transcriptId: number): Promise<TranscriptRun | null> {
  const client = getClient();

  const { data, error } = await client
    .from('transcripts2')
    .select('*')
    .eq('id', transcriptId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      // Not found
      return null;
    }
    console.error('[Supabase] Failed to get transcript:', error);
    throw new Error(`Failed to get transcript: ${error.message}`);
  }

  return data as TranscriptRun;
}

/**
 * Get latest transcript for a user (for /patient/current)
 */
export async function getLatestTranscript(userId: string): Promise<TranscriptRun | null> {
  const client = getClient();

  const { data, error } = await client
    .from('transcripts2')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      // Not found
      return null;
    }
    console.error('[Supabase] Failed to get latest transcript:', error);
    throw new Error(`Failed to get latest transcript: ${error.message}`);
  }

  return data as TranscriptRun;
}

/**
 * Generate ephemeral patient code
 */
export function generateEphemeralPatientCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const segments = [4, 4]; // e.g., "PT-A1B2-C3D4"
  
  const parts = segments.map(len => {
    let segment = '';
    for (let i = 0; i < len; i++) {
      segment += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return segment;
  });

  return `PT-${parts.join('-')}`;
}

/**
 * Log consent events to consent_events table
 */
export async function logConsentEvent(event: ConsentEventInput): Promise<void> {
  const client = getClient();

  const payload = {
    org_id: event.orgId ?? null,
    clinician_id: event.clinicianId ?? null,
    patient_ref: event.patientRef ?? null,
    source: event.source,
    event_type: event.eventType,
    session_id: event.sessionId ?? null,
    tab_id: event.tabId ?? null,
    meta: event.meta ?? {}
  };

  const { error } = await client.from('consent_events').insert(payload);

  if (error) {
    console.error('[Supabase] Failed to log consent event:', error);
    throw new Error(`Failed to log consent event: ${error.message}`);
  }

  console.log(`[Supabase] Logged consent event: ${event.eventType}`);
}

export { getClient };
