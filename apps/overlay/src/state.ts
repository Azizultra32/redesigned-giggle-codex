import { PatientInfo, FeedKey, FeedState, RecorderState, StatusLogEntry, StatusLogTone, TabId, TranscriptLine } from './types';

interface OverlayState {
  isVisible: boolean;
  isConnected: boolean;
  isActive: boolean;
  activeTab: TabId;
  isRecording: boolean;
  recorderState: RecorderState;
  transcriptLines: TranscriptLine[];
  patientInfo: PatientInfo | null;
  warnings: string[];
  feeds: Record<FeedKey, FeedState>;
  statusLog: StatusLogEntry[];
}

const FEED_LABELS: Record<FeedKey, string> = {
  A: 'Audio Feed',
  B: 'Transcripts',
  C: 'Patient Data',
  D: 'Tasks',
  E: 'Debug'
};

const createDefaultFeeds = (): Record<FeedKey, FeedState> => ({
  A: { id: 'A', label: FEED_LABELS.A, status: 'idle' },
  B: { id: 'B', label: FEED_LABELS.B, status: 'idle' },
  C: { id: 'C', label: FEED_LABELS.C, status: 'idle' },
  D: { id: 'D', label: FEED_LABELS.D, status: 'idle' },
  E: { id: 'E', label: FEED_LABELS.E, status: 'idle' }
});

type Listener = (state: OverlayState) => void;

export class OverlayStore {
  private state: OverlayState;
  private listeners: Set<Listener> = new Set();

  constructor() {
    this.state = {
      isVisible: true,
      isConnected: false,
      isActive: true,
      activeTab: 'summary',
      isRecording: false,
      recorderState: 'idle',
      transcriptLines: [],
      patientInfo: null,
      warnings: [],
      feeds: createDefaultFeeds(),
      statusLog: []
    };
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  public getState(): OverlayState {
    return {
      ...this.state,
      transcriptLines: [...this.state.transcriptLines],
      warnings: [...this.state.warnings],
      feeds: { ...this.state.feeds },
      statusLog: [...this.state.statusLog]
    };
  }

  public setActiveTab(tab: TabId): void {
    if (this.state.activeTab === tab) return;
    this.state.activeTab = tab;
    this.log(`Switched to ${tab} tab`, 'info');
  }

  public setVisibility(isVisible: boolean): void {
    this.state.isVisible = isVisible;
    this.notify();
  }

  public setConnection(isConnected: boolean): void {
    if (this.state.isConnected === isConnected) return;
    this.state.isConnected = isConnected;
    this.updateFeed('A', { status: isConnected ? 'streaming' : 'idle' }, true);
    this.log(isConnected ? 'Connected to agent' : 'Disconnected from agent', isConnected ? 'info' : 'warning');
  }

  public setRecorderState(recorderState: RecorderState, tone: StatusLogTone = 'info', note?: string): void {
    this.state.recorderState = recorderState;
    this.state.isRecording = recorderState === 'listening' || recorderState === 'connecting';
    const messageMap: Record<RecorderState, string> = {
      idle: 'Recorder idle',
      connecting: 'Connecting recorder...',
      listening: 'Recorder listening',
      error: 'Recorder error'
    };
    const feedStatus: FeedState['status'] =
      recorderState === 'listening'
        ? 'streaming'
        : recorderState === 'connecting'
          ? 'pending'
          : recorderState === 'error'
            ? 'error'
            : 'idle';

    this.updateFeed('A', { status: feedStatus, note: note || messageMap[recorderState] }, true);
    this.log(note || messageMap[recorderState], tone);
  }

  public addTranscriptLine(line: TranscriptLine): void {
    const lines = [...this.state.transcriptLines];
    const existingIndex = lines.findIndex(l => l.id === line.id);

    if (existingIndex >= 0) {
      lines[existingIndex] = line;
    } else {
      lines.push(line);
    }

    this.state.transcriptLines = lines;
    this.updateFeed('B', { status: 'streaming', note: line.text, lastUpdate: Date.now() }, true);
    this.notify();
  }

  public clearTranscript(): void {
    this.state.transcriptLines = [];
    this.notify();
  }

  public setPatientInfo(info: PatientInfo | null): void {
    this.state.patientInfo = info;
    if (info) {
      this.updateFeed('C', { status: 'streaming', note: info.name, lastUpdate: Date.now() }, true);
      this.log(`Patient detected: ${info.name}`, 'info');
      return;
    }
    this.notify();
  }

  public setActiveState(isActive: boolean): void {
    this.state.isActive = isActive;
    this.notify();
  }

  public addWarning(warning: string): void {
    if (this.state.warnings.includes(warning)) return;
    this.state.warnings = [...this.state.warnings, warning];
    this.log(warning, 'warning');
  }

  public updateFeed(id: FeedKey, updates: Partial<FeedState>, skipNotify = false): void {
    this.state.feeds[id] = {
      ...this.state.feeds[id],
      ...updates,
      lastUpdate: updates.lastUpdate ?? Date.now()
    };
    if (!skipNotify) {
      this.notify();
    }
  }

  public log(message: string, tone: StatusLogTone = 'info'): void {
    const entry: StatusLogEntry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      message,
      timestamp: Date.now(),
      tone
    };
    this.state.statusLog = [...this.state.statusLog, entry].slice(-50);
    this.updateFeed('E', { status: 'streaming', lastUpdate: entry.timestamp, note: message }, true);
    this.notify();
  }

  public resetWarnings(): void {
    this.state.warnings = [];
    this.notify();
  }

  private notify(): void {
    const snapshot = this.getState();
    this.listeners.forEach(listener => listener(snapshot));
  }
}

export type { OverlayState };
