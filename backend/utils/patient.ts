import { getLatestTranscriptForUser, TranscriptRow } from '../supabase/transcripts.js';

export interface PatientCard {
  name: string;
  dob: string;
  mrn: string;
  reason: string;
  sex: 'M' | 'F' | 'O';
  sessionId: string | null;
  doctor: string;
  autopilotReady: boolean;
  lastTranscript: string | null;
}

const FALLBACK_PATIENT: PatientCard = {
  name: 'Demo Patient',
  dob: '1971-01-01',
  mrn: 'PT-DEMO-0001',
  reason: 'chest pain and shortness of breath',
  sex: 'F',
  sessionId: null,
  doctor: 'Demo Doctor',
  autopilotReady: false,
  lastTranscript: null
};

export async function getPatientCardForUser(userId: string | null): Promise<PatientCard> {
  try {
    const latest = await getLatestTranscriptForUser(userId);
    if (!latest) {
      return FALLBACK_PATIENT;
    }
    return mapRowToPatientCard(latest);
  } catch (err) {
    console.error('[Patient] Failed to fetch patient card', err);
    return FALLBACK_PATIENT;
  }
}

function mapRowToPatientCard(row: TranscriptRow): PatientCard {
  return {
    name: 'Demo Patient',
    dob: '1971-01-01',
    mrn: row.patient_code || 'PT-UNKNOWN',
    reason: row.transcript || 'No transcript yet',
    sex: 'F',
    sessionId: String(row.id),
    doctor: 'Demo Doctor',
    autopilotReady: row.completed_at !== null,
    lastTranscript: row.transcript
  };
}
