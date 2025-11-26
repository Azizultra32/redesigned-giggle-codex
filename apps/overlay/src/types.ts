export type TabId = 'summary' | 'soap' | 'transcript' | 'tasks' | 'patient' | 'debug';

export interface PatientInfo {
  name: string;
  mrn: string;
  dob?: string;
}

export interface TranscriptLine {
  id: string;
  speaker: string;
  text: string;
  timestamp: number;
  isFinal: boolean;
  tabId?: TabId;
}

export interface SoapNote {
  subjective?: string;
  objective?: string;
  assessment?: string;
  plan?: string;
}

export interface SummaryPayload {
  tabId?: TabId;
  title?: string;
  content?: string;
}

export interface TaskItem {
  id: string;
  label: string;
  completed?: boolean;
  tabId?: TabId;
}

export interface AutopilotNote {
  id: string;
  tabId?: TabId;
  content: string;
}

export interface DebugLogEntry {
  id: string;
  message: string;
  level?: 'info' | 'warn' | 'error';
  timestamp: number;
  tabId?: TabId;
}
