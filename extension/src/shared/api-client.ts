import type { LanguageCode, TranslatedText, TranslationResponse } from './types';
import { API_URL, MAX_TEXTS_PER_REQUEST } from './constants';

export class ApiClient {
  private readonly apiUrl: string;

  constructor(apiUrl: string = API_URL) {
    this.apiUrl = apiUrl;
  }

  async translate(
    texts: string[],
    sourceLang: LanguageCode,
    targetLang: LanguageCode
  ): Promise<TranslatedText[]> {
    if (texts.length === 0) {
      return [];
    }

    if (texts.length > MAX_TEXTS_PER_REQUEST) {
      return this.translateInBatches(texts, sourceLang, targetLang);
    }

    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        texts,
        sourceLang,
        targetLang
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Translation API error: ${response.status} - ${errorText}`);
    }

    const result: TranslationResponse = await response.json();

    if (!result.success || !result.data) {
      throw new Error(result.error || 'Translation failed');
    }

    return result.data;
  }

  private async translateInBatches(
    texts: string[],
    sourceLang: LanguageCode,
    targetLang: LanguageCode
  ): Promise<TranslatedText[]> {
    const results: TranslatedText[] = [];

    for (let i = 0; i < texts.length; i += MAX_TEXTS_PER_REQUEST) {
      const batch = texts.slice(i, i + MAX_TEXTS_PER_REQUEST);
      const batchResults = await this.translate(batch, sourceLang, targetLang);
      results.push(...batchResults);
    }

    return results;
  }
}

export const apiClient = new ApiClient();
