import { describe, expect, it } from 'vitest';
import {
  buildSora2VideoConfig,
  inferLegacyVideoResolution,
  resolveVideoProviderKey,
} from './videoProviderRouting';

describe('video provider routing', () => {
  it('routes Sora 2 models to the provider registry', () => {
    expect(resolveVideoProviderKey('sora-2')).toBe('sora2');
    expect(resolveVideoProviderKey('sora-2-pro')).toBe('sora2');
    expect(resolveVideoProviderKey('sora2')).toBe('sora2');
  });

  it('leaves legacy Gemini/Veo models on the existing Gemini path', () => {
    expect(resolveVideoProviderKey('veo-3.1-generate-preview')).toBeNull();
  });

  it('builds Sora 2 config from node settings and model hints', () => {
    expect(buildSora2VideoConfig({
      model: 'sora-2-pro-portrait-25s',
      duration: 15,
      resolution: '1080p',
    })).toEqual({
      aspect_ratio: '9:16',
      duration: '15',
      quality: 'pro',
    });
  });

  it('keeps a legacy resolution fallback for Gemini generation', () => {
    expect(inferLegacyVideoResolution({
      model: 'veo-3.1-generate-preview',
    })).toBe('720p');
    expect(inferLegacyVideoResolution({
      model: 'veo-3.1-pro',
    })).toBe('1080p');
  });
});
