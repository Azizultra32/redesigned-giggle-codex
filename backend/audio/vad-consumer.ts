import { ConsumerState } from '../types.js';

export type VADState = 'idle' | 'running' | 'error' | 'stopped';

export interface VADConsumerOptions {
  sampleRate?: number;
  frameSizeMs?: number;
  silenceTimeoutMs?: number;
  autoStart?: boolean;
  autoStop?: boolean;
}

export type VADStatusHandler = (state: VADState) => void;
export type VADSpeechHandler = (event: { type: 'speech-start' | 'speech-end'; at: number }) => void;
export type VADCommandHandler = (event: { phrase: string; at: number }) => void;

interface VADHandlers {
  status?: VADStatusHandler;
  speech?: VADSpeechHandler;
  command?: VADCommandHandler;
}

export class VADConsumer {
  private state: VADState = 'idle';
  private readonly options: VADConsumerOptions;
  private handlers: VADHandlers = {};

  constructor(options?: VADConsumerOptions) {
    this.options = options ?? {};
    if (this.options.autoStart) {
      this.start();
    }
  }

  start(handlers?: VADHandlers): void {
    this.handlers = handlers ?? {};
    this.state = 'running';
    this.handlers.status?.('running');
  }

  handleAudio(_buffer: Buffer): void {
    // Placeholder: integrate actual VAD or keyword detection here.
  }

  stop(): void {
    this.state = 'stopped';
    this.handlers.status?.('stopped');
  }

  getState(): VADState {
    return this.state;
  }
}

export function mapVadStateToConsumer(state: VADState): ConsumerState {
  switch (state) {
    case 'running':
      return 'connected';
    case 'error':
      return 'error';
    case 'stopped':
      return 'closed';
    default:
      return 'idle';
  }
}
