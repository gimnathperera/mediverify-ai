import type { EmbeddingProvider } from '../llm/types.js';

type Extractor = (
  texts: string[],
  opts: { pooling: 'cls' | 'mean'; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

// BGE models expect this instruction on *queries* (not on passages) for retrieval.
const BGE_QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';

/**
 * Local sentence embeddings via transformers.js (ONNX, CPU). Default: Xenova/bge-small-en-v1.5
 * (384-d, ~34 MB quantized). Deterministic, no API key, model baked into the worker image.
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 384;
  private extractor: Promise<Extractor> | null = null;

  constructor(
    readonly model = 'Xenova/bge-small-en-v1.5',
    private readonly cacheDir?: string,
    private readonly batchSize = 16,
  ) {}

  private load(): Promise<Extractor> {
    this.extractor ??= this.loadWithRetry().catch((err: unknown) => {
      // Never cache a failed load: the next call (e.g. the next job) tries again.
      this.extractor = null;
      throw err;
    });
    return this.extractor;
  }

  /** The first run downloads the model from the Hugging Face Hub; retry transient network errors. */
  private async loadWithRetry(attempts = 4): Promise<Extractor> {
    const t = await import('@huggingface/transformers');
    if (this.cacheDir) t.env.cacheDir = this.cacheDir;
    const offline = process.env.EMBEDDING_OFFLINE === 'true';
    if (offline) t.env.allowRemoteModels = false;
    for (let attempt = 1; ; attempt++) {
      try {
        return await t.pipeline('feature-extraction', this.model, { dtype: 'q8' });
      } catch (err) {
        if (offline || attempt >= attempts) throw err;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
      }
    }
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    const extract = await this.load();
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const res = await extract(batch, { pooling: 'cls', normalize: true });
      out.push(...res.tolist());
    }
    return out;
  }

  async embedQuery(text: string): Promise<number[]> {
    const [v] = await this.embedDocuments([BGE_QUERY_PREFIX + text]);
    return v!;
  }
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
  return dot; // vectors are L2-normalized
}
