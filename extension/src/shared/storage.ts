import type { StorageSchema, TranslationSettings } from './types';
import { DEFAULT_SETTINGS } from './constants';

type StorageKey = keyof StorageSchema;

export class StorageService {
  private readonly defaults: Partial<StorageSchema> = {
    settings: DEFAULT_SETTINGS,
    domainSettings: {}
  };

  async get<K extends StorageKey>(keys: K[]): Promise<Pick<StorageSchema, K>> {
    return new Promise((resolve) => {
      chrome.storage.sync.get(keys, (result) => {
        const merged = {} as Pick<StorageSchema, K>;
        for (const key of keys) {
          merged[key] = result[key] ?? this.defaults[key];
        }
        resolve(merged);
      });
    });
  }

  async set<K extends StorageKey>(data: Partial<Pick<StorageSchema, K>>): Promise<void> {
    return new Promise((resolve) => {
      chrome.storage.sync.set(data, resolve);
    });
  }

  async getSettings(): Promise<TranslationSettings> {
    const { settings } = await this.get(['settings']);
    return settings;
  }

  async updateSettings(partial: Partial<TranslationSettings>): Promise<void> {
    const current = await this.getSettings();
    await this.set({
      settings: { ...current, ...partial }
    });
  }

  async getDomainAutoTranslate(domain: string): Promise<boolean> {
    const { domainSettings, settings } = await this.get(['domainSettings', 'settings']);
    return domainSettings[domain]?.autoTranslate ?? settings.autoTranslate;
  }

  async setDomainAutoTranslate(domain: string, autoTranslate: boolean): Promise<void> {
    const { domainSettings } = await this.get(['domainSettings']);
    domainSettings[domain] = {
      autoTranslate,
      lastTranslated: Date.now()
    };
    await this.set({ domainSettings });
  }

  onChanged(callback: (changes: { [key: string]: chrome.storage.StorageChange }) => void): void {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'sync') {
        callback(changes);
      }
    });
  }
}

export const storage = new StorageService();
