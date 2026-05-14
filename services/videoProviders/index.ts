/**
 * 视频生成模型提供商注册和获取
 */

import {
  VideoProvider,
  VideoProviderType,
  VideoProviderCatalogEntry,
  VideoProviderReadiness,
} from './types';
import { Sora2VideoProvider } from './sora2Provider';
import { KlingVideoProvider } from './klingProvider';
import { LumaVideoProvider } from './lumaProvider';
import { RunwayVideoProvider } from './runwayProvider';
import { HiggsfieldVideoProvider } from './higgsfieldProvider';

interface ProviderRegistration {
  provider: VideoProvider;
  readiness: VideoProviderReadiness;
}

// 提供商实例注册表
const providerRegistry: Record<VideoProviderType, ProviderRegistration> = {
  sora2: {
    provider: new Sora2VideoProvider(),
    readiness: 'ready',
  },
  kling: {
    provider: new KlingVideoProvider(),
    readiness: 'ready',
  },
  luma: {
    provider: new LumaVideoProvider(),
    readiness: 'ready',
  },
  runway: {
    provider: new RunwayVideoProvider(),
    readiness: 'ready',
  },
  higgsfield: {
    provider: new HiggsfieldVideoProvider(),
    readiness: 'preview',
  },
};

/**
 * 获取指定提供商实例
 * @param name 提供商名称
 * @returns 提供商实例
 * @throws 如果提供商不存在则抛出错误
 */
export function getVideoProvider(name: VideoProviderType | string): VideoProvider {
  const registration = Object.hasOwn(providerRegistry, name)
    ? providerRegistry[name as VideoProviderType]
    : undefined;
  const provider = registration?.provider;
  if (!provider) {
    throw new Error(`未知的视频生成提供商: ${name}，支持的提供商: ${Object.keys(providerRegistry).join(', ')}`);
  }
  return provider;
}

/**
 * 获取所有可用的提供商列表
 */
export function getAllVideoProviders(): VideoProvider[] {
  return Object.values(providerRegistry).map(entry => entry.provider);
}

/**
 * 获取所有提供商的名称
 */
export function getVideoProviderNames(): VideoProviderType[] {
  return Object.keys(providerRegistry) as VideoProviderType[];
}

/**
 * 检查提供商是否可用
 */
export function isVideoProviderAvailable(name: string): name is VideoProviderType {
  return Object.hasOwn(providerRegistry, name);
}

/**
 * 获取提供商目录，用于设置面板或未来的选择器
 */
export function getVideoProviderCatalog(): VideoProviderCatalogEntry[] {
  return Object.values(providerRegistry).map(({ provider, readiness }) => ({
    name: provider.name,
    displayName: provider.displayName,
    readiness,
    supportedFeatures: provider.supportedFeatures,
  }));
}

/**
 * 获取提供商当前注册状态
 */
export function getVideoProviderReadiness(name: VideoProviderType): VideoProviderReadiness {
  return providerRegistry[name].readiness;
}

// 导出类型和提供商类
export type {
  VideoProvider,
  VideoProviderType,
  VideoProviderCatalogEntry,
  VideoProviderReadiness,
  VideoSubmitParams,
  VideoSubmitResult,
  VideoGenerationResult,
  VideoModelConfig,
} from './types';
export { Sora2VideoProvider } from './sora2Provider';
export { KlingVideoProvider } from './klingProvider';
export { LumaVideoProvider } from './lumaProvider';
export { RunwayVideoProvider } from './runwayProvider';
export { HiggsfieldVideoProvider } from './higgsfieldProvider';
export { VideoProviderError } from './types';
