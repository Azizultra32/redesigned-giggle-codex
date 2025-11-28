import { getLatestTranscriptForUser } from '../supabase/transcripts.js';

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

export async function getPatientCardForUser(userId: string | null): Promise<PatientCard> {
  const latest = await getLatestTranscriptForUser(userId);
  if (!latest) {
    return {
      name: 'Demo Patient',
      dob: '1980-01-01',
      mrn: 'PT-DEMO',
      reason: 'Follow-up visit',
      sex: 'O',
      sessionId: null,
      doctor: 'Dr. Demo',
      autopilotReady: false,
      lastTranscript: null,
    };
  }

  return {
    name: 'Demo Patient',
    dob: '1980-01-01',
    mrn: latest.patient_code || 'PT-UNKNOWN',
    reason: latest.transcript || 'Consultation',
    sex: 'O',
    sessionId: String(latest.id),
    doctor: 'Dr. Demo',
    autopilotReady: latest.completed_at !== null,
    lastTranscript: latest.transcript,
  };
}
