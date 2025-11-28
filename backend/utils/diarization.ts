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
  raw?: DeepgramWordLike[];
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
  channel?: { alternatives?: Array<{ words?: DeepgramWordLike[] }> };
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
      interim: this.currentChunk ? { ...this.currentChunk, raw: this.currentChunk.raw } : null,
      fullText: this.fullText
    };
  }

  ingest(words: DiarizationWord[], opts?: { isFinal?: boolean }): DiarizationResult {
    for (const word of words) {
      const speaker = typeof word.speaker === 'number' ? word.speaker : this.fallbackSpeakerId;
      this.consumeWord({ ...word, speaker });
    }

    if (opts?.isFinal) {
      this.finalizeCurrentChunk();
    }

    return this.snapshot();
  }

  ingestDeepgramEvent(event: DeepgramEventLike): DiarizationResult {
    const alt = event.channel?.alternatives?.[0];
    const words = alt?.words ?? [];
    const diarizationWords: DiarizationWord[] = words.map((word) => ({
      text: word.word,
      punctuated: word.punctuated_word,
      start: word.start,
      end: word.end,
      speaker: word.speaker
    }));

    return this.ingest(diarizationWords, { isFinal: event.is_final });
  }

  private consumeWord(word: DiarizationWord & { speaker: number }): void {
    if (!this.currentChunk) {
      this.startNewChunk(word);
      return;
    }

    const speakerChanged = word.speaker !== this.currentChunk.speaker;
    const durationExceeded = word.end - this.currentChunk.start >= this.maxChunkDurationSeconds;

    if (speakerChanged || durationExceeded) {
      this.finalizeCurrentChunk();
      this.startNewChunk(word);
      return;
    }

    this.currentChunk.text = this.concatWord(this.currentChunk.text, word);
    this.currentChunk.end = word.end;
    this.currentChunk.raw?.push({
      word: word.text,
      punctuated_word: word.punctuated,
      start: word.start,
      end: word.end,
      speaker: word.speaker
    });
  }

  private startNewChunk(word: DiarizationWord & { speaker: number }): void {
    this.currentChunk = {
      speaker: word.speaker,
      text: word.punctuated ?? word.text,
      start: word.start,
      end: word.end,
      isFinal: false,
      raw: [
        {
          word: word.text,
          punctuated_word: word.punctuated,
          start: word.start,
          end: word.end,
          speaker: word.speaker
        }
      ]
    };
  }

  private finalizeCurrentChunk(): void {
    if (!this.currentChunk) return;

    const finalized = { ...this.currentChunk, isFinal: true };
    this.persisted.push(finalized);
    this.fullText = this.fullText ? `${this.fullText}\n${finalized.text}` : finalized.text;
    this.currentChunk = null;
  }

  private concatWord(text: string, word: DiarizationWord): string {
    if (!text) return word.punctuated ?? word.text;
    const next = word.punctuated ?? word.text;
    if (/^[.,!?;:]/.test(next)) {
      return `${text}${next}`;
    }
    return `${text} ${next}`;
  }
}
