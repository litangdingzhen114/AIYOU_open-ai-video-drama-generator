/**
 * 视频生成节点服务
 * Sora 2 优先走 provider registry，其余模型回退到 Gemini。
 */

import { AppNode, VideoGenerationMode } from '../../types';
import { BaseNodeService, NodeExecutionContext, NodeExecutionResult } from './baseNode.service';
import { generateVideo } from '../geminiService';
import { getUserDefaultModel } from '../modelConfig';
import { getProviderApiKey } from '../soraConfigService';
import { getVideoProvider } from '../videoProviders';
import {
  buildSora2VideoConfig,
  inferLegacyVideoResolution,
  inferVideoAspectRatio,
  resolveVideoProviderKey,
  type VideoGenerationRequest,
} from './videoProviderRouting';

interface GeneratedVideoResult {
  uri: string;
  uris: string[];
  isFallbackImage?: boolean;
  videoMetadata?: any;
  videoDuration?: number;
  videoResolution?: string;
}

const PROVIDER_POLL_INTERVAL = 5000;
const PROVIDER_MAX_ATTEMPTS = 120;

/**
 * 视频生成节点服务
 */
export class VideoGeneratorNodeService extends BaseNodeService {
  readonly nodeType = 'VIDEO_GENERATOR';

  /**
   * 验证输入
   */
  protected validateInputs(
    node: AppNode,
    context: NodeExecutionContext
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    const inputData = this.getSingleInput(node, context);
    const prompt = inputData?.prompt || node.data.prompt;
    const imageUrl = inputData?.imageUrl || node.data.imageUrl;

    if (!prompt && !imageUrl) {
      errors.push('缺少输入提示词或参考图片');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * 执行视频生成
   */
  async execute(
    node: AppNode,
    context: NodeExecutionContext
  ): Promise<NodeExecutionResult> {
    try {
      const inputData = this.getSingleInput(node, context);
      const prompt = inputData?.prompt || node.data.prompt || '';
      const imageUrl = inputData?.imageUrl || node.data.imageUrl;

      if (!prompt && !imageUrl) {
        return this.createErrorResult('提示词或参考图片不能为空');
      }

      const request: VideoGenerationRequest = {
        prompt,
        imageUrl: imageUrl || null,
        model: node.data.model || getUserDefaultModel('video'),
        aspectRatio: node.data.aspectRatio,
        resolution: node.data.resolution,
        duration: node.data.duration,
        count: node.data.count || 1,
        generationMode: (node.data.generationMode || 'DEFAULT') as VideoGenerationMode
      };

      this.updateNodeData(node.id, {
        ...node.data,
        status: 'generating',
        progress: 0,
        statusMessage: '正在准备视频生成任务...'
      }, context);

      const providerKey = resolveVideoProviderKey(request.model);
      const result = providerKey === 'sora2'
        ? await this.generateViaProvider(node, context, request)
        : await this.generateViaGemini(node, context, request);

      if (!result || !result.uri) {
        return this.createErrorResult('生成失败，未返回视频');
      }

      const resultData = {
        ...node.data,
        status: 'success',
        progress: 100,
        videoUri: result.uri,
        videoUris: result.uris || [result.uri],
        videoUrl: result.uri,
        thumbnailUrl: result.videoMetadata?.thumbnail,
        isFallbackImage: result.isFallbackImage,
        videoMetadata: result.videoMetadata,
        resolution: result.videoResolution || node.data.resolution || inferLegacyVideoResolution(request),
        duration: result.videoDuration ?? node.data.duration,
        generatedAt: new Date().toISOString()
      };

      this.updateNodeData(node.id, resultData, context);

      return this.createSuccessResult(resultData, {
        videoUri: result.uri,
        videoUrl: result.uri,
        videoUrls: result.uris || [result.uri],
        thumbnailUrl: result.videoMetadata?.thumbnail,
        prompt: request.prompt,
        provider: providerKey === 'sora2' ? 'sora2' : 'gemini'
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '生成失败';
      console.error(`[VideoGeneratorNodeService] 生成失败:`, error);

      return this.createErrorResult(errorMessage);
    }
  }

  private async generateViaProvider(
    node: AppNode,
    context: NodeExecutionContext,
    request: VideoGenerationRequest
  ): Promise<GeneratedVideoResult> {
    const provider = getVideoProvider('sora2');
    const apiKey = getProviderApiKey();

    if (!apiKey) {
      throw new Error('请先在设置中配置 Sora API Key');
    }

    const config = buildSora2VideoConfig(request);
    const totalCount = Math.max(1, request.count || 1);
    const generatedUris: string[] = [];
    const taskSummaries: Array<{
      taskId: string;
      videoUrl: string;
      videoDuration?: number;
      videoResolution?: string;
    }> = [];

    for (let index = 0; index < totalCount; index++) {
      const taskProgressBase = index / totalCount;
      const taskLabel = totalCount > 1 ? ` (${index + 1}/${totalCount})` : '';

      this.updateNodeData(node.id, {
        ...node.data,
        status: 'generating',
        progress: Math.round(taskProgressBase * 100),
        statusMessage: `正在提交 Sora 2 任务${taskLabel}...`
      }, context);

      const submitResult = await provider.submitTask(
        {
          prompt: request.prompt,
          referenceImageUrl: request.imageUrl || undefined,
          config
        },
        apiKey,
        {
          nodeId: node.id,
          nodeType: this.nodeType,
          provider: provider.name
        }
      );

      let attempts = 0;
      let completed = false;

      while (attempts < PROVIDER_MAX_ATTEMPTS) {
        const statusResult = await provider.checkStatus(
          submitResult.id,
          apiKey,
          (progress) => {
            const normalizedProgress = Math.min(
              99,
              Math.round(((index + (progress / 100)) / totalCount) * 100)
            );

            this.updateNodeData(node.id, {
              ...node.data,
              status: 'generating',
              progress: normalizedProgress,
              statusMessage: totalCount > 1
                ? `正在生成第 ${index + 1}/${totalCount} 个视频... (${progress}%)`
                : progress > 0
                  ? `视频生成中... (${progress}%)`
                  : '视频任务已提交，正在排队...'
            }, context);
          },
          {
            nodeId: node.id,
            nodeType: this.nodeType,
            provider: provider.name
          }
        );

        if (statusResult.status === 'completed') {
          if (!statusResult.videoUrl) {
            throw new Error('生成失败，未返回视频');
          }

          generatedUris.push(statusResult.videoUrl);
          taskSummaries.push({
            taskId: statusResult.taskId,
            videoUrl: statusResult.videoUrl,
            videoDuration: statusResult.videoDuration,
            videoResolution: statusResult.videoResolution
          });
          completed = true;
          break;
        }

        if (statusResult.status === 'error') {
          throw new Error(statusResult.error || '视频生成失败');
        }

        attempts++;
        if (attempts < PROVIDER_MAX_ATTEMPTS) {
          await this.wait(PROVIDER_POLL_INTERVAL);
        }
      }

      if (!completed) {
        throw new Error('视频生成超时');
      }
    }

    const primary = taskSummaries[0];

    return {
      uri: generatedUris[0],
      uris: generatedUris,
      videoDuration: primary?.videoDuration,
      videoResolution: primary?.videoResolution,
      videoMetadata: {
        provider: provider.name,
        displayName: provider.displayName,
        taskSummaries
      }
    };
  }

  private async generateViaGemini(
    node: AppNode,
    context: NodeExecutionContext,
    request: VideoGenerationRequest
  ): Promise<GeneratedVideoResult> {
    this.updateNodeData(node.id, {
      ...node.data,
      status: 'generating',
      progress: 0,
      statusMessage: '正在提交视频生成任务...'
    }, context);

    const result = await generateVideo(
      request.prompt,
      request.model,
      {
        aspectRatio: inferVideoAspectRatio(request),
        resolution: inferLegacyVideoResolution(request),
        count: request.count || 1,
        generationMode: request.generationMode
      },
      request.imageUrl || null,
      undefined,
      undefined,
      {
        nodeId: node.id,
        nodeType: this.nodeType
      }
    );

    return {
      uri: result.uri,
      uris: result.uris || [result.uri],
      isFallbackImage: result.isFallbackImage,
      videoMetadata: result.videoMetadata
    };
  }

  private wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
