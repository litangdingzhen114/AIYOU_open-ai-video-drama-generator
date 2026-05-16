/**
 * OpenAI 图像生成服务
 * 用于 GPT Image 2 / GPT Image 1 系列的独立路由
 */

import { GenerateImageOptions, imageToBase64 } from './llmProviders/baseProvider';

const OPENAI_API_BASE = 'https://api.openai.com';
const OPENAI_IMAGE_MODELS = new Set([
  'gpt-image-2',
  'gpt-image-2-2026-04-21',
  'chatgpt-image-latest',
  'gpt-image-1',
  'gpt-image-1-mini',
]);

const getApiKey = (): string | null => {
  const key = localStorage.getItem('OPENAI_API_KEY');
  return key && key.trim() ? key.trim() : null;
};

export const isOpenAIImageModel = (model?: string): boolean => {
  if (!model) return false;
  return OPENAI_IMAGE_MODELS.has(model) || model.startsWith('gpt-image-');
};

const mapAspectRatioToSize = (aspectRatio?: string): string => {
  switch (aspectRatio) {
    case '9:16':
    case '3:4':
      return '1024x1536';
    case '16:9':
    case '4:3':
      return '1536x1024';
    case '1:1':
      return '1024x1024';
    default:
      return '1024x1024';
  }
};

const fetchAsDataUrl = async (url: string): Promise<string> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`OpenAI image response fetch failed: ${response.status}`);
  }
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

/**
 * 验证 OpenAI API Key
 */
export const validateOpenAIKey = async (apiKey: string): Promise<boolean> => {
  try {
    const response = await fetch(`${OPENAI_API_BASE}/v1/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });
    return response.ok;
  } catch (error) {
    console.error('[OpenAIImage] validate key failed:', error);
    return false;
  }
};

/**
 * 生成图像
 */
export const generateOpenAIImages = async (
  prompt: string,
  model: string = 'gpt-image-2',
  referenceImages?: string[],
  options?: GenerateImageOptions
): Promise<string[]> => {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY_NOT_CONFIGURED');
  }

  const hasReferences = !!referenceImages?.length;
  const endpoint = hasReferences ? '/v1/images/edits' : '/v1/images/generations';
  const url = `${OPENAI_API_BASE}${endpoint}`;
  const size = mapAspectRatioToSize(options?.aspectRatio);

  const body: any = {
    model,
    prompt,
    size,
    n: options?.count || 1,
  };

  if (hasReferences && referenceImages) {
    body.images = await Promise.all(
      referenceImages.map(async (ref) => {
        const { data, mimeType } = await imageToBase64(ref);
        return {
          image_url: `data:${mimeType};base64,${data}`,
        };
      })
    );
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let errorMessage = 'OpenAI 图像生成失败';
    try {
      const error = await response.json();
      errorMessage = error?.error?.message || errorMessage;
    } catch {
      // ignore JSON parse errors
    }
    throw new Error(errorMessage);
  }

  const data = await response.json();
  const items = Array.isArray(data?.data) ? data.data : [];
  const results: string[] = [];

  for (const item of items) {
    if (item?.b64_json) {
      results.push(`data:image/png;base64,${item.b64_json}`);
      continue;
    }

    if (item?.url) {
      results.push(await fetchAsDataUrl(item.url));
    }
  }

  if (results.length === 0) {
    throw new Error('No images generated');
  }

  return results;
};
