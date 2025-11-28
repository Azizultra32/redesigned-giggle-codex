export interface DiarizationWord {
  text: string;
  start: number;
  end: number;
  speaker?: number | null;
  punctuated?: string;
}

export interface DiarizedChunk {
  speaker: number;
  text: string;
  start: number;
  end: number;
  isFinal: boolean;
}

export interface DiarizationResult {
  finalized: DiarizedChunk[];
  interim: DiarizedChunk | null;
  fullText: string;
}

export interface DiarizationOptions {
  maxChunkDurationSeconds?: number;
  fallbackSpeakerId?: number;
}

export interface DeepgramWordLike {
  word: string;
  punctuated_word?: string;
  start: number;
  end: number;
  speaker?: number | null;
}

export interface DeepgramEventLike {
  is_final?: boolean;
  channel?: {
    alternatives?: Array<{
      words?: DeepgramWordLike[];
    }>;
  };
}

export class DiarizationAssembler {
  private currentChunk: DiarizedChunk | null = null;
  private persisted: DiarizedChunk[] = [];
  private fullText = '';
  private readonly maxChunkDurationSeconds: number;
  private readonly fallbackSpeakerId: number;

  constructor(options?: DiarizationOptions) {
    this.maxChunkDurationSeconds = options?.maxChunkDurationSeconds ?? 30;
    this.fallbackSpeakerId = options?.fallbackSpeakerId ?? -1;
  }

  snapshot(): DiarizationResult {
    return {
      finalized: [...this.persisted],
      interim: this.currentChunk ? { ...this.currentChunk } : null,
      fullText: this.fullText,
    };
  }

  ingest(words: DiarizationWord[], opts?: { isFinal?: boolean }): DiarizationResult {
    if (!Array.isArray(words) || words.length === 0) {
      if (opts?.isFinal && this.currentChunk) {
        this.finalizeCurrent();
      }
      return this.snapshot();
    }

    for (const word of words) {
      const speaker = typeof word.speaker === 'number' ? word.speaker : this.fallbackSpeakerId;
      const text = word.punctuated ?? word.text;

      if (!this.currentChunk) {
        this.currentChunk = {
          speaker,
          text,
          start: word.start,
          end: word.end,
          isFinal: false,
        };
        continue;
      }

      const speakerChanged = speaker !== this.currentChunk.speaker;
      const exceedsDuration = word.end - this.currentChunk.start >= this.maxChunkDurationSeconds;

      if (speakerChanged || exceedsDuration) {
        this.finalizeCurrent();
        this.currentChunk = {
          speaker,
          text,
          start: word.start,
          end: word.end,
          isFinal: false,
        };
        continue;
      }

      this.currentChunk.text = `${this.currentChunk.text} ${text}`.trim();
      this.currentChunk.end = word.end;
    }

    if (opts?.isFinal) {
      this.finalizeCurrent();
    }

    return this.snapshot();
  }

  ingestDeepgramEvent(event: DeepgramEventLike): DiarizationResult {
    const words = event.channel?.alternatives?.[0]?.words;
    return this.ingest(
      (words || []).map((w) => ({
        text: w.word,
        start: w.start,
        end: w.end,
        speaker: w.speaker,
        punctuated: w.punctuated_word,
      })),
      { isFinal: Boolean(event.is_final) }
    );
  }

  private finalizeCurrent(): void {
    if (!this.currentChunk) return;
    const finalized: DiarizedChunk = { ...this.currentChunk, isFinal: true };
    this.persisted.push(finalized);
    this.fullText = this.fullText
      ? `${this.fullText}\n${finalized.text}`
      : finalized.text;
    this.currentChunk = null;
  }
}
