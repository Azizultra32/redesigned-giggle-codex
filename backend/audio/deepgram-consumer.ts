import { createClient, LiveClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import { DiarizationAssembler } from '../utils/diarization.js';
import type { ConsumerState, TranscriptPayload } from '../types.js';

export interface DeepgramConsumerHandlers {
  onTranscript?: (payload: TranscriptPayload) => void;
  onStatus?: (state: ConsumerState, message?: string) => void;
  onError?: (error: Error) => void;
}

export interface DeepgramConsumerOptions {
  apiKey: string;
  model?: string;
  language?: string;
}

export class DeepgramConsumer {
  private readonly options: Required<DeepgramConsumerOptions>;
  private readonly handlers: DeepgramConsumerHandlers;
  private readonly assembler: DiarizationAssembler;
  private connection: LiveClient | null = null;
  private state: ConsumerState = 'idle';

  constructor(options: DeepgramConsumerOptions, handlers?: DeepgramConsumerHandlers) {
    this.options = {
      apiKey: options.apiKey,
      model: options.model ?? 'nova-2',
      language: options.language ?? 'en-US',
    };
    this.handlers = handlers || {};
    this.assembler = new DiarizationAssembler();
  }

  async start(): Promise<void> {
    this.updateState('connecting');
    const client = createClient(this.options.apiKey);
    this.connection = client.listen.live({
      model: this.options.model,
      language: this.options.language,
      diarize: true,
      interim_results: true,
      smart_format: true,
      punctuate: true,
      encoding: 'linear16',
      sample_rate: 16000,
      channels: 1,
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Deepgram connection timeout'));
      }, 10000);

      this.connection?.on(LiveTranscriptionEvents.Open, () => {
        clearTimeout(timeout);
        this.updateState('connected');
        resolve();
      });

      this.connection?.on(LiveTranscriptionEvents.Error, (err: Error) => {
        clearTimeout(timeout);
        this.handlers.onError?.(err);
        this.updateState('error', err.message);
        reject(err);
      });

      this.connection?.on(LiveTranscriptionEvents.Close, () => {
        clearTimeout(timeout);
        this.updateState('closed');
      });

      this.connection?.on(LiveTranscriptionEvents.Transcript, (evt) => {
        const payload = this.assembler.ingestDeepgramEvent(evt);
        this.handlers.onTranscript?.({
          finalized: payload.finalized.map((c) => ({ ...c })),
          interim: payload.interim ? { ...payload.interim } : null,
          fullText: payload.fullText,
        });
      });
    });
  }

  handleAudio(buffer: Buffer): void {
    if (!this.connection || this.state !== 'connected') return;
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    this.connection.send(arrayBuffer);
  }

  stop(): void {
    if (this.connection) {
      try {
        this.connection.finish();
      } catch (err) {
        this.handlers.onError?.(err as Error);
      }
      this.connection = null;
    }
    const snapshot = this.assembler.snapshot();
    if (snapshot.interim) {
      this.handlers.onTranscript?.({
        finalized: snapshot.finalized.concat([{ ...snapshot.interim, isFinal: true }]),
        interim: null,
        fullText: snapshot.fullText
          ? `${snapshot.fullText}\n${snapshot.interim.text}`
          : snapshot.interim.text,
      });
    }
    this.updateState('closed');
  }

  private updateState(state: ConsumerState, message?: string): void {
    this.state = state;
    this.handlers.onStatus?.(state, message);
  }
}
