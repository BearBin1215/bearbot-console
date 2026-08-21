import { describe, expect, it } from 'vitest';
import { createDefaultSettings } from '@shared/settings';

describe('createDefaultSettings', () => {
  it('根据应用版本生成默认 User-Agent', () => {
    expect(createDefaultSettings('1.2.3').userAgent).toBe('bearbot-console/1.2.3');
  });

  it('每次创建独立的背景图片数组', () => {
    const first = createDefaultSettings('1.0.0');
    const second = createDefaultSettings('1.0.0');
    first.backgroundImages.push('test.png');

    expect(second.backgroundImages).toEqual([]);
  });
});
