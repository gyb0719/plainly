import type { TranslatedText } from '@shared/types';
import type { TextNodeInfo } from './text-extractor';

interface TranslationRecord {
  node: Text;
  original: string;
  translated: string;
}

export class DomTranslator {
  private translations: TranslationRecord[] = [];
  private isTranslated = false;

  applyTranslations(
    textNodes: TextNodeInfo[],
    translatedTexts: TranslatedText[]
  ): void {
    if (textNodes.length !== translatedTexts.length) {
      return;
    }

    for (let i = 0; i < textNodes.length; i++) {
      const nodeInfo = textNodes[i];
      const translation = translatedTexts[i];

      if (!translation || translation.original === translation.translated) {
        continue;
      }

      this.translations.push({
        node: nodeInfo.node,
        original: nodeInfo.originalText,
        translated: translation.translated
      });

      this.replaceNodeText(nodeInfo.node, translation.translated);
    }

    this.isTranslated = true;
  }

  private replaceNodeText(node: Text, newText: string): void {
    const originalFull = node.textContent || '';
    const leadingWhitespace = originalFull.match(/^\s*/)?.[0] || '';
    const trailingWhitespace = originalFull.match(/\s*$/)?.[0] || '';

    node.textContent = leadingWhitespace + newText + trailingWhitespace;
  }

  restoreOriginal(): void {
    if (!this.isTranslated) return;

    for (const record of this.translations) {
      if (record.node.parentNode) {
        this.replaceNodeText(record.node, record.original);
      }
    }

    this.translations = [];
    this.isTranslated = false;
  }

  getStatus(): { isTranslated: boolean; count: number } {
    return {
      isTranslated: this.isTranslated,
      count: this.translations.length
    };
  }

  clear(): void {
    this.translations = [];
    this.isTranslated = false;
  }
}

export const domTranslator = new DomTranslator();
