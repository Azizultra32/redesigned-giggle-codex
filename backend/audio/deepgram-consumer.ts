/**
 * Deepgram Consumer
 *
 * Real-time transcription with speaker diarization.
 * Connects to Deepgram nova-2 streaming API.
 *
 * Audio format: PCM 16kHz mono linear16
 * Diarization: Up to 50 speakers (0-49)
 */

import { createClient, LiveTranscriptionEvents, LiveClient } from '@deepgram/sdk';
import { ChunkAggregator, AggregatedChunk } from '../utils/diarization.js';

export interface WordResult {
  word: string;
  start: number;
  end: number;
  confidence: number;
  speaker: number;
}

export interface TranscriptEvent {
  type: 'interim' | 'final' | 'utterance_end';
  text: string;
  speaker: number;
  start: number;
  end: number;
  confidence: number;
  words: WordResult[];
  isFinal: boolean;
}

export interface DeepgramConsumerConfig {
  onTranscript: (event: TranscriptEvent) => void;
  onChunk: (chunk: AggregatedChunk) => void;
  onError: (error: Error) => void;
  onClose: () => void;
}

export class DeepgramConsumer {
  private client: ReturnType<typeof createClient> | null = null;
  private connection: LiveClient | null = null;
  private config: DeepgramConsumerConfig;
  private aggregator: ChunkAggregator;
  private isConnected = false;

  constructor(config: DeepgramConsumerConfig) {
    this.config = config;
    this.aggregator = new ChunkAggregator({
      maxDurationSeconds: 30,
      onChunkComplete: config.onChunk
    });
  }

  async connect(): Promise<void> {
    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) {
      throw new Error('DEEPGRAM_API_KEY environment variable not set');
    }

    console.log('[Deepgram] Connecting to streaming API...');
    this.client = createClient(apiKey);

    this.connection = this.client.listen.live({
      model: 'nova-2',
      language: 'en-US',
      smart_format: true,
      punctuate: true,
      diarize: true,
      interim_results: true,
      utterance_end_ms: 1000,
      vad_events: true,
      encoding: 'linear16',
      sample_rate: 16000,
      channels: 1
    });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!this.isConnected) {
          reject(new Error('Deepgram connection timeout (10s)'));
        }
      }, 10000);

      this.connection!.on(LiveTranscriptionEvents.Open, () => {
        clearTimeout(timeout);
        this.isConnected = true;
        console.log('[Deepgram] Connected');
        resolve();
      });

      this.connection!.on(LiveTranscriptionEvents.Error, (error: Error) => {
        clearTimeout(timeout);
        console.error('[Deepgram] Error:', error);
        this.config.onError(error);
        if (!this.isConnected) reject(error);
      });

      this.connection!.on(LiveTranscriptionEvents.Transcript, (data: any) => {
        this.handleTranscript(data);
      });

      this.connection!.on(LiveTranscriptionEvents.UtteranceEnd, () => {
        console.log('[Deepgram] Utterance end');
        this.aggregator.forceFlush();
      });

      this.connection!.on(LiveTranscriptionEvents.Close, () => {
        console.log('[Deepgram] Connection closed');
        this.isConnected = false;
        this.aggregator.forceFlush();
        this.config.onClose();
      });
    });
  }

  sendAudio(data: Buffer): void {
    if (this.connection && this.isConnected) {
      // Convert Buffer to ArrayBuffer for Deepgram SDK
      const arrayBuffer = data.buffer.slice(
        data.byteOffset,
        data.byteOffset + data.byteLength
      );
      this.connection.send(arrayBuffer);
    }
  }

  disconnect(): void {
    if (this.connection) {
      console.log('[Deepgram] Disconnecting...');
      this.aggregator.forceFlush();
      this.connection.finish();
      this.connection = null;
      this.isConnected = false;
    }
  }

  getConnectionState(): boolean {
    return this.isConnected;
  }

  private handleTranscript(data: any): void {
    const channel = data.channel;
    if (!channel?.alternatives?.length) return;

    const alternative = channel.alternatives[0];
    const text = alternative.transcript;

    if (!text || text.trim() === '') return;

    const words: WordResult[] = (alternative.words || []).map((w: any) => ({
      word: w.word,
      start: w.start,
      end: w.end,
      confidence: w.confidence,
      speaker: w.speaker ?? 0
    }));

    // Get dominant speaker from words
    const speaker = this.getDominantSpeaker(words);

    const event: TranscriptEvent = {
      type: data.is_final ? 'final' : 'interim',
      text,
      speaker,
      start: words[0]?.start ?? 0,
      end: words[words.length - 1]?.end ?? 0,
      confidence: alternative.confidence ?? 0,
      words,
      isFinal: data.is_final ?? false
    };

    // Send transcript event
    this.config.onTranscript(event);

    // Feed to aggregator for chunk assembly (finals only)
    if (event.isFinal) {
      this.aggregator.addWords(words);
    }
  }

  private getDominantSpeaker(words: WordResult[]): number {
    const counts: Record<number, number> = {};
    for (const word of words) {
      counts[word.speaker] = (counts[word.speaker] || 0) + 1;
    }

    let dominant = 0;
    let maxCount = 0;
    for (const [speaker, count] of Object.entries(counts)) {
      if (count > maxCount) {
        maxCount = count;
        dominant = parseInt(speaker);
      }
    }
    return dominant;
  }
}
