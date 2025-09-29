export interface ProviderCapabilities {
  /** null if provider cannot inline breaks */
  maxInlineBreakSeconds: number | null;
  maxCharsPerRequest?: number;
  renderInlineBreak?: (seconds: number) => string;
}

export interface GenerationResult {
  audio: Buffer;
  mimeType?: string;
  duration?: number;
  size?: number;
}

export interface TtsProvider {
  readonly id: string;
  readonly caps: ProviderCapabilities;
  generate(chunk: string): Promise<GenerationResult>;
}
