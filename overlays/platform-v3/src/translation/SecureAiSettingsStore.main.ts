import { promises as fs } from 'node:fs';
import path from 'node:path';
import { app, safeStorage } from 'electron';
import type { AiModelConfiguration, AiModelSettingsPatch, AiModelSettingsStore, AiModelSettingsView } from './types';

const DEFAULTS = {
  enabled: false,
  endpoint: 'https://api.openai.com/v1/chat/completions',
  model: '',
  temperature: 0.1,
  timeoutMs: 30_000,
} as const;

export class SecureAiSettingsStore implements AiModelSettingsStore {
  private readonly filePath: string;

  constructor(filePath = path.join(app.getPath('userData'), 'secure', 'ai-translation.bin')) {
    this.filePath = filePath;
  }

  async load(): Promise<AiModelConfiguration | undefined> {
    try {
      if (!safeStorage.isEncryptionAvailable()) return undefined;
      const encrypted = await fs.readFile(this.filePath);
      return JSON.parse(safeStorage.decryptString(encrypted)) as AiModelConfiguration;
    } catch {
      return undefined;
    }
  }

  async view(): Promise<AiModelSettingsView> {
    const current = await this.load();
    return {
      enabled: current?.enabled ?? DEFAULTS.enabled,
      endpoint: current?.endpoint ?? DEFAULTS.endpoint,
      model: current?.model ?? DEFAULTS.model,
      temperature: current?.temperature ?? DEFAULTS.temperature,
      timeoutMs: current?.timeoutMs ?? DEFAULTS.timeoutMs,
      systemPrompt: current?.systemPrompt,
      hasApiKey: Boolean(current?.apiKey),
    };
  }

  async save(patch: AiModelSettingsPatch): Promise<AiModelSettingsView> {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储不可用，无法保存 AI 密钥。');
    const current = await this.load();
    const apiKey = patch.apiKey === undefined ? current?.apiKey ?? '' : patch.apiKey.trim();
    const next: AiModelConfiguration = {
      ...DEFAULTS,
      ...current,
      ...patch,
      endpoint: (patch.endpoint ?? current?.endpoint ?? DEFAULTS.endpoint).trim(),
      model: (patch.model ?? current?.model ?? '').trim(),
      apiKey,
    };
    const encrypted = safeStorage.encryptString(JSON.stringify(next));
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    await fs.writeFile(temporary, encrypted, { mode: 0o600 });
    await fs.rename(temporary, this.filePath);
    return this.view();
  }

  async clear(): Promise<void> {
    await fs.rm(this.filePath, { force: true });
  }
}
