'use strict';

const { webFrame } = require('electron');

function bootstrap() {
  const prefix = '--caisheng-whatsapp-profile=';
  const encoded = process.argv.find(value => value.startsWith(prefix));
  if (!encoded) return;

  let profile;
  try {
    profile = JSON.parse(Buffer.from(encoded.slice(prefix.length), 'base64url').toString('utf8'));
  } catch {
    return;
  }

  // Preload 在站点脚本执行前运行；在主世界安装不可枚举的稳定指纹覆盖。
  const source = `(() => {
    'use strict';
    const profile = ${JSON.stringify(profile)};
    const define = (target, key, value) => {
      try { Object.defineProperty(target, key, { configurable: true, enumerable: false, get: () => value }); } catch {}
    };
    define(navigator, 'language', profile.language);
    define(navigator, 'languages', [profile.language, profile.language.split('-')[0]]);
    define(navigator, 'hardwareConcurrency', profile.cpuCores);
    define(navigator, 'deviceMemory', profile.memoryGB);
    define(screen, 'width', profile.width);
    define(screen, 'height', profile.height);
    define(screen, 'availWidth', profile.width);
    define(screen, 'availHeight', profile.height);
    define(window, 'devicePixelRatio', profile.scaleFactor);

    const patchWebGL = prototype => {
      if (!prototype || !prototype.getParameter) return;
      const original = prototype.getParameter;
      Object.defineProperty(prototype, 'getParameter', {
        configurable: true,
        value(parameter) {
          if (parameter === 37445) return profile.webglVendor;
          if (parameter === 37446) return profile.webglRenderer;
          return Reflect.apply(original, this, [parameter]);
        }
      });
    };
    patchWebGL(globalThis.WebGLRenderingContext?.prototype);
    patchWebGL(globalThis.WebGL2RenderingContext?.prototype);

    // 每个账号使用由账号 ID 派生的固定微扰；同一账号重启后保持一致。
    if (profile.canvasNoise && globalThis.CanvasRenderingContext2D) {
      const original = CanvasRenderingContext2D.prototype.getImageData;
      Object.defineProperty(CanvasRenderingContext2D.prototype, 'getImageData', {
        configurable: true,
        value(...args) {
          const data = Reflect.apply(original, this, args);
          if (data?.data?.length) data.data[0] = (data.data[0] + profile.noise) & 255;
          return data;
        }
      });
    }
  })();`;
  webFrame.executeJavaScript(source, true).catch(() => {});
}

bootstrap();
