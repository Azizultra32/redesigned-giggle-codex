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

export class VADConsumer {
  private state: VADState = 'idle';
  private readonly options: Required<Pick<VADConsumerOptions, 'sampleRate' | 'frameSizeMs' | 'silenceTimeoutMs'>> &
    Pick<VADConsumerOptions, 'autoStart' | 'autoStop'>;
  private handlers: {
    status?: VADStatusHandler;
    speech?: VADSpeechHandler;
    command?: VADCommandHandler;
  } = {};
  private lastAudioAt: number | null = null;

  constructor(options?: VADConsumerOptions) {
    this.options = {
      sampleRate: options?.sampleRate ?? 16000,
      frameSizeMs: options?.frameSizeMs ?? 20,
      silenceTimeoutMs: options?.silenceTimeoutMs ?? 5000,
      autoStart: options?.autoStart ?? false,
      autoStop: options?.autoStop ?? false,
    };

    if (this.options.autoStart) {
      this.start();
    }
  }

  start(handlers?: { status?: VADStatusHandler; speech?: VADSpeechHandler; command?: VADCommandHandler }): void {
    this.handlers = handlers || {};
    this.setState('running');
  }

  handleAudio(buffer: Buffer): void {
    if (this.state !== 'running') {
      if (this.options.autoStart) {
        this.start(this.handlers);
      } else {
        return;
      }
    }

    // Minimal stub: track last audio timestamp and emit silence-based speech-end.
    const now = Date.now();
    if (this.lastAudioAt === null && this.handlers.speech) {
      this.handlers.speech({ type: 'speech-start', at: now });
    }
    this.lastAudioAt = now;

    if (this.options.autoStop && this.handlers.speech) {
      setTimeout(() => {
        if (this.lastAudioAt && Date.now() - this.lastAudioAt >= this.options.silenceTimeoutMs) {
          this.handlers.speech?.({ type: 'speech-end', at: Date.now() });
        }
      }, this.options.silenceTimeoutMs + 10);
    }
  }

  stop(): void {
    this.setState('stopped');
  }

  private setState(next: VADState): void {
    this.state = next;
    this.handlers.status?.(next);
  }
}
