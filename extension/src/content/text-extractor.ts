import { SKIP_TAGS, MIN_TEXT_LENGTH, MAX_TEXT_LENGTH } from '@shared/constants';
import type { LanguageCode } from '@shared/types';

export interface TextNodeInfo {
  node: Text;
  originalText: string;
  parentElement: Element;
}

export class TextExtractor {
  extractTextNodes(root: Element | ShadowRoot): TextNodeInfo[] {
    const textNodes: TextNodeInfo[] = [];
    this.extractFromNode(root, textNodes);
    return textNodes;
  }

  private extractFromNode(root: Element | ShadowRoot, textNodes: TextNodeInfo[]): void {
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: (node) => {
          if (node.nodeType === Node.TEXT_NODE) {
            return this.filterTextNode(node as Text);
          }
          return NodeFilter.FILTER_SKIP;
        }
      }
    );

    let currentNode: Node | null;
    while ((currentNode = walker.nextNode())) {
      if (currentNode.nodeType === Node.TEXT_NODE) {
        const textNode = currentNode as Text;
        const parentElement = textNode.parentElement;
        if (!parentElement) continue;

        const text = textNode.textContent?.trim() || '';
        if (text.length < MIN_TEXT_LENGTH || text.length > MAX_TEXT_LENGTH) continue;

        if (!this.isElementVisible(parentElement)) continue;

        textNodes.push({
          node: textNode,
          originalText: text,
          parentElement
        });
      }
    }

    this.extractFromShadowRoots(root, textNodes);
  }

  private extractFromShadowRoots(root: Element | ShadowRoot, textNodes: TextNodeInfo[]): void {
    const elements = root.querySelectorAll('*');
    elements.forEach((el) => {
      if (el.shadowRoot) {
        this.extractFromNode(el.shadowRoot, textNodes);
      }
    });
  }

  private filterTextNode(node: Text): number {
    const parent = node.parentElement;
    if (!parent) return NodeFilter.FILTER_REJECT;

    if (SKIP_TAGS.has(parent.tagName)) {
      return NodeFilter.FILTER_REJECT;
    }

    if (parent.isContentEditable) {
      return NodeFilter.FILTER_REJECT;
    }

    if (
      parent instanceof HTMLInputElement ||
      parent instanceof HTMLTextAreaElement ||
      parent instanceof HTMLSelectElement
    ) {
      return NodeFilter.FILTER_REJECT;
    }

    const text = node.textContent?.trim();
    if (!text) return NodeFilter.FILTER_REJECT;

    if (this.isNonTranslatable(text)) {
      return NodeFilter.FILTER_REJECT;
    }

    return NodeFilter.FILTER_ACCEPT;
  }

  private isElementVisible(element: Element): boolean {
    const style = window.getComputedStyle(element);

    if (style.display === 'none') return false;
    if (style.visibility === 'hidden') return false;
    if (style.opacity === '0') return false;

    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;

    return true;
  }

  private isNonTranslatable(text: string): boolean {
    const letterCount = (text.match(/[a-zA-Z가-힣]/g) || []).length;
    return letterCount / text.length < 0.3;
  }

  detectLanguage(text: string): 'ko' | 'en' | 'mixed' {
    const koreanChars = (text.match(/[가-힣]/g) || []).length;
    const englishChars = (text.match(/[a-zA-Z]/g) || []).length;
    const total = koreanChars + englishChars;

    if (total === 0) return 'mixed';

    const koreanRatio = koreanChars / total;
    if (koreanRatio > 0.7) return 'ko';
    if (koreanRatio < 0.3) return 'en';
    return 'mixed';
  }

  isSourceLanguage(text: string, sourceLang: LanguageCode): boolean {
    const detected = this.detectLanguage(text);
    if (detected === 'mixed') return true;
    return detected === sourceLang;
  }
}

export const textExtractor = new TextExtractor();
