/**
 * Deepgram Consumer
 *
 * Handles real-time transcription with speaker diarization.
 * Connects to Deepgram's streaming API and processes audio.
 */

import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';

export interface TranscriptResult {
  id: string;
  text: string;
  speaker: string;
  timestamp: number;
  is_final: boolean;
  confidence: number;
  words: Array<{
    word: string;
    start: number;
    end: number;
    confidence: number;
    speaker?: number;
  }>;
}

export interface DeepgramConsumerOptions {
  onTranscript: (transcript: TranscriptResult) => void;
  onError: (error: Error) => void;
  onUtteranceEnd?: () => void;
  onClose?: () => void;
}

export class DeepgramConsumer {
  private client: ReturnType<typeof createClient> | null = null;
  private connection: any = null;
  private options: DeepgramConsumerOptions;
  private messageCounter: number = 0;

  constructor(options: DeepgramConsumerOptions) {
    this.options = options;
  }

  async connect(): Promise<void> {
    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) {
      throw new Error('DEEPGRAM_API_KEY not configured');
    }

    console.log('[Deepgram] Connecting...');

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
      this.connection.on(LiveTranscriptionEvents.Open, () => {
        console.log('[Deepgram] Connected');
        resolve();
      });

      this.connection.on(LiveTranscriptionEvents.Error, (error: Error) => {
        console.error('[Deepgram] Error:', error);
        this.options.onError(error);
        reject(error);
      });

      this.connection.on(LiveTranscriptionEvents.Transcript, (data: any) => {
        this.handleTranscript(data);
      });

      this.connection.on(LiveTranscriptionEvents.Close, () => {
        console.log('[Deepgram] Connection closed');
        this.options.onClose?.();
      });

      this.connection.on(LiveTranscriptionEvents.UtteranceEnd, () => {
        console.log('[Deepgram] Utterance end detected');
        this.options.onUtteranceEnd?.();
      });

      // Timeout for connection
      setTimeout(() => {
        if (!this.connection) {
          reject(new Error('Connection timeout'));
        }
      }, 10000);
    });
  }

  sendAudio(data: Buffer): void {
    if (this.connection?.getReadyState() === 1) {
      this.connection.send(data);
    }
  }

  disconnect(): void {
    if (this.connection) {
      console.log('[Deepgram] Disconnecting...');
      this.connection.finish();
      this.connection = null;
    }
  }

  private handleTranscript(data: any): void {
    const channel = data.channel;
    if (!channel?.alternatives?.length) return;

    const alternative = channel.alternatives[0];
    const transcript = alternative.transcript;

    if (!transcript || transcript.trim() === '') return;

    const words = alternative.words || [];

    // Determine speaker from words (diarization)
    const speakerCounts: Record<number, number> = {};
    words.forEach((word: any) => {
      if (word.speaker !== undefined) {
        speakerCounts[word.speaker] = (speakerCounts[word.speaker] || 0) + 1;
      }
    });

    // Get dominant speaker
    let dominantSpeaker = 0;
    let maxCount = 0;
    for (const [speaker, count] of Object.entries(speakerCounts)) {
      if (count > maxCount) {
        maxCount = count;
        dominantSpeaker = parseInt(speaker);
      }
    }

    const result: TranscriptResult = {
      id: `msg_${++this.messageCounter}_${Date.now()}`,
      text: transcript,
      speaker: String(dominantSpeaker),
      timestamp: Date.now(),
      is_final: data.is_final ?? false,
      confidence: alternative.confidence || 0,
      words: words.map((w: any) => ({
        word: w.word,
        start: w.start,
        end: w.end,
        confidence: w.confidence,
        speaker: w.speaker
      }))
    };

    this.options.onTranscript(result);
  }
}
