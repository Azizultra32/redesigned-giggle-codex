/**
 * Supabase Client Library
 *
 * Handles database operations for transcripts2 table.
 * Uses PRODUCTION schema with transcript_chunk jsonb[] array.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabase: SupabaseClient | null = null;

/**
 * Chunk object stored in transcript_chunk jsonb[]
 */
export interface TranscriptChunk {
  speaker: number;
  text: string;
  start: number;
  end: number;
  word_count: number;
  raw: Array<{
    word: string;
    start: number;
    end: number;
    confidence: number;
    speaker: number;
  }>;
}

export interface TranscriptRun {
  id: number;
  user_id: string;
  transcript: string | null;
  transcript_chunk: TranscriptChunk[];
  created_at: string;
  completed_at: string | null;
  patient_code: string | null;
  patient_uuid: string | null;
  ai_summary?: unknown;
}

function getClient(): SupabaseClient {
  if (supabase) return supabase;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.warn('[Supabase] Missing credentials, running in offline mode');
    // Return a mock client for development
    const mockQuery: any = {
      select: () => mockQuery,
      eq: () => mockQuery,
      order: () => mockQuery,
      limit: () => mockQuery,
      single: async () => ({ data: null, error: null })
    };

    return {
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => ({ data: { id: Date.now() }, error: null })
          })
        }),
        select: () => mockQuery,
        update: () => ({
          eq: () => ({ data: null, error: null })
        })
      })
    } as unknown as SupabaseClient;
  }

  supabase = createClient(url, key);
  return supabase;
}

/**
 * Create a new transcript run
 * Returns the BIGINT id
 */
export async function createTranscriptRun(
  userId: string,
  patientCode?: string,
  patientUuid?: string
): Promise<number> {
  const client = getClient();

  const { data, error } = await client
    .from('transcripts2')
    .insert({
      user_id: userId,
      patient_code: patientCode || '',
      patient_uuid: patientUuid || null,
      language: 'en',
      transcript_chunk: [],
      ai_interim_summaries: []
    })
    .select('id')
    .single();

  if (error) {
    console.error('[Supabase] Failed to create transcript run:', error);
    throw error;
  }

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
  const client = getClient();

  // Get existing chunks
  const { data: existing, error: fetchError } = await client
    .from('transcripts2')
    .select('transcript_chunk')
    .eq('id', transcriptId)
    .single();

  if (fetchError) {
    console.error('[Supabase] Failed to fetch existing chunks:', fetchError);
    throw fetchError;
  }

  // Append new chunks
  const existingChunks = existing?.transcript_chunk || [];
  const updatedChunks = [...existingChunks, ...chunks];

  // Build full transcript text
  const fullTranscript = updatedChunks
    .map((c: TranscriptChunk) => `[Speaker ${c.speaker}]: ${c.text}`)
    .join('\n');

  const { error: updateError } = await client
    .from('transcripts2')
    .update({
      transcript_chunk: updatedChunks,
      transcript: fullTranscript,
      processed_at: new Date().toISOString()
    })
    .eq('id', transcriptId);

  if (updateError) {
    console.error('[Supabase] Failed to save chunks:', updateError);
    throw updateError;
  }
}

/**
 * Update transcript run (mark complete)
 */
export async function updateTranscriptRun(transcriptId: number): Promise<void> {
  const client = getClient();

  const { error } = await client
    .from('transcripts2')
    .update({
      completed_at: new Date().toISOString(),
      processed_at: new Date().toISOString()
    })
    .eq('id', transcriptId);

  if (error) {
    console.error('[Supabase] Failed to update transcript run:', error);
    throw error;
  }
}

/**
 * Update patient info on transcript
 */
export async function updatePatientInfo(
  transcriptId: number,
  patientCode: string,
  patientUuid?: string
): Promise<void> {
  const client = getClient();

  const { error } = await client
    .from('transcripts2')
    .update({
      patient_code: patientCode,
      patient_uuid: patientUuid || null
    })
    .eq('id', transcriptId);

  if (error) {
    console.error('[Supabase] Failed to update patient info:', error);
    throw error;
  }
}

/**
 * Get full transcript text
 */
export async function getFullTranscript(transcriptId: number): Promise<string> {
  const client = getClient();

  const { data, error } = await client
    .from('transcripts2')
    .select('transcript')
    .eq('id', transcriptId)
    .single();

  if (error) {
    console.error('[Supabase] Failed to get transcript:', error);
    throw error;
  }

  return data?.transcript || '';
}

/**
 * Fetch a transcript run with chunks and metadata
 */
export async function getTranscriptRun(
  transcriptId: number
): Promise<TranscriptRun | null> {
  const client = getClient();

  const { data, error } = await client
    .from('transcripts2')
    .select(
      'id, user_id, transcript, transcript_chunk, created_at, completed_at, patient_code, patient_uuid, ai_summary'
    )
    .eq('id', transcriptId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    console.error('[Supabase] Failed to fetch transcript run:', error);
    throw error;
  }

  return data as TranscriptRun;
}

/**
 * Get transcript chunks
 */
export async function getChunks(transcriptId: number): Promise<TranscriptChunk[]> {
  const client = getClient();

  const { data, error } = await client
    .from('transcripts2')
    .select('transcript_chunk')
    .eq('id', transcriptId)
    .single();

  if (error) {
    console.error('[Supabase] Failed to get chunks:', error);
    throw error;
  }

  return data?.transcript_chunk || [];
}

/**
 * Get latest transcript profile for a user
 */
export async function latestTranscriptProfile(userId: string) {
  const client = getClient();

  const { data, error } = await client
    .from('transcripts2')
    .select('id, patient_code, patient_uuid, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('[Supabase] Failed to get latest profile:', error);
    throw error;
  }

  return data;
}

export { getClient };
