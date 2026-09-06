export type ProxyScheme = 'http' | 'https' | 'socks5';

export interface AccountFingerprintProfile {
  version: 1;
  accountId: string;
  language: string;
  timezone: string;
  screen: { width: number; height: number; scaleFactor: number };
  hardwareConcurrency: number;
  deviceMemory: number;
  webgl: { vendor: string; renderer: string };
  proxy: {
    enabled: boolean;
    scheme: ProxyScheme;
    host: string;
    port: number;
    username: string;
    password: string;
  };
  seed: string;
  updatedAt: string;
}

export type EditableFingerprintProfile = Omit<
  AccountFingerprintProfile,
  'version' | 'accountId' | 'seed' | 'updatedAt'
>;

