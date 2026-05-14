/**
 * Higgsfield AI 视频生成模型适配器
 * 先作为注册占位，后续接入真实 API 契约时再补齐提交和轮询逻辑。
 */

import {
  VideoProvider,
  VideoSubmitParams,
  VideoSubmitResult,
  VideoGenerationResult,
  VideoProviderContext,
  VideoProviderError,
  VideoModelConfig,
} from './types';

export class HiggsfieldVideoProvider implements VideoProvider {
  readonly name = 'higgsfield' as const;
  readonly displayName = 'Higgsfield AI';

  readonly supportedFeatures = {
    textToVideo: true,
    imageToVideo: true,
    maxDuration: 10,
    supportedRatios: ['16:9', '9:16'] as const,
  };

  transformConfig(userConfig: VideoModelConfig) {
    return {
      aspect_ratio: userConfig.aspect_ratio,
      duration: userConfig.duration,
      quality: userConfig.quality,
      reference_mode: userConfig.quality === 'pro' ? 'high' : 'standard',
    };
  }

  async submitTask(
    params: VideoSubmitParams,
    apiKey: string,
    context?: VideoProviderContext
  ): Promise<VideoSubmitResult> {
    throw new VideoProviderError(
      this.name,
      501,
      'Higgsfield 适配器尚未接入真实 API，当前仅完成统一注册',
      {
        stage: 'registry-only',
        hasReferenceImage: !!params.referenceImageUrl,
        context,
      }
    );
  }

  async checkStatus(
    taskId: string,
    apiKey: string,
    onProgress?: (progress: number) => void,
    context?: VideoProviderContext
  ): Promise<VideoGenerationResult> {
    throw new VideoProviderError(
      this.name,
      501,
      'Higgsfield 适配器尚未接入真实 API，当前仅完成统一注册',
      {
        stage: 'registry-only',
        taskId,
        context,
      }
    );
  }
}
