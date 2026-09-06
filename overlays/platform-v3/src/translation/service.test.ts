import { TranslationService } from './service';
import type { TranslationProvider } from './types';

describe('TranslationService', () => {
  const google: TranslationProvider = {
    id: 'google',
    translate: jest.fn(async request => ({ text: `ZH:${request.text}`, error: false, provider: 'google' })),
  };

  beforeEach(() => jest.clearAllMocks());

  it('空白内容不请求翻译服务', async () => {
    const service = new TranslationService([google]);
    await expect(service.translate({ text: '   ' })).resolves.toEqual({ text: '', error: false, provider: 'google' });
    expect(google.translate).not.toHaveBeenCalled();
  });

  it('默认使用 Google 并翻译为简体中文', async () => {
    const service = new TranslationService([google]);
    await service.translate({ text: ' hello ' });
    expect(google.translate).toHaveBeenCalledWith(expect.objectContaining({ text: 'hello', targetLanguage: 'zh-CN' }));
  });

  it('未注册服务时只返回中文错误', async () => {
    const service = new TranslationService([]);
    const result = await service.translate({ text: 'hello', provider: 'ai' });
    expect(result.error).toBe(true);
    expect(result.text).toMatch(/[一-鿿]/);
    expect(result.text).not.toContain('Error invoking remote method');
  });
});
