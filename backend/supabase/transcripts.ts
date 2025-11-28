import { getSupabaseClient } from './client.js';

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

export async function createTranscriptRun(input: CreateTranscriptRunInput): Promise<CreateTranscriptRunResult> {
  const client = getSupabaseClient();

  const finalPatientCode =
    input.patientCode ??
    `PT-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(16).slice(2, 6).toUpperCase()}`;

  const { data, error } = await client
    .from('transcripts2')
    .insert({
      user_id: input.userId,
      patient_code: finalPatientCode,
      patient_uuid: input.patientUuid ?? null,
      language: input.language ?? 'en',
      transcript_chunk: [],
      ai_interim_summaries: [],
    })
    .select('id, patient_code')
    .single();

  if (error) {
    throw error;
  }

  return { id: data.id, patientCode: data.patient_code };
}

export async function saveTranscriptChunks(
  transcriptId: number,
  chunks: any[],
  options?: SaveTranscriptChunksOptions,
): Promise<void> {
  const client = getSupabaseClient();
  const patch: Record<string, any> = {
    transcript_chunk: chunks,
  };

  if (options?.fullTranscript !== undefined) {
    patch.transcript = options.fullTranscript;
  }
  if (options?.completed) {
    patch.completed_at = new Date().toISOString();
  }

  const { error } = await client.from('transcripts2').update(patch).eq('id', transcriptId);
  if (error) {
    throw error;
  }
}

export async function updatePatientLink(
  transcriptId: number,
  data: { patientUuid?: string | null; patientCode?: string | null },
): Promise<void> {
  const patch: Record<string, any> = {};
  if (data.patientUuid !== undefined) {
    patch.patient_uuid = data.patientUuid;
  }
  if (data.patientCode !== undefined) {
    patch.patient_code = data.patientCode;
  }

  const { error } = await getSupabaseClient().from('transcripts2').update(patch).eq('id', transcriptId);
  if (error) {
    throw error;
  }
}

export async function getLatestTranscriptForUser(userId: string | null): Promise<TranscriptRow | null> {
  if (!userId) return null;
  const { data, error } = await getSupabaseClient()
    .from('transcripts2')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error) {
    if ((error as any).code === 'PGRST116') return null;
    throw error;
  }

  return data as TranscriptRow;
}
