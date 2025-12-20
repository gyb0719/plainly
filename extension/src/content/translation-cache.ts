interface CacheEntry {
  translated: string;
  timestamp: number;
}

export class TranslationCache {
  private cache = new Map<string, CacheEntry>();
  private readonly maxSize = 1000;
  private readonly ttl = 24 * 60 * 60 * 1000;

  private generateKey(text: string, sourceLang: string, targetLang: string): string {
    return `${sourceLang}:${targetLang}:${text}`;
  }

  get(text: string, sourceLang: string, targetLang: string): string | null {
    const key = this.generateKey(text, sourceLang, targetLang);
    const entry = this.cache.get(key);

    if (!entry) return null;

    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.translated;
  }

  set(text: string, translated: string, sourceLang: string, targetLang: string): void {
    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }

    const key = this.generateKey(text, sourceLang, targetLang);
    this.cache.set(key, {
      translated,
      timestamp: Date.now()
    });
  }

  getMultiple(
    texts: string[],
    sourceLang: string,
    targetLang: string
  ): { cached: Map<number, string>; uncached: Array<{ index: number; text: string }> } {
    const cached = new Map<number, string>();
    const uncached: Array<{ index: number; text: string }> = [];

    texts.forEach((text, index) => {
      const cachedTranslation = this.get(text, sourceLang, targetLang);
      if (cachedTranslation) {
        cached.set(index, cachedTranslation);
      } else {
        uncached.push({ index, text });
      }
    });

    return { cached, uncached };
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }

  clear(): void {
    this.cache.clear();
  }
}

export const translationCache = new TranslationCache();
