export type PlatformId = 'whatsapp' | 'signal' | 'telegram';

export type PlatformDefinition = {
  id: PlatformId;
  name: string;
  shortName: string;
  color: string;
  kind: 'native' | 'web';
  url?: string;
};

export const platformRegistry: PlatformDefinition[] = [
  { id: 'whatsapp', name: 'WhatsApp', shortName: 'WA', color: '#18b66a', kind: 'web', url: 'https://web.whatsapp.com/' },
  { id: 'signal', name: 'Signal', shortName: 'S', color: '#3a76f0', kind: 'native' },
  { id: 'telegram', name: 'Telegram', shortName: 'TG', color: '#229ed9', kind: 'web', url: 'https://web.telegram.org/k/' }
];

export function getPlatform(id: PlatformId) {
  const platform = platformRegistry.find(item => item.id === id);
  if (!platform) throw new Error(`Unsupported platform: ${id}`);
  return platform;
}
