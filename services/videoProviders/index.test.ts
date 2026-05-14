import { describe, expect, it } from 'vitest';
import {
  getVideoProvider,
  getVideoProviderCatalog,
  getVideoProviderNames,
  getVideoProviderReadiness,
} from './index';

describe('video provider registry', () => {
  it('registers Higgsfield alongside the existing providers', () => {
    expect(getVideoProviderNames()).toEqual(
      expect.arrayContaining(['sora2', 'kling', 'luma', 'runway', 'higgsfield'])
    );

    const provider = getVideoProvider('higgsfield');
    expect(provider.name).toBe('higgsfield');
    expect(provider.displayName).toContain('Higgsfield');
  });

  it('exposes catalog metadata for future UI wiring', () => {
    const catalog = getVideoProviderCatalog();
    const higgsfield = catalog.find(item => item.name === 'higgsfield');

    expect(higgsfield).toMatchObject({
      name: 'higgsfield',
      displayName: 'Higgsfield AI',
      readiness: 'preview',
    });
    expect(higgsfield?.supportedFeatures.textToVideo).toBe(true);
    expect(getVideoProviderReadiness('higgsfield')).toBe('preview');
  });
});
