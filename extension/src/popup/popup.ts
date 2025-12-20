import { storage } from '@shared/storage';
import { LANGUAGE_NAMES, DEBOUNCE_DELAY } from '@shared/constants';
import type { TranslationSettings } from '@shared/types';

class PopupController {
  private elements!: {
    toggleBtn: HTMLButtonElement;
    sourceText: HTMLTextAreaElement;
    translatedText: HTMLDivElement;
    sourceLang: HTMLButtonElement;
    targetLang: HTMLButtonElement;
    swapLang: HTMLButtonElement;
    clearInput: HTMLButtonElement;
    copyResult: HTMLButtonElement;
  };
  private debounceTimer: number | null = null;
  private settings!: TranslationSettings;

  constructor() {
    this.init();
  }

  private async init(): Promise<void> {
    this.elements = this.getElements();
    await this.loadSettings();
    this.setupEventListeners();
    this.updateUI();
  }

  private getElements() {
    return {
      toggleBtn: document.getElementById('toggle-translate') as HTMLButtonElement,
      sourceText: document.getElementById('source-text') as HTMLTextAreaElement,
      translatedText: document.getElementById('translated-text') as HTMLDivElement,
      sourceLang: document.getElementById('source-lang') as HTMLButtonElement,
      targetLang: document.getElementById('target-lang') as HTMLButtonElement,
      swapLang: document.getElementById('swap-lang') as HTMLButtonElement,
      clearInput: document.getElementById('clear-input') as HTMLButtonElement,
      copyResult: document.getElementById('copy-result') as HTMLButtonElement
    };
  }

  private async loadSettings(): Promise<void> {
    this.settings = await storage.getSettings();
  }

  private setupEventListeners(): void {
    this.elements.toggleBtn.addEventListener('click', () => this.togglePageTranslation());
    this.elements.sourceText.addEventListener('input', () => this.handleInputChange());
    this.elements.swapLang.addEventListener('click', () => this.swapLanguages());
    this.elements.clearInput.addEventListener('click', () => this.clearInput());
    this.elements.copyResult.addEventListener('click', () => this.copyResult());
  }

  private async togglePageTranslation(): Promise<void> {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) return;

      const response = await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_TRANSLATION' });
      const isActive = response?.enabled ?? !this.settings.autoTranslate;

      this.elements.toggleBtn.classList.toggle('active', isActive);
      this.settings.autoTranslate = isActive;
      await storage.updateSettings({ autoTranslate: isActive });
    } catch (error) {
      this.settings.autoTranslate = !this.settings.autoTranslate;
      this.elements.toggleBtn.classList.toggle('active', this.settings.autoTranslate);
      await storage.updateSettings({ autoTranslate: this.settings.autoTranslate });
    }
  }

  private handleInputChange(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = window.setTimeout(() => {
      this.translateInput();
    }, DEBOUNCE_DELAY);
  }

  private async translateInput(): Promise<void> {
    const text = this.elements.sourceText.value.trim();

    if (!text) {
      this.showPlaceholder();
      return;
    }

    this.elements.translatedText.classList.add('loading');
    this.elements.translatedText.innerHTML = '<span class="placeholder">번역 중...</span>';

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'TRANSLATE_TEXT',
        payload: {
          texts: [text],
          sourceLang: this.settings.sourceLang,
          targetLang: this.settings.targetLang
        }
      });

      if (response?.success && response.data?.[0]) {
        this.elements.translatedText.textContent = response.data[0].translated;
      } else {
        this.elements.translatedText.innerHTML =
          '<span class="placeholder">번역 중 오류가 발생했습니다</span>';
      }
    } catch (error) {
      this.elements.translatedText.innerHTML =
        '<span class="placeholder">번역 서비스에 연결할 수 없습니다</span>';
    } finally {
      this.elements.translatedText.classList.remove('loading');
    }
  }

  private async swapLanguages(): Promise<void> {
    this.elements.swapLang.classList.add('spinning');

    [this.settings.sourceLang, this.settings.targetLang] =
      [this.settings.targetLang, this.settings.sourceLang];

    await storage.updateSettings({
      sourceLang: this.settings.sourceLang,
      targetLang: this.settings.targetLang
    });

    this.updateLanguageButtons();

    setTimeout(() => {
      this.elements.swapLang.classList.remove('spinning');
    }, 300);

    if (this.elements.sourceText.value.trim()) {
      this.translateInput();
    }
  }

  private clearInput(): void {
    this.elements.sourceText.value = '';
    this.showPlaceholder();
    this.elements.sourceText.focus();
  }

  private showPlaceholder(): void {
    this.elements.translatedText.innerHTML =
      '<span class="placeholder">번역 결과가 여기에 표시됩니다</span>';
  }

  private async copyResult(): Promise<void> {
    const text = this.elements.translatedText.textContent;
    const hasPlaceholder = this.elements.translatedText.querySelector('.placeholder');

    if (text && !hasPlaceholder) {
      await navigator.clipboard.writeText(text);
      this.elements.copyResult.classList.add('copied');

      setTimeout(() => {
        this.elements.copyResult.classList.remove('copied');
      }, 1000);
    }
  }

  private updateUI(): void {
    this.updateLanguageButtons();
    this.elements.toggleBtn.classList.toggle('active', this.settings.autoTranslate);
  }

  private updateLanguageButtons(): void {
    const source = LANGUAGE_NAMES[this.settings.sourceLang];
    const target = LANGUAGE_NAMES[this.settings.targetLang];

    this.elements.sourceLang.innerHTML =
      `<span class="lang-code">${source.code}</span>
       <span class="lang-name">${source.name}</span>`;
    this.elements.targetLang.innerHTML =
      `<span class="lang-code">${target.code}</span>
       <span class="lang-name">${target.name}</span>`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new PopupController();
});
