import type { VideoModelConfig, VideoProviderType } from '../videoProviders/types';

export interface VideoGenerationRequest {
  prompt: string;
  imageUrl?: string | null;
  model: string;
  aspectRatio?: string;
  resolution?: string;
  duration?: number;
  count?: number;
  generationMode?: string;
}

const DURATION_VALUES = new Set(['5', '10', '15', '25']);

export function resolveVideoProviderKey(model: string): VideoProviderType | null {
  const normalized = model.toLowerCase();
  if (normalized.startsWith('sora-2') || normalized === 'sora2') {
    return 'sora2';
  }
  return null;
}

export function inferVideoAspectRatio(request: Pick<VideoGenerationRequest, 'aspectRatio' | 'model'>): '16:9' | '9:16' {
  if (request.aspectRatio === '16:9' || request.aspectRatio === '9:16') {
    return request.aspectRatio;
  }

  const normalized = request.model.toLowerCase();
  if (normalized.includes('landscape') || normalized.includes('horizontal')) {
    return '16:9';
  }

  if (normalized.includes('portrait') || normalized.includes('vertical')) {
    return '9:16';
  }

  return '16:9';
}

export function inferVideoDuration(request: Pick<VideoGenerationRequest, 'duration' | 'model'>): VideoModelConfig['duration'] {
  if (typeof request.duration === 'number') {
    const direct = String(request.duration);
    if (DURATION_VALUES.has(direct)) {
      return direct as VideoModelConfig['duration'];
    }
  }

  const durationMatch = request.model.toLowerCase().match(/(\d{1,2})s/);
  if (durationMatch && DURATION_VALUES.has(durationMatch[1])) {
    return durationMatch[1] as VideoModelConfig['duration'];
  }

  return '10';
}

export function inferVideoQuality(request: Pick<VideoGenerationRequest, 'resolution' | 'model'>): VideoModelConfig['quality'] {
  const resolution = request.resolution?.toLowerCase() || '';
  const normalizedModel = request.model.toLowerCase();

  if (
    resolution.includes('1080') ||
    resolution.includes('4k') ||
    normalizedModel.includes('pro') ||
    normalizedModel.includes('large')
  ) {
    return 'pro';
  }

  return 'standard';
}

export function inferLegacyVideoResolution(request: Pick<VideoGenerationRequest, 'resolution' | 'model'>): string {
  if (request.resolution) {
    return request.resolution;
  }

  return inferVideoQuality(request) === 'pro' ? '1080p' : '720p';
}

export function buildSora2VideoConfig(
  request: Pick<VideoGenerationRequest, 'aspectRatio' | 'resolution' | 'duration' | 'model'>
): VideoModelConfig {
  return {
    aspect_ratio: inferVideoAspectRatio(request),
    duration: inferVideoDuration(request),
    quality: inferVideoQuality(request),
  };
}
