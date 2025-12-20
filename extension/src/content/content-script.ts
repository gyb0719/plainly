import { textExtractor, type TextNodeInfo } from './text-extractor';
import { domTranslator } from './dom-translator';
import { translationCache } from './translation-cache';
import { storage } from '@shared/storage';
import { MAX_TEXTS_PER_REQUEST, MAX_CONCURRENT_REQUESTS } from '@shared/constants';
import type { LanguageCode, TranslatedText } from '@shared/types';

class PlainlyContentScript {
  private isEnabled = false;
  private observer: MutationObserver | null = null;
  private shadowObservers: MutationObserver[] = [];
  private settings: { sourceLang: LanguageCode; targetLang: LanguageCode } = {
    sourceLang: 'en',
    targetLang: 'ko'
  };
  private translatingNodes = new Set<Text>();

  constructor() {
    this.init();
  }

  private async init(): Promise<void> {
    const settings = await storage.getSettings();
    this.settings.sourceLang = settings.sourceLang;
    this.settings.targetLang = settings.targetLang;

    if (settings.autoTranslate) {
      await this.enable();
    }

    this.listenForMessages();
    this.listenForStorageChanges();
  }

  private listenForMessages(): void {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === 'TOGGLE_TRANSLATION') {
        this.toggle().then(() => {
          sendResponse({ enabled: this.isEnabled });
        });
        return true;
      }

      if (message.type === 'GET_STATUS') {
        const status = domTranslator.getStatus();
        sendResponse({
          ...status,
          autoTranslate: this.isEnabled
        });
        return true;
      }

      return false;
    });
  }

  private listenForStorageChanges(): void {
    storage.onChanged((changes) => {
      if (changes.settings?.newValue) {
        const newSettings = changes.settings.newValue;
        this.settings.sourceLang = newSettings.sourceLang;
        this.settings.targetLang = newSettings.targetLang;
      }
    });
  }

  async enable(): Promise<void> {
    if (this.isEnabled) return;

    this.isEnabled = true;
    await this.translateVisibleContent();
    this.observeDomChanges();
  }

  disable(): void {
    if (!this.isEnabled) return;

    this.isEnabled = false;
    this.observer?.disconnect();
    this.observer = null;
    this.shadowObservers.forEach((obs) => obs.disconnect());
    this.shadowObservers = [];
    domTranslator.restoreOriginal();
  }

  async toggle(): Promise<void> {
    if (this.isEnabled) {
      this.disable();
    } else {
      await this.enable();
    }
  }

  private isInViewport(element: Element): boolean {
    const rect = element.getBoundingClientRect();
    return (
      rect.top < window.innerHeight &&
      rect.bottom > 0 &&
      rect.left < window.innerWidth &&
      rect.right > 0
    );
  }

  private sortByViewport(nodes: TextNodeInfo[]): TextNodeInfo[] {
    return [...nodes].sort((a, b) => {
      const aVisible = this.isInViewport(a.parentElement) ? 1 : 0;
      const bVisible = this.isInViewport(b.parentElement) ? 1 : 0;
      return bVisible - aVisible;
    });
  }

  private async translateVisibleContent(): Promise<void> {
    const textNodes = textExtractor.extractTextNodes(document.body);
    if (textNodes.length === 0) return;

    const sortedNodes = this.sortByViewport(textNodes);
    await this.translateNodesParallel(sortedNodes);
  }

  private async translateNodesParallel(textNodes: TextNodeInfo[]): Promise<void> {
    const newNodes = textNodes.filter((n) => {
      if (this.translatingNodes.has(n.node)) return false;
      return textExtractor.isSourceLanguage(n.originalText, this.settings.sourceLang);
    });
    if (newNodes.length === 0) return;

    newNodes.forEach((n) => this.translatingNodes.add(n.node));

    try {
      const texts = newNodes.map((n) => n.originalText);

      const { cached, uncached } = translationCache.getMultiple(
        texts,
        this.settings.sourceLang,
        this.settings.targetLang
      );

      if (cached.size > 0) {
        const cachedNodes: TextNodeInfo[] = [];
        const cachedResults: TranslatedText[] = [];

        cached.forEach((translated, index) => {
          cachedNodes.push(newNodes[index]);
          cachedResults.push({ original: texts[index], translated });
        });

        if (this.isEnabled) {
          domTranslator.applyTranslations(cachedNodes, cachedResults);
        }
      }

      if (uncached.length > 0) {
        const batches: Array<{ indices: Array<{ index: number; text: string }>; nodes: TextNodeInfo[] }> = [];

        for (let i = 0; i < uncached.length; i += MAX_TEXTS_PER_REQUEST) {
          const batchIndices = uncached.slice(i, i + MAX_TEXTS_PER_REQUEST);
          const batchNodes = batchIndices.map((u) => newNodes[u.index]);
          batches.push({ indices: batchIndices, nodes: batchNodes });
        }

        const translateBatch = async (batch: typeof batches[0]) => {
          const batchTexts = batch.indices.map((u) => u.text);

          const response = await chrome.runtime.sendMessage({
            type: 'TRANSLATE_TEXT',
            payload: {
              texts: batchTexts,
              sourceLang: this.settings.sourceLang,
              targetLang: this.settings.targetLang
            }
          });

          if (response?.success && response.data) {
            const results: TranslatedText[] = response.data;

            results.forEach((result: TranslatedText) => {
              translationCache.set(
                result.original,
                result.translated,
                this.settings.sourceLang,
                this.settings.targetLang
              );
            });

            if (this.isEnabled) {
              domTranslator.applyTranslations(batch.nodes, results);
            }
          }
        };

        for (let i = 0; i < batches.length; i += MAX_CONCURRENT_REQUESTS) {
          const concurrentBatches = batches.slice(i, i + MAX_CONCURRENT_REQUESTS);
          await Promise.all(concurrentBatches.map(translateBatch));
        }
      }
    } finally {
      newNodes.forEach((n) => this.translatingNodes.delete(n.node));
    }
  }

  private observeDomChanges(): void {
    if (this.observer) {
      this.observer.disconnect();
    }
    this.shadowObservers.forEach((obs) => obs.disconnect());
    this.shadowObservers = [];

    let debounceTimer: number | null = null;
    const pendingNodes: (Element | ShadowRoot)[] = [];

    const handleMutations = (mutations: MutationRecord[]) => {
      if (!this.isEnabled) return;

      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node as Element;
            pendingNodes.push(element);

            if (element.shadowRoot) {
              this.observeShadowRoot(element.shadowRoot, handleMutations);
              pendingNodes.push(element.shadowRoot);
            }

            element.querySelectorAll('*').forEach((child) => {
              if (child.shadowRoot) {
                this.observeShadowRoot(child.shadowRoot, handleMutations);
                pendingNodes.push(child.shadowRoot);
              }
            });
          }
        });
      });

      if (pendingNodes.length > 0 && !debounceTimer) {
        debounceTimer = window.setTimeout(() => {
          const nodesToProcess = [...pendingNodes];
          pendingNodes.length = 0;
          debounceTimer = null;

          nodesToProcess.forEach((node) => {
            const textNodes = textExtractor.extractTextNodes(node);
            if (textNodes.length > 0) {
              this.translateNodesParallel(textNodes);
            }
          });
        }, 100);
      }
    };

    this.observer = new MutationObserver(handleMutations);

    this.observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    this.observeExistingShadowRoots(handleMutations);
  }

  private observeShadowRoot(
    shadowRoot: ShadowRoot,
    callback: (mutations: MutationRecord[]) => void
  ): void {
    const observer = new MutationObserver(callback);
    observer.observe(shadowRoot, {
      childList: true,
      subtree: true
    });
    this.shadowObservers.push(observer);
  }

  private observeExistingShadowRoots(
    callback: (mutations: MutationRecord[]) => void
  ): void {
    document.body.querySelectorAll('*').forEach((el) => {
      if (el.shadowRoot) {
        this.observeShadowRoot(el.shadowRoot, callback);
      }
    });
  }
}

new PlainlyContentScript();
