export type TabId = 'summary' | 'soap' | 'transcript' | 'tasks' | 'patient' | 'debug';

export type RecorderState = 'idle' | 'connecting' | 'listening' | 'error';

export type FeedKey = 'A' | 'B' | 'C' | 'D' | 'E';

export type FeedStatus = 'idle' | 'streaming' | 'pending' | 'error';

export interface FeedState {
  id: FeedKey;
  label: string;
  status: FeedStatus;
  lastUpdate?: number;
  note?: string;
}

export interface TranscriptLine {
  id: string;
  speaker: string;
  text: string;
  timestamp: number;
  isFinal: boolean;
  tabId?: string;
}

export interface PatientInfo {
  name: string;
  mrn: string;
  dob?: string;
  patient_code?: string;
  patient_uuid?: string;
}

export type StatusLogTone = 'info' | 'warning' | 'error';

export interface StatusLogEntry {
  id: string;
  message: string;
  timestamp: number;
  tone: StatusLogTone;
}
