/**
 * Diarization Utilities
 *
 * Chunk aggregation logic for transcript assembly.
 * Rules: Start new chunk on speaker change OR duration > 30s
 */

export interface WordResult {
  word: string;
  start: number;
  end: number;
  confidence: number;
  speaker: number;
}

export interface AggregatedChunk {
  speaker: number;
  text: string;
  start: number;
  end: number;
  word_count: number;
  raw: WordResult[];
}

export interface ChunkAggregatorConfig {
  maxDurationSeconds: number;
  onChunkComplete: (chunk: AggregatedChunk) => void;
}

export class ChunkAggregator {
  private config: ChunkAggregatorConfig;
  private currentChunk: AggregatedChunk | null = null;

  constructor(config: ChunkAggregatorConfig) {
    this.config = config;
  }

  /**
   * Add words to the aggregator
   * Automatically flushes on speaker change or duration threshold
   */
  addWords(words: WordResult[]): void {
    for (const word of words) {
      this.addWord(word);
    }
  }

  /**
   * Add a single word
   */
  addWord(word: WordResult): void {
    // Start new chunk if none exists
    if (!this.currentChunk) {
      this.startNewChunk(word);
      return;
    }

    // Check if we need to start a new chunk
    const shouldFlush =
      // Speaker changed
      word.speaker !== this.currentChunk.speaker ||
      // Duration exceeded
      (word.end - this.currentChunk.start) > this.config.maxDurationSeconds;

    if (shouldFlush) {
      this.flush();
      this.startNewChunk(word);
    } else {
      // Append to current chunk
      this.currentChunk.raw.push(word);
      this.currentChunk.end = word.end;
      this.currentChunk.word_count++;
    }
  }

  /**
   * Force flush current chunk (e.g., on utterance end)
   */
  forceFlush(): void {
    this.flush();
  }

  /**
   * Get current chunk without flushing
   */
  getCurrentChunk(): AggregatedChunk | null {
    return this.currentChunk ? this.buildChunk() : null;
  }

  private startNewChunk(word: WordResult): void {
    this.currentChunk = {
      speaker: word.speaker,
      text: '',
      start: word.start,
      end: word.end,
      word_count: 1,
      raw: [word]
    };
  }

  private flush(): void {
    if (!this.currentChunk || this.currentChunk.raw.length === 0) return;

    const chunk = this.buildChunk();
    this.config.onChunkComplete(chunk);
    this.currentChunk = null;
  }

  private buildChunk(): AggregatedChunk {
    if (!this.currentChunk) {
      throw new Error('No current chunk');
    }

    // Build text from raw words with proper spacing
    const text = this.currentChunk.raw
      .map((w) => w.word)
      .join(' ')
      .replace(/\s+([.,!?;:])/g, '$1'); // Fix punctuation spacing

    return {
      speaker: this.currentChunk.speaker,
      text,
      start: this.currentChunk.start,
      end: this.currentChunk.end,
      word_count: this.currentChunk.raw.length,
      raw: [...this.currentChunk.raw]
    };
  }
}

/**
 * Format speaker label for display
 * Speaker 0 = Provider, Speaker 1+ = Patient/Other
 */
export function formatSpeakerLabel(speaker: number): string {
  if (speaker === 0) return 'Provider';
  if (speaker === 1) return 'Patient';
  return `Speaker ${speaker}`;
}

/**
 * Calculate total duration of chunks
 */
export function getTotalDuration(chunks: AggregatedChunk[]): number {
  if (chunks.length === 0) return 0;
  const start = Math.min(...chunks.map((c) => c.start));
  const end = Math.max(...chunks.map((c) => c.end));
  return end - start;
}

/**
 * Get word count by speaker
 */
export function getWordCountBySpeaker(
  chunks: AggregatedChunk[]
): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const chunk of chunks) {
    counts[chunk.speaker] = (counts[chunk.speaker] || 0) + chunk.word_count;
  }
  return counts;
}
