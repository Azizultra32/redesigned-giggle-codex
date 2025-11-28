import { createClient, LiveClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import {
  ConsumerState,
  TranscriptPayload,
  TranscriptChunk
} from '../types.js';
import { DiarizationAssembler, DeepgramEventLike } from '../utils/diarization.js';

export interface DeepgramConsumerOptions {
  apiKey: string;
  onTranscript?: (payload: TranscriptPayload) => void;
  onStatus?: (state: ConsumerState, message?: string) => void;
  onError?: (error: Error) => void;
}

export class DeepgramConsumer {
  private connection: LiveClient | null = null;
  private state: ConsumerState = 'idle';
  private readonly assembler: DiarizationAssembler;
  private readonly opts: DeepgramConsumerOptions;

  constructor(opts: DeepgramConsumerOptions) {
    this.opts = opts;
    this.assembler = new DiarizationAssembler();
  }

  async start(): Promise<void> {
    if (!this.opts.apiKey) {
      this.reportStatus('error', 'Missing DEEPGRAM_API_KEY');
      throw new Error('DEEPGRAM_API_KEY is required');
    }

    this.reportStatus('connecting');

    const client = createClient(this.opts.apiKey);
    this.connection = client.listen.live({
      model: 'nova-2',
      smart_format: true,
      punctuate: true,
      diarize: true,
      interim_results: true,
      encoding: 'linear16',
      sample_rate: 16000
    });

    await new Promise<void>((resolve, reject) => {
      if (!this.connection) return reject(new Error('Connection not created'));

      this.connection.on(LiveTranscriptionEvents.Open, () => {
        this.reportStatus('connected');
        resolve();
      });

      this.connection.on(LiveTranscriptionEvents.Error, (err: Error) => {
        this.handleError(err);
        reject(err);
      });

      this.connection.on(LiveTranscriptionEvents.Close, () => {
        this.reportStatus('closed');
        this.flushFinal();
      });

      this.connection.on(LiveTranscriptionEvents.Transcript, (data: DeepgramEventLike) => {
        const payload = this.assembler.ingestDeepgramEvent(data);
        this.emitTranscript(payload);
      });
    });
  }

  handleAudio(buffer: Buffer): void {
    if (!this.connection) return;
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    try {
      this.connection.send(arrayBuffer);
    } catch (err) {
      this.handleError(err as Error);
    }
  }

  stop(): void {
    if (this.connection) {
      try {
        this.connection.finish();
      } catch (err) {
        this.handleError(err as Error);
      }
    }
    this.flushFinal();
    this.connection = null;
    this.reportStatus('closed');
  }

  private flushFinal(): void {
    const snapshot = this.assembler.snapshot();
    if (snapshot.interim) {
      const finalized: TranscriptChunk = { ...snapshot.interim, isFinal: true };
      const payload: TranscriptPayload = {
        finalized: [...snapshot.finalized, finalized],
        interim: null,
        fullText: snapshot.fullText ? `${snapshot.fullText}\n${finalized.text}` : finalized.text
      };
      this.emitTranscript(payload);
    } else if (snapshot.finalized.length > 0) {
      this.emitTranscript(snapshot);
    }
  }

  private emitTranscript(payload: TranscriptPayload): void {
    this.opts.onTranscript?.(payload);
  }

  private reportStatus(state: ConsumerState, message?: string): void {
    this.state = state;
    this.opts.onStatus?.(state, message);
  }

  private handleError(err: Error): void {
    this.state = 'error';
    this.opts.onStatus?.('error', err.message);
    this.opts.onError?.(err);
  }
}
