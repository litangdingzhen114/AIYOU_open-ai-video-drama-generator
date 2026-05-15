/**
 * AIYOU Backend Server
 * 提供 OSS 文件上传 API
 */

import express from 'express';
import cors from 'cors';
import multer from 'multer';
import COS from 'cos-nodejs-sdk-v5';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { writeLog } from './logger.js';
import projectsRouter from './routes/projects.js';
import nodesRouter from './routes/nodes.js';
import connectionsRouter from './routes/connections.js';
import mediaRouter from './routes/media.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// 中间件
app.use(cors({
  origin: function(origin, callback) {
    // 允许同源请求（无 origin）和 localhost 的任意端口
    if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      callback(null, true);
    } else {
      callback(null, true); // 开发阶段允许所有来源
    }
  },
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));

// 配置文件上传（使用内存存储，限制文件大小为 100MB）
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB
    files: 10
  }
});

// OSS 配置
const ossConfig = {
  bucket: process.env.OSS_BUCKET || 'aiyou-1256635214',
  region: process.env.OSS_REGION || 'ap-guangzhou',
  secretId: process.env.OSS_SECRET_ID,
  secretKey: process.env.OSS_SECRET_KEY
};

// 初始化腾讯云 COS SDK
const cos = new COS({
  SecretId: ossConfig.secretId,
  SecretKey: ossConfig.secretKey,
});

/**
 * 健康检查接口
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'AIYOU Backend Server is running',
    timestamp: new Date().toISOString()
  });
});

/**
 * OSS 文件上传接口
 * POST /api/upload-oss
 */
app.post('/api/upload-oss', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: '没有上传文件'
      });
    }

    const { originalname, mimetype, buffer, size } = req.file;
    const { folder = 'aiyou-uploads' } = req.body;

    // 验证文件类型
    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'video/mp4',
      'video/webm',
      'audio/mpeg',
      'audio/wav',
      'audio/mp3'
    ];

    if (!allowedTypes.includes(mimetype)) {
      return res.status(400).json({
        success: false,
        error: `不支持的文件类型: ${mimetype}`
      });
    }

    // 验证文件大小（限制 50MB）
    const maxSize = 50 * 1024 * 1024;
    if (size > maxSize) {
      return res.status(400).json({
        success: false,
        error: `文件大小超过限制: ${(size / 1024 / 1024).toFixed(2)}MB (最大 50MB)`
      });
    }

    // 生成唯一文件名
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const ext = originalname.split('.').pop();
    const fileName = `${folder}/${timestamp}_${random}.${ext}`;

    console.log('📤 开始上传到 OSS:', {
      originalName: originalname,
      fileName: fileName,
      size: `${(size / 1024).toFixed(2)}KB`,
      type: mimetype
    });

    // 上传到腾讯云 COS
    const result = await new Promise((resolve, reject) => {
      cos.putObject({
        Bucket: ossConfig.bucket,
        Region: ossConfig.region,
        Key: fileName,
        Body: buffer,
        ContentType: mimetype,
      }, (err, data) => {
        if (err) {
          console.error('❌ OSS 上传失败:', err);
          reject(err);
        } else {
          console.log('✅ OSS 上传成功:', data.Location);
          resolve(data);
        }
      });
    });

    // 返回文件 URL
    const fileUrl = `https://${ossConfig.bucket}.cos.${ossConfig.region}.myqcloud.com/${fileName}`;

    res.json({
      success: true,
      url: fileUrl,
      fileName: fileName,
      size: size,
      type: mimetype,
      originalName: originalname
    });

  } catch (error) {
    console.error('❌ 上传失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '文件上传失败'
    });
  }
});

/**
 * 本地文件上传接口（OSS 未配置时的降级方案）
 * POST /api/upload-local
 *
 * 参数（form-data）:
 *   - file: 要上传的文件
 *   - projectId: 项目 ID
 *   - episodeId: 剧集节点 ID（可选，默认 "default"）
 *   - type: 文件类型 "image" 或 "video"（默认 "image"）
 *
 * 文件夹结构: server/uploads/{projectId}/{episodeId}/{type}s/{filename}
 */
app.post('/api/upload-local', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: '没有上传文件' });
    }

    const { originalname, mimetype, buffer, size } = req.file;
    const { projectId = 'default', episodeId = 'default', type = 'image' } = req.body;

    // 验证文件类型
    const allowedTypes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'video/mp4', 'video/webm',
      'audio/mpeg', 'audio/wav', 'audio/mp3'
    ];
    if (!allowedTypes.includes(mimetype)) {
      return res.status(400).json({ success: false, error: `不支持的文件类型: ${mimetype}` });
    }

    // 验证 type 参数
    const typeFolder = type === 'video' ? 'videos' : 'images';

    // 构建目录路径: uploads/{projectId}/{episodeId}/{typeFolder}/
    const uploadDir = path.join(__dirname, 'uploads', projectId, episodeId, typeFolder);
    await fs.promises.mkdir(uploadDir, { recursive: true });

    // 生成唯一文件名
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const ext = originalname.split('.').pop() || 'png';
    const fileName = `${timestamp}_${random}.${ext}`;
    const filePath = path.join(uploadDir, fileName);

    // 写入文件
    await fs.promises.writeFile(filePath, buffer);

    // 返回可访问的 URL
    const fileUrl = `http://localhost:${PORT}/uploads/${projectId}/${episodeId}/${typeFolder}/${fileName}`;

    console.log('📁 本地上传成功:', {
      originalName: originalname,
      filePath: filePath,
      url: fileUrl,
      size: `${(size / 1024).toFixed(2)}KB`,
      type: mimetype
    });

    res.json({
      success: true,
      url: fileUrl,
      fileName: fileName,
      size: size,
      type: mimetype,
      originalName: originalname
    });

  } catch (error) {
    console.error('❌ 本地上传失败:', error);
    res.status(500).json({ success: false, error: error.message || '本地文件上传失败' });
  }
});

/**
 * 获取 OSS 上传预签名 URL（可选，用于直接前端上传）
 * GET /api/oss-upload-url?fileName=example.jpg&fileType=image/jpeg
 */
app.get('/api/oss-upload-url', async (req, res) => {
  try {
    const { fileName, fileType = 'image/jpeg' } = req.query;

    if (!fileName) {
      return res.status(400).json({
        success: false,
        error: '缺少 fileName 参数'
      });
    }

    // 生成唯一文件名
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const finalFileName = `aiyou-uploads/${timestamp}_${random}_${fileName}`;

    // 生成预签名 URL（有效期 1 小时）
    const result = await new Promise((resolve, reject) => {
      cos.getObjectUrl({
        Bucket: ossConfig.bucket,
        Region: ossConfig.region,
        Key: finalFileName,
        Method: 'PUT',
        Sign: true,
        Expires: 3600, // 1小时
      }, (err, data) => {
        if (err) {
          reject(err);
        } else {
          resolve(data);
        }
      });
    });

    res.json({
      success: true,
      uploadUrl: result.Url,
      fileName: finalFileName,
      expiresIn: 3600
    });

  } catch (error) {
    console.error('❌ 生成预签名 URL 失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '生成预签名 URL 失败'
    });
  }
});

/**
 * Sora 2 API 代理 - 提交视频生成任务
 * POST /api/sora/generations
 */
app.post('/api/sora/generations', async (req, res) => {
  const startTime = Date.now();
  const logId = `sora-submit-${Date.now()}`;

  try {
    const { prompt, images, aspect_ratio, duration, hd, watermark, private: isPrivate } = req.body;

    // 从请求头获取 API Key
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
      return res.status(400).json({
        success: false,
        error: '缺少 API Key，请在请求头中提供 X-API-Key'
      });
    }

    const requestBody = {
      prompt: prompt || '',
      model: 'sora-2',
      images: images || [],
      aspect_ratio: aspect_ratio || '16:9',
      duration: duration || '10',
      hd: hd !== undefined ? hd : true,
      watermark: watermark !== undefined ? watermark : true,
      private: isPrivate !== undefined ? isPrivate : true
    };

    console.log('📹 Sora API 代理: 提交视频生成任务', {
      promptLength: prompt?.length,
      hasImages: !!images?.length,
      aspect_ratio,
      duration,
      requestBody: JSON.stringify(requestBody)
    });

    const response = await fetch('https://hk-api.gptbest.vip/v2/videos/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    const data = await response.json();
    const elapsed = Date.now() - startTime;

    console.log('📹 Sora API 响应:', JSON.stringify(data, null, 2));

    if (!response.ok) {
      console.error('❌ Sora API 错误:', response.status, data);

      // 记录错误日志
      writeLog({
        id: logId,
        timestamp: Date.now(),
        apiName: 'submitSoraTask',
        status: 'error',
        duration: elapsed,
        request: {
          aspectRatio: aspect_ratio,
          duration: duration,
          hd: hd,
          hasImages: !!images?.length,
          promptLength: prompt?.length
        },
        response: {
          success: false,
          error: data.message || data.error || 'Sora API 请求失败',
          details: data
        }
      });

      return res.status(response.status).json({
        success: false,
        error: data.message || data.error || 'Sora API 请求失败',
        details: data
      });
    }

    console.log('✅ Sora API 代理: 任务提交成功', data.id || data.task_id || 'NO_ID');

    // 记录成功日志
    writeLog({
      id: logId,
      timestamp: Date.now(),
      apiName: 'submitSoraTask',
      status: 'success',
      duration: elapsed,
      request: {
        aspectRatio: aspect_ratio,
        duration: duration,
        hd: hd,
        hasImages: !!images?.length,
        promptLength: prompt?.length
      },
      response: {
        success: true,
        data: {
          taskId: data.id || data.task_id,
          status: data.status
        }
      }
    });

    res.json(data);

  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error('❌ Sora API 代理错误:', error);

    // 记录错误日志
    writeLog({
      id: logId,
      timestamp: Date.now(),
      apiName: 'submitSoraTask',
      status: 'error',
      duration: elapsed,
      request: {
        aspectRatio: req.body.aspect_ratio,
        duration: req.body.duration
      },
      response: {
        success: false,
        error: error.message || 'Sora API 代理请求失败'
      }
    });

    res.status(500).json({
      success: false,
      error: error.message || 'Sora API 代理请求失败'
    });
  }
});

/**
 * Sora 2 API 代理 - 查询任务状态
 * GET /api/sora/generations/:taskId
 */
app.get('/api/sora/generations/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;

    // 从请求头获取 API Key
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
      return res.status(400).json({
        success: false,
        error: '缺少 API Key，请在请求头中提供 X-API-Key'
      });
    }

    const response = await fetch(`https://hk-api.gptbest.vip/v2/videos/generations/${taskId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('❌ Sora API 查询错误:', response.status, data);
      return res.status(response.status).json({
        success: false,
        error: data.message || data.error || 'Sora API 查询失败',
        details: data
      });
    }

    res.json(data);

  } catch (error) {
    console.error('❌ Sora API 代理查询错误:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Sora API 代理查询失败'
    });
  }
});

// ============================================================================
// 云雾 API 代理
// ============================================================================

/**
 * 云雾 API 代理 - 提交视频生成任务
 * POST /api/yunwu/create
 */
app.post('/api/yunwu/create', async (req, res) => {
  const startTime = Date.now();
  const logId = `yunwu-submit-${Date.now()}`;

  try {
    // 从请求头获取 API Key
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
      console.error(`[${logId}] ❌ 缺少 API Key`);
      return res.status(401).json({
        success: false,
        error: '缺少 API Key，请在请求头中提供 X-API-Key'
      });
    }

    const { prompt, images, model, aspect_ratio, enhance_prompt, enable_upsample } = req.body;

    // 防御性检查:验证必需字段
    if (!prompt) {
      console.error(`[${logId}] ❌ 缺少 prompt 参数`);
      return res.status(400).json({
        success: false,
        error: '缺少 prompt 参数',
        receivedBody: req.body
      });
    }

    console.log(`[${logId}] 📤 云雾 API 提交任务:`, {
      prompt: prompt?.substring(0, 100) + '...',
      hasImages: !!images?.length,
      imagesCount: images?.length || 0,
      aspect_ratio,
      enhance_prompt,
      enable_upsample,
      model,
      apiKeyPrefix: apiKey.substring(0, 10) + '...',
    });

    // 构建云雾 API 请求（Veo 参数格式）
    const yunwuRequestBody = {
      prompt,
      model: model || 'veo3.1-fast',
      images: images || [],
      aspect_ratio: aspect_ratio || '16:9',
      enhance_prompt: enhance_prompt !== undefined ? enhance_prompt : true,
      enable_upsample: enable_upsample !== undefined ? enable_upsample : true,
    };

    console.log(`[${logId}] 📋 发送到云雾 API 的请求体:`, JSON.stringify(yunwuRequestBody, null, 2));
    console.log(`[${logId}] 🌐 请求 URL: https://yunwu.ai/v1/video/create`);

    let response;
    try {
      response = await fetch('https://yunwu.ai/v1/video/create', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(yunwuRequestBody),
      });
    } catch (fetchError) {
      console.error(`[${logId}] ❌ 请求云雾 API 失败:`, fetchError);
      return res.status(500).json({
        success: false,
        error: `请求云雾 API 失败: ${fetchError.message}`,
        details: fetchError.toString()
      });
    }

    const responseText = await response.text();
    const durationMs = Date.now() - startTime;

    console.log(`[${logId}] 📥 云雾 API 原始响应:`, {
      status: response.status,
      statusText: response.statusText,
      responseText: responseText.substring(0, 1000),
      duration: `${durationMs}ms`,
    });

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      console.error(`[${logId}] ❌ 解析响应 JSON 失败:`, e.message);
      console.error(`[${logId}] 📄 原始响应文本:`, responseText);
      data = { rawResponse: responseText };
    }

    if (!response.ok) {
      console.error(`[${logId}] ❌ 云雾 API 错误:`, {
        status: response.status,
        statusText: response.statusText,
        data,
        responseText: responseText.substring(0, 500)
      });
      return res.status(response.status).json({
        success: false,
        error: data.message || data.error || data.detail || `云雾 API 错误 (${response.status}): ${response.statusText}`,
        details: data
      });
    }

    console.log(`[${logId}] ✅ 云雾 API 成功:`, {
      status: response.status,
      taskId: data.id,
      taskStatus: data.status,
      duration: `${durationMs}ms`,
    });

    res.json(data);

  } catch (error) {
    const durationMs = Date.now() - startTime;
    console.error(`[${logId}] ❌ 云雾 API 代理错误 (${durationMs}ms):`, {
      message: error.message,
      stack: error.stack,
      name: error.name,
      toString: error.toString()
    });
    console.error(`[${logId}] 📋 错误详情:`, error);
    res.status(500).json({
      success: false,
      error: error.message || '云雾 API 代理提交失败',
      details: {
        name: error.name,
        message: error.message,
        stack: error.stack,
        toString: error.toString()
      }
    });
  }
});

/**
 * 云雾 API 代理 - 查询任务状态
 * GET /api/yunwu/query
 */
app.get('/api/yunwu/query', async (req, res) => {
  const startTime = Date.now();
  const logId = `yunwu-query-${Date.now()}`;

  try {
    const taskId = req.query.id;

    if (!taskId) {
      console.error(`[${logId}] ❌ 缺少任务 ID`);
      return res.status(400).json({
        success: false,
        error: '缺少任务 ID，请在查询参数中提供 id'
      });
    }

    // 从请求头获取 API Key
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
      console.error(`[${logId}] ❌ 缺少 API Key`);
      return res.status(401).json({
        success: false,
        error: '缺少 API Key，请在请求头中提供 X-API-Key'
      });
    }

    console.log(`[${logId}] 🔍 云雾 API 查询任务:`, { taskId });

    const response = await fetch(`https://yunwu.ai/v1/video/query?id=${encodeURIComponent(taskId)}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    const data = await response.json();

    const durationMs = Date.now() - startTime;
    const detail = data.detail || {};

    // ✅ 修正：云雾 API 的状态和进度在根级别，不是在 detail 对象中
    const taskStatus = data.status || detail.status;
    const progress = data.progress || detail.progress_pct || 0;

    // 视频URL可能在不同位置
    const generations = detail.generations || data.generations || [];
    const videoUrl = generations[0]?.url || data.video_url || data.url;

    console.log(`[${logId}] 📦 云雾 API 原始查询响应:`, JSON.stringify(data, null, 2));
    console.log(`[${logId}] 🔍 解析后的数据:`, {
      hasDetail: !!data.detail,
      detailKeys: data.detail ? Object.keys(data.detail) : [],
      rootStatus: data.status,
      rootProgress: data.progress,
      detailStatus: detail.status,
      detailProgressPct: detail.progress_pct,
      generationsCount: generations.length,
      hasVideoUrl: !!videoUrl,
      videoUrl: videoUrl || 'none'
    });

    console.log(`[${logId}] ✅ 云雾 API 查询响应:`, {
      status: response.status,
      taskId: data.id,
      taskStatus,
      progress,
      hasVideo: !!videoUrl,
      duration: `${durationMs}ms`,
    });

    if (!response.ok) {
      console.error(`[${logId}] ❌ 云雾 API 查询错误:`, response.status, data);
      return res.status(response.status).json({
        success: false,
        error: data.message || data.error || '云雾 API 查询失败',
        details: data
      });
    }

    res.json(data);

  } catch (error) {
    const durationMs = Date.now() - startTime;
    console.error(`[${logId}] ❌ 云雾 API 代理查询错误 (${durationMs}ms):`, error);
    res.status(500).json({
      success: false,
      error: error.message || '云雾 API 代理查询失败'
    });
  }
});

// ============================================================================
// 大洋芋 API 代理
// ============================================================================

/**
 * 大洋芋 API 代理 - 提交视频生成任务
 * POST /api/dayuapi/create
 */
app.post('/api/dayuapi/create', async (req, res) => {
  const startTime = Date.now();
  const logId = `dayuapi-submit-${Date.now()}`;

  try {
    // 从请求头获取 API Key
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
      console.error(`[${logId}] ❌ 缺少 API Key`);
      return res.status(401).json({
        success: false,
        error: '缺少 API Key，请在请求头中提供 X-API-Key'
      });
    }

    const { prompt, model, image_url } = req.body;

    console.log(`[${logId}] 📤 大洋芋 API 提交任务:`, {
      prompt: prompt?.substring(0, 100) + '...',
      model,
      hasImageUrl: !!image_url,
    });

    // 构建大洋芋 API 请求
    const dayuapiRequestBody = {
      prompt,
      model,
      ...(image_url && { image_url })
    };

    console.log(`[${logId}] 📋 发送到大洋芋 API 的请求体:`, JSON.stringify(dayuapiRequestBody, null, 2));
    console.log(`[${logId}] 🌐 请求 URL: https://api.dyuapi.com/v1/videos`);

    const response = await fetch('https://api.dyuapi.com/v1/videos', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(dayuapiRequestBody),
    });

    const responseText = await response.text();
    const durationMs = Date.now() - startTime;

    console.log(`[${logId}] 📥 大洋芋 API 原始响应:`, {
      status: response.status,
      statusText: response.statusText,
      responseText: responseText.substring(0, 500),
      duration: `${durationMs}ms`,
    });

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      console.error(`[${logId}] ❌ 解析响应 JSON 失败:`, e.message);
      data = { rawResponse: responseText };
    }

    if (!response.ok) {
      console.error(`[${logId}] ❌ 大洋芋 API 错误:`, response.status, data);
      return res.status(response.status).json({
        success: false,
        error: data.error || data.message || '大洋芋 API 提交失败',
        details: data
      });
    }

    console.log(`[${logId}] ✅ 大洋芋 API 成功:`, {
      status: response.status,
      taskId: data.id,
      taskStatus: data.status,
      duration: `${durationMs}ms`,
    });

    res.json(data);

  } catch (error) {
    const durationMs = Date.now() - startTime;
    console.error(`[${logId}] ❌ 大洋芋 API 代理错误 (${durationMs}ms):`, error);
    res.status(500).json({
      success: false,
      error: error.message || '大洋芋 API 代理提交失败'
    });
  }
});

/**
 * 大洋芋 API 代理 - 查询任务状态
 * GET /api/dayuapi/query
 */
app.get('/api/dayuapi/query', async (req, res) => {
  const startTime = Date.now();
  const logId = `dayuapi-query-${Date.now()}`;

  try {
    const taskId = req.query.id;

    if (!taskId) {
      console.error(`[${logId}] ❌ 缺少任务 ID`);
      return res.status(400).json({
        success: false,
        error: '缺少任务 ID，请在查询参数中提供 id'
      });
    }

    // 从请求头获取 API Key
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
      console.error(`[${logId}] ❌ 缺少 API Key`);
      return res.status(401).json({
        success: false,
        error: '缺少 API Key，请在请求头中提供 X-API-Key'
      });
    }

    console.log(`[${logId}] 🔍 大洋芋 API 查询任务:`, { taskId });

    const response = await fetch(`https://api.dyuapi.com/v1/videos/${encodeURIComponent(taskId)}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    const data = await response.json();

    const durationMs = Date.now() - startTime;

    console.log(`[${logId}] ✅ 大洋芋 API 查询响应:`, {
      status: response.status,
      taskId: data.id,
      taskStatus: data.status,
      progress: data.progress,
      hasOutput: !!(data.output && data.output[0]?.url),
      outputKeys: data.output ? Object.keys(data.output) : 'no output',
      outputType: Array.isArray(data.output) ? 'array' : typeof data.output,
      outputLength: Array.isArray(data.output) ? data.output.length : 'N/A',
      fullOutput: data.output,
      duration: `${durationMs}ms`,
    });

    if (!response.ok) {
      console.error(`[${logId}] ❌ 大洋芋 API 查询错误:`, response.status, data);
      return res.status(response.status).json({
        success: false,
        error: data.error || data.message || '大洋芋 API 查询失败',
        details: data
      });
    }

    res.json(data);

  } catch (error) {
    const durationMs = Date.now() - startTime;
    console.error(`[${logId}] ❌ 大洋芋 API 代理查询错误 (${durationMs}ms):`, error);
    res.status(500).json({
      success: false,
      error: error.message || '大洋芋 API 代理查询失败'
    });
  }
});

/**
 * 大洋芋 API 代理 - 获取视频内容
 * GET /api/dayuapi/content
 */
app.get('/api/dayuapi/content', async (req, res) => {
  const startTime = Date.now();
  const logId = `dayuapi-content-${Date.now()}`;

  try {
    const taskId = req.query.id;

    if (!taskId) {
      console.error(`[${logId}] ❌ 缺少任务 ID`);
      return res.status(400).json({
        success: false,
        error: '缺少任务 ID，请在查询参数中提供 id'
      });
    }

    // 从请求头获取 API Key
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
      console.error(`[${logId}] ❌ 缺少 API Key`);
      return res.status(401).json({
        success: false,
        error: '缺少 API Key，请在请求头中提供 X-API-Key'
      });
    }

    console.log(`[${logId}] 📥 大洋芋 API 获取视频内容:`, { taskId });

    const response = await fetch(`https://api.dyuapi.com/v1/videos/${encodeURIComponent(taskId)}/content`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    const data = await response.json();

    const durationMs = Date.now() - startTime;

    console.log(`[${logId}] ✅ 大洋芋 API 内容响应:`, {
      status: response.status,
      hasUrl: !!data.url,
      duration: `${durationMs}ms`,
    });

    if (!response.ok) {
      console.error(`[${logId}] ❌ 大洋芋 API 内容错误:`, response.status, data);
      return res.status(response.status).json({
        success: false,
        error: data.error || data.message || '大洋芋 API 获取内容失败',
        details: data
      });
    }

    res.json(data);

  } catch (error) {
    const durationMs = Date.now() - startTime;
    console.error(`[${logId}] ❌ 大洋芋 API 代理内容错误 (${durationMs}ms):`, error);
    res.status(500).json({
      success: false,
      error: error.message || '大洋芋 API 代理获取内容失败'
    });
  }
});

/**
 * KIE AI API 代理 - 创建任务
 * POST /api/kie/create
 */
app.post('/api/kie/create', async (req, res) => {
  const startTime = Date.now();
  const logId = `kie-submit-${Date.now()}`;

  try {
    // 从请求头获取 API Key
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
      console.error(`[${logId}] ❌ 缺少 API Key`);
      return res.status(401).json({
        success: false,
        error: '缺少 API Key，请在请求头中提供 X-API-Key'
      });
    }

    const { model, input } = req.body;

    console.log(`[${logId}] 📤 KIE AI API 创建任务:`, {
      model,
      hasImageUrls: !!input?.image_urls,
      aspectRatio: input?.aspect_ratio,
      nFrames: input?.n_frames,
      removeWatermark: input?.remove_watermark,
      promptLength: input?.prompt?.length,
    });

    // 调用 KIE AI API
    const response = await fetch('https://api.kie.ai/api/v1/jobs/createTask', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input,
      }),
    });

    const data = await response.json();

    const durationMs = Date.now() - startTime;

    console.log(`[${logId}] ✅ KIE AI API 完整响应:`, JSON.stringify(data, null, 2));
    console.log(`[${logId}] 📋 data.data 字段详情:`, JSON.stringify(data.data, null, 2));

    console.log(`[${logId}] ✅ KIE AI API 响应摘要:`, {
      status: response.status,
      code: data.code,
      msg: data.msg,
      hasTaskId: !!data.data?.taskId,
      hasTask_id: !!data.data?.task_id,
      hasId: !!data.data?.id,
      duration: `${durationMs}ms`,
    });

    if (!response.ok || data.code !== 200) {
      console.error(`[${logId}] ❌ KIE AI API 错误:`, response.status, data);
      return res.status(response.status || 500).json({
        success: false,
        error: data.msg || 'KIE AI API 创建任务失败',
        details: data
      });
    }

    res.json(data);

  } catch (error) {
    const durationMs = Date.now() - startTime;
    console.error(`[${logId}] ❌ KIE AI API 代理创建错误 (${durationMs}ms):`, error);
    res.status(500).json({
      success: false,
      error: error.message || 'KIE AI API 代理创建失败'
    });
  }
});

/**
 * KIE AI API 代理 - 查询任务状态
 * GET /api/kie/query?taskId={taskId}
 */
app.get('/api/kie/query', async (req, res) => {
  const startTime = Date.now();
  const logId = `kie-query-${Date.now()}`;

  try {
    const taskId = req.query.taskId;

    if (!taskId) {
      console.error(`[${logId}] ❌ 缺少任务 ID`);
      return res.status(400).json({
        success: false,
        error: '缺少任务 ID，请在查询参数中提供 taskId'
      });
    }

    // 从请求头获取 API Key
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
      console.error(`[${logId}] ❌ 缺少 API Key`);
      return res.status(401).json({
        success: false,
        error: '缺少 API Key，请在请求头中提供 X-API-Key'
      });
    }

    console.log(`[${logId}] 📥 KIE AI API 查询任务:`, { taskId });
    console.log(`[${logId}] 🔍 查询 URL:`, `https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`);

    // 调用 KIE AI API 获取任务详情
    const response = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    const responseText = await response.text();
    const durationMs = Date.now() - startTime;

    console.log(`[${logId}] 📋 KIE API 查询原始响应 (${response.status}):`, responseText.substring(0, 500));

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      console.error(`[${logId}] ❌ 解析响应 JSON 失败:`, e.message);
      data = { rawResponse: responseText };
    }

    console.log(`[${logId}] ✅ KIE AI API 查询响应解析后:`, {
      status: response.status,
      code: data.code,
      msg: data.msg,
      hasData: !!data.data,
      state: data.data?.state,  // KIE API 使用 state 字段
      hasResultJson: !!data.data?.resultJson,  // success 状态才有 resultJson
      failCode: data.data?.failCode,
      failMsg: data.data?.failMsg,
      duration: `${durationMs}ms`,
    });

    if (!response.ok) {
      console.error(`[${logId}] ❌ KIE AI API 查询错误 - HTTP ${response.status}:`, JSON.stringify(data, null, 2));
      return res.status(response.status).json({
        success: false,
        error: data.msg || 'KIE AI API 查询任务失败',
        details: data
      });
    }

    res.json(data);

  } catch (error) {
    const durationMs = Date.now() - startTime;
    console.error(`[${logId}] ❌ KIE AI API 代理查询错误 (${durationMs}ms):`, error);
    res.status(500).json({
      success: false,
      error: error.message || 'KIE AI API 代理查询失败'
    });
  }
});

// ============================================================================
// 云雾API多模型平台代理
// ============================================================================

/**
 * ==================== 速推API代理 ====================
 */

/**
 * 速推API代理 - 创建任务
 * POST /api/sutu/create
 */
app.post('/api/sutu/create', async (req, res) => {
  const startTime = Date.now();
  const logId = `sutu-submit-${Date.now()}`;

  try {
    // 从请求头获取 API Key
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
      console.error(`[${logId}] ❌ 缺少 API Key`);
      return res.status(401).json({
        success: false,
        error: '缺少 API Key，请在请求头中提供 X-API-Key'
      });
    }

    const requestBody = req.body;

    console.log(`[${logId}] 📋 速推API 代理请求:`, {
      hasPrompt: !!requestBody.prompt,
      promptLength: requestBody.prompt?.length,
      hasUrl: !!requestBody.url,
      model: requestBody.model,
      aspectRatio: requestBody.aspectRatio,
      duration: requestBody.duration
    });

    // 调用速推API
    const formData = new URLSearchParams();
    formData.append('prompt', requestBody.prompt);
    if (requestBody.url) {
      formData.append('url', requestBody.url);
    }
    if (requestBody.aspectRatio) {
      formData.append('aspectRatio', requestBody.aspectRatio);
    }
    if (requestBody.duration) {
      formData.append('duration', requestBody.duration);
    }
    if (requestBody.size) {
      formData.append('size', requestBody.size);
    }

    const response = await fetch('https://api.wuyinkeji.com/api/sora2-new/submit', {
      method: 'POST',
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/x-www-form-urlencoded;charset:utf-8;'
      },
      body: formData.toString()
    });

    const result = await response.json();

    const durationMs = Date.now() - startTime;
    console.log(`[${logId}] ✅ 速推API响应 (${durationMs}ms):`, {
      status: response.status,
      hasId: !!result.data?.id
    });

    if (!response.ok || result.code !== 200) {
      console.error(`[${logId}] ❌ 速推API错误:`, response.status, result);
      return res.status(response.status || 500).json({
        success: false,
        error: result.msg || '速推API创建任务失败',
        details: result
      });
    }

    res.json(result);

  } catch (error) {
    const durationMs = Date.now() - startTime;
    console.error(`[${logId}] ❌ 速推API代理错误 (${durationMs}ms):`, error);
    res.status(500).json({
      success: false,
      error: error.message || '速推API代理创建失败'
    });
  }
});

/**
 * 速推API代理 - 查询任务状态
 * GET /api/sutu/query?id={taskId}
 */
app.get('/api/sutu/query', async (req, res) => {
  const startTime = Date.now();
  const logId = `sutu-query-${Date.now()}`;

  try {
    const taskId = req.query.id;

    if (!taskId) {
      console.error(`[${logId}] ❌ 缺少任务 ID`);
      return res.status(400).json({
        success: false,
        error: '缺少任务 ID，请在查询参数中提供 id'
      });
    }

    // 从请求头获取 API Key
    const apiKey = req.headers['x-api-key'];

    console.log(`[${logId}] 🔍 查询速推API任务: ${taskId}`);

    // 调用速推API
    const response = await fetch(`https://api.wuyinkeji.com/api/sora2/detail?id=${taskId}&key=${apiKey}`, {
      method: 'GET',
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/x-www-form-urlencoded;charset:utf-8;'
      }
    });

    const result = await response.json();

    const durationMs = Date.now() - startTime;
    console.log(`[${logId}] ✅ 速推API查询响应 (${durationMs}ms):`, {
      status: result.data?.status,
      hasVideoUrl: !!result.data?.remote_url
    });

    if (!response.ok) {
      console.error(`[${logId}] ❌ 速推API查询错误:`, response.status);
      return res.status(response.status).json({
        success: false,
        error: '速推API查询失败'
      });
    }

    res.json(result);

  } catch (error) {
    const durationMs = Date.now() - startTime;
    console.error(`[${logId}] ❌ 速推API查询错误 (${durationMs}ms):`, error);
    res.status(500).json({
      success: false,
      error: error.message || '速推API查询失败'
    });
  }
});

/**
 * ==================== 一加API代理 ====================
 */

/**
 * 一加API代理 - 创建任务
 * POST /api/yijiapi/create
 */
app.post('/api/yijiapi/create', async (req, res) => {
  const startTime = Date.now();
  const logId = `yijiapi-submit-${Date.now()}`;

  try {
    // 从请求头获取 API Key
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
      console.error(`[${logId}] ❌ 缺少 API Key`);
      return res.status(401).json({
        success: false,
        error: '缺少 API Key，请在请求头中提供 X-API-Key'
      });
    }

    const requestBody = req.body;

    console.log(`[${logId}] 📋 一加API代理请求:`, {
      model: requestBody.model,
      size: requestBody.size,
      hasPrompt: !!requestBody.prompt,
      promptLength: requestBody.prompt?.length,
      hasReferenceImage: !!requestBody.input_reference
    });

    // 调用一加API
    const response = await fetch('https://ai.yijiarj.cn/v1/videos', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    const result = await response.json();

    const durationMs = Date.now() - startTime;
    console.log(`[${logId}] ✅ 一加API响应 (${durationMs}ms):`, {
      status: response.status,
      hasId: !!result.id
    });

    if (!response.ok) {
      console.error(`[${logId}] ❌ 一加API错误:`, response.status, result);
      return res.status(response.status).json({
        success: false,
        error: result.error || '一加API创建任务失败'
      });
    }

    res.json(result);

  } catch (error) {
    const durationMs = Date.now() - startTime;
    console.error(`[${logId}] ❌ 一加API代理错误 (${durationMs}ms):`, error);
    res.status(500).json({
      success: false,
      error: error.message || '一加API代理创建失败'
    });
  }
});

/**
 * 一加API代理 - 查询任务状态
 * GET /api/yijiapi/query/{taskId}
 */
app.get('/api/yijiapi/query/:taskId', async (req, res) => {
  const startTime = Date.now();
  const logId = `yijiapi-query-${Date.now()}`;

  try {
    const { taskId } = req.params;

    if (!taskId) {
      console.error(`[${logId}] ❌ 缺少任务 ID`);
      return res.status(400).json({
        success: false,
        error: '缺少任务 ID'
      });
    }

    // 从请求头获取 API Key
    const apiKey = req.headers['x-api-key'];

    console.log(`[${logId}] 🔍 查询一加API任务: ${taskId}`);

    // 调用一加API
    const response = await fetch(`https://ai.yijiarj.cn/v1/videos/${taskId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    const result = await response.json();

    const durationMs = Date.now() - startTime;
    console.log(`[${logId}] ✅ 一加API查询响应 (${durationMs}ms):`, {
      status: result.status,
      progress: result.progress,
      hasUrl: !!result.url
    });

    if (!response.ok) {
      console.error(`[${logId}] ❌ 一加API查询错误:`, response.status);
      return res.status(response.status).json({
        success: false,
        error: '一加API查询失败'
      });
    }

    res.json(result);

  } catch (error) {
    const durationMs = Date.now() - startTime;
    console.error(`[${logId}] ❌ 一加API查询错误 (${durationMs}ms):`, error);
    res.status(500).json({
      success: false,
      error: error.message || '一加API查询失败'
    });
  }
});

/**
 * 云雾API平台 - 提交视频生成任务
 * POST /api/yunwuapi/create
 * 支持多模型: veo, luma, runway, minimax, volcengine, grok, qwen, sora
 */
app.post('/api/yunwuapi/create', async (req, res) => {
  const startTime = Date.now();
  const logId = `yunwuapi-submit-${Date.now()}`;

  try {
    // 从请求头获取 API Key
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
      console.error(`[${logId}] ❌ 缺少 API Key`);
      return res.status(401).json({
        success: false,
        error: '缺少 API Key，请在请求头中提供 X-API-Key'
      });
    }

    const { model, prompt, images, aspect_ratio, duration, size, orientation, watermark, isPrivate, enhance_prompt, enable_upsample } = req.body;

    console.log(`[${logId}] 📤 云雾API平台 提交任务:`, {
      model,
      promptLength: prompt?.length,
      hasImages: !!images && images.length > 0,
      imagesCount: images?.length || 0,
      aspect_ratio,
      orientation,
      duration,
      size,
    });

    // 根据模型类型构建不同的请求
    let requestBody;
    let apiUrl = 'https://yunwu.ai/v1/video/create';

    // 判断是否为 luma 模型
    if (model && (model.startsWith('luma') || model === 'ray-v2')) {
      // luma 使用不同的端点
      apiUrl = 'https://yunwu.ai/luma/generations';
      requestBody = {
        user_prompt: prompt,
        model_name: model,
        duration: duration || '5s',
        resolution: size === 'large' || size === '1080p' ? '1080p' : '720p',
        expand_prompt: true,
        loop: false,
        ...(req.body.image_url && { image_url: req.body.image_url })
      };
    } else if (model && model.startsWith('veo')) {
      // veo 统一格式（Veo API 不支持 duration，由模型自动决定时长）
      requestBody = {
        model: model,
        prompt: prompt || '',
        images: images || [],
        aspect_ratio: aspect_ratio || '16:9',
        ...(enhance_prompt !== undefined && { enhance_prompt }),
        ...(enable_upsample !== undefined && { enable_upsample })
      };
    } else if (model && model.startsWith('sora')) {
      // sora 统一格式
      requestBody = {
        model: model,
        prompt: prompt || '',
        images: images || [],
        orientation: orientation || 'landscape',
        size: size || 'small',
        duration: duration || 10,
        watermark: watermark !== undefined ? watermark : true,
        private: isPrivate !== undefined ? isPrivate : false
      };
    } else {
      // 其他模型使用通用格式
      requestBody = {
        model: model || 'veo3.1-fast',
        prompt: prompt || '',
        images: images || [],
        aspect_ratio: aspect_ratio || '16:9',
        duration: duration || 5
      };
    }

    console.log(`[${logId}] 📋 发送到云雾API:`, {
      url: apiUrl,
      model: requestBody.model || requestBody.model_name,
      bodyPreview: JSON.stringify(requestBody).substring(0, 500)
    });

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const responseText = await response.text();
    const durationMs = Date.now() - startTime;

    console.log(`[${logId}] 📥 云雾API平台 原始响应:`, {
      status: response.status,
      statusText: response.statusText,
      responseText: responseText.substring(0, 500),
      duration: `${durationMs}ms`,
    });

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      console.error(`[${logId}] ❌ 解析响应 JSON 失败:`, e.message);
      data = { rawResponse: responseText };
    }

    if (!response.ok) {
      console.error(`[${logId}] ❌ 云雾API 错误:`, response.status, data);
      return res.status(response.status).json({
        success: false,
        error: data.message || data.error || '云雾API 提交失败',
        details: data
      });
    }

    // 处理不同的响应格式
    let taskId;
    if (model && (model.startsWith('luma') || model === 'ray-v2')) {
      // luma 的嵌套响应格式
      taskId = data.data?.task_id || data.task_id;
    } else {
      // veo/sora 的扁平响应格式
      taskId = data.id || data.task_id;
    }

    if (!taskId) {
      console.error(`[${logId}] ❌ 响应中缺少 task_id:`, data);
      return res.status(500).json({
        success: false,
        error: '响应中缺少task_id',
        details: data
      });
    }

    // 统一响应格式
    const result = {
      task_id: taskId,
      status: data.status || 'queued',
      message: '任务提交成功'
    };

    console.log(`[${logId}] ✅ 云雾API平台 成功:`, {
      status: response.status,
      taskId: result.task_id,
      taskStatus: result.status,
      duration: `${durationMs}ms`,
    });

    res.json(result);

  } catch (error) {
    const durationMs = Date.now() - startTime;
    console.error(`[${logId}] ❌ 云雾API平台 代理错误 (${durationMs}ms):`, error);
    res.status(500).json({
      success: false,
      error: error.message || '云雾API平台 代理提交失败'
    });
  }
});

/**
 * 云雾API平台 - 查询任务状态
 * POST /api/yunwuapi/status
 */
app.post('/api/yunwuapi/status', async (req, res) => {
  const startTime = Date.now();
  const logId = `yunwuapi-query-${Date.now()}`;

  try {
    const { model, task_id } = req.body;

    if (!task_id) {
      console.error(`[${logId}] ❌ 缺少任务 ID`);
      return res.status(400).json({
        success: false,
        error: '缺少任务 ID'
      });
    }

    // 从请求头获取 API Key
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
      console.error(`[${logId}] ❌ 缺少 API Key`);
      return res.status(401).json({
        success: false,
        error: '缺少 API Key，请在请求头中提供 X-API-Key'
      });
    }

    console.log(`[${logId}] 🔍 云雾API平台 查询任务:`, { model, task_id });

    // 云雾API平台的查询接口
    const apiUrl = `https://yunwu.ai/v1/video/query?id=${encodeURIComponent(task_id)}`;

    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    const data = await response.json();
    const durationMs = Date.now() - startTime;

    // 添加完整响应日志，方便调试
    console.log(`[${logId}] 📥 云雾API完整响应:`, JSON.stringify(data, null, 2));
    
    // 调试：输出所有可能的字段
    console.log(`[${logId}] 🔍 字段检查:`, {
      'data.id': data.id,
      'data.status': data.status,
      'data.detail.status': data.detail?.status,
      'data.detail.progress_pct': data.detail?.progress_pct,
      'data.detail.video_url': data.detail?.video_url,
      'data.detail.output?.media_url': data.detail?.output?.media_url,
      'data.status_update_time': data.status_update_time,
    });
    
    // 云雾API返回嵌套结构，不同模型/阶段格式不同：
    // - 统一格式: { id, status, detail: { status, progress_pct, video_url, pending_info: { progress_pct } } }
    // - OpenAI格式: { id, status, progress, video_url }（completed 时扁平结构）
    const detail = data.detail || {};
    const pendingInfo = detail.pending_info || {};
    const actualStatus = detail.status || data.status || 'pending';

    // 进度处理：progress_pct 可���在 detail 或 detail.pending_info 中（0-1 浮点数）
    let progress = 0;
    const progressPct = detail.progress_pct ?? pendingInfo.progress_pct;
    if (progressPct !== undefined && progressPct !== null) {
      progress = Math.round(progressPct * 100);
    } else if (data.progress !== undefined) {
      // OpenAI 格式 completed 时直接返回 progress: 100
      progress = data.progress;
    } else {
      // 根据状态推断进度（覆盖 veo/luma/runway/sora 所有中间状态）
      switch (actualStatus) {
        // 排队/等待
        case 'pending':
        case 'queued':
        case 'submitted':
          progress = 5;
          break;
        // 预处理
        case 'image_downloading':
          progress = 15;
          break;
        // 视频生成中
        case 'processing':
        case 'generating':
        case 'video_generating':
          progress = 40;
          break;
        // 视频生成完成，进入超分
        case 'video_generation_completed':
          progress = 60;
          break;
        // 超分辨率处理中
        case 'video_upsampling':
          progress = 75;
          break;
        // 超分完成
        case 'video_upsampling_completed':
          progress = 95;
          break;
        // 完成
        case 'completed':
        case 'succeeded':
          progress = 100;
          break;
        // 失败
        case 'failed':
        case 'error':
        case 'video_generation_failed':
        case 'video_upsampling_failed':
          progress = 0;
          break;
        default:
          progress = 30;
      }
    }

    // 提取视频URL（多个可能位置）
    const videoUrl = detail.video_url || detail.output?.media_url || data.video_url;

    console.log(`[${logId}] ✅ 云雾API平台 查询响应:`, {
      status: response.status,
      taskId: data.id || task_id,
      taskStatus: actualStatus,
      progress: progress,
      hasVideo: !!videoUrl,
      videoUrl: videoUrl || '(none)',
      duration: `${durationMs}ms`,
    });

    if (!response.ok) {
      console.error(`[${logId}] ❌ 云雾API平台 查询错误:`, response.status, data);
      return res.status(response.status).json({
        success: false,
        error: data.message || data.error || '云雾API平台 查询失败',
        details: data
      });
    }

    // 统一状态值：将各模型的中间状态归一化为 4 类
    let taskStatus;
    switch (actualStatus) {
      case 'pending':
      case 'queued':
      case 'submitted':
        taskStatus = 'pending';
        break;
      case 'processing':
      case 'generating':
      case 'image_downloading':
      case 'video_generating':
      case 'video_generation_completed':
      case 'video_upsampling':
      case 'video_upsampling_completed':
        taskStatus = 'processing';
        break;
      case 'completed':
      case 'succeeded':
        taskStatus = 'completed';
        break;
      case 'failed':
      case 'error':
      case 'video_generation_failed':
      case 'video_upsampling_failed':
        taskStatus = 'failed';
        break;
      default:
        taskStatus = 'processing';
    }

    const result = {
      task_id: data.id || task_id,
      status: taskStatus,
      status_detail: actualStatus,  // 原始详细状态（如 video_generating, video_upsampling）
      progress: progress,
      video_url: videoUrl,
      duration: detail.duration || data.duration,
      resolution: detail.resolution || data.resolution || data.size,
      cover_url: detail.cover_url || data.cover_url,
      error: taskStatus === 'failed' ? (detail.failure_reason || pendingInfo.failure_reason || data.error || '视频生成失败') : undefined
    };

    res.json(result);

  } catch (error) {
    const durationMs = Date.now() - startTime;
    console.error(`[${logId}] ❌ 云雾API平台 代理查询错误 (${durationMs}ms):`, error);
    res.status(500).json({
      success: false,
      error: error.message || '云雾API平台 代理查询失败'
    });
  }
});

/**
 * 错误处理
 */
app.use((err, req, res, next) => {
  console.error('❌ 服务器错误:', err);
  res.status(500).json({
    success: false,
    error: '服务器内部错误'
  });
});

/**
 * 前端日志上报接口
 * POST /api/logs
 * 接收前端发送的日志并保存到服务器文件
 */
app.post('/api/logs', async (req, res) => {
  try {
    const logEntry = req.body;

    // 验证日志格式
    if (!logEntry || !logEntry.apiName) {
      return res.status(400).json({
        success: false,
        error: '无效的日志格式'
      });
    }

    // 写入日志文件
    const written = writeLog(logEntry);

    if (written) {
      console.log(`📝 前端日志已记录: ${logEntry.apiName} - ${logEntry.status}`);
      res.json({
        success: true,
        message: '日志已保存'
      });
    } else {
      res.status(500).json({
        success: false,
        error: '日志保存失败'
      });
    }

  } catch (error) {
    console.error('❌ 日志上报失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '日志上报失败'
    });
  }
});

/**
 * 获取日志统计接口
 * GET /api/logs/stats
 */
app.get('/api/logs/stats', async (req, res) => {
  try {
    const fs = await import('fs');
    const path = await import('path');

    const API_LOG_FILE = path.join(process.cwd(), '../logs/api.log');
    const ERROR_LOG_FILE = path.join(process.cwd(), '../logs/error.log');

    let apiLogStats = { exists: false, size: 0, lines: 0 };
    let errorLogStats = { exists: false, size: 0, lines: 0 };

    if (fs.existsSync(API_LOG_FILE)) {
      const stats = fs.statSync(API_LOG_FILE);
      const content = fs.readFileSync(API_LOG_FILE, 'utf8');
      apiLogStats = {
        exists: true,
        size: stats.size,
        lines: content.split('\n').filter(line => line.trim().length > 0).length
      };
    }

    if (fs.existsSync(ERROR_LOG_FILE)) {
      const stats = fs.statSync(ERROR_LOG_FILE);
      const content = fs.readFileSync(ERROR_LOG_FILE, 'utf8');
      errorLogStats = {
        exists: true,
        size: stats.size,
        lines: content.split('\n').filter(line => line.trim().length > 0).length
      };
    }

    res.json({
      success: true,
      apiLog: apiLogStats,
      errorLog: errorLogStats
    });

  } catch (error) {
    console.error('❌ 获取日志统计失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '获取日志统计失败'
    });
  }
});

// ============================================================================
// 视频数据库存储系统
// ============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 视频存储目录
const VIDEOS_DIR = path.join(__dirname, '../videos');
const VIDEO_DB_FILE = path.join(__dirname, '../videos/database.json');

// 确保目录存在
if (!fs.existsSync(VIDEOS_DIR)) {
  fs.mkdirSync(VIDEOS_DIR, { recursive: true });
}

// 初始化视频数据库
if (!fs.existsSync(VIDEO_DB_FILE)) {
  fs.writeFileSync(VIDEO_DB_FILE, JSON.stringify({ videos: [] }, null, 2));
}

/**
 * 读取视频数据库
 */
function readVideoDatabase() {
  try {
    const data = fs.readFileSync(VIDEO_DB_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('[视频数据库] 读取失败:', error);
    return { videos: [] };
  }
}

/**
 * 写入视频数据库
 */
function writeVideoDatabase(data) {
  try {
    fs.writeFileSync(VIDEO_DB_FILE, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error('[视频数据库] 写入失败:', error);
    return false;
  }
}

/**
 * 保存视频到数据库
 * POST /api/videos/save
 */
app.post('/api/videos/save', async (req, res) => {
  try {
    const { videoUrl, taskId, taskNumber, soraPrompt } = req.body;

    if (!videoUrl) {
      return res.status(400).json({
        success: false,
        error: '缺少 videoUrl 参数'
      });
    }

    console.log(`[视频保存] 开始保存视频:`, {
      taskId,
      taskNumber,
      videoUrl: videoUrl.substring(0, 100) + '...'
    });

    // 1. 下载视频
    const response = await fetch(videoUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`视频下载失败: HTTP ${response.status}`);
    }

    // 2. 生成文件名和路径
    const filename = `sora-${taskId || 'unknown'}-${Date.now()}.mp4`;
    const filepath = path.join(VIDEOS_DIR, filename);

    // 3. 保存视频文件
    const { Readable } = await import('stream');
    const nodeStream = Readable.fromWeb(response.body);
    const fileStream = fs.createWriteStream(filepath);

    await new Promise((resolve, reject) => {
      nodeStream.pipe(fileStream);
      nodeStream.on('end', resolve);
      nodeStream.on('error', reject);
      fileStream.on('error', reject);
    });

    // 4. 获取文件大小
    const stats = fs.statSync(filepath);
    const fileSizeMB = (stats.size / 1024 / 1024).toFixed(2);

    console.log(`[视频保存] ✅ 视频已保存: ${filename} (${fileSizeMB} MB)`);

    // 5. 更新数据库
    const db = readVideoDatabase();
    const videoRecord = {
      id: taskId || `video-${Date.now()}`,
      filename,
      filepath,
      taskId,
      taskNumber,
      soraPrompt: soraPrompt ? soraPrompt.substring(0, 500) : undefined,
      originalUrl: videoUrl,
      fileSize: stats.size,
      createdAt: new Date().toISOString()
    };

    db.videos.push(videoRecord);
    writeVideoDatabase(db);

    res.json({
      success: true,
      message: '视频保存成功',
      video: {
        id: videoRecord.id,
        filename,
        fileSize: stats.size,
        downloadUrl: `/api/videos/download/${videoRecord.id}`
      }
    });

  } catch (error) {
    console.error('[视频保存] ❌ 保存失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '视频保存失败'
    });
  }
});

/**
 * 从数据库下载视频
 * GET /api/videos/download/:id
 */
app.get('/api/videos/download/:id', (req, res) => {
  try {
    const { id } = req.params;

    console.log(`[视频下载] 请求下载视频 ID: ${id}`);

    // 1. 从数据库查找视频记录
    const db = readVideoDatabase();
    const videoRecord = db.videos.find(v => v.id === id);

    if (!videoRecord) {
      return res.status(404).json({
        success: false,
        error: '视频不存在'
      });
    }

    // 2. 检查文件是否存在
    if (!fs.existsSync(videoRecord.filepath)) {
      return res.status(404).json({
        success: false,
        error: '视频文件已丢失'
      });
    }

    console.log(`[视频下载] 开始传输: ${videoRecord.filename}`);

    // 3. 设置响应头
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${videoRecord.filename}"`);
    res.setHeader('Content-Length', videoRecord.fileSize);

    // 4. 流式传输文件
    const fileStream = fs.createReadStream(videoRecord.filepath);
    fileStream.pipe(res);

    fileStream.on('end', () => {
      console.log(`[视频下载] ✅ 传输完成: ${videoRecord.filename}`);
    });

    fileStream.on('error', (error) => {
      console.error(`[视频下载] ❌ 传输失败:`, error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: '文件传输失败'
        });
      }
    });

  } catch (error) {
    console.error('[视频下载] ❌ 下载失败:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: error.message || '视频下载失败'
      });
    }
  }
});

/**
 * 获取视频列表
 * GET /api/videos/list
 */
app.get('/api/videos/list', (req, res) => {
  try {
    const db = readVideoDatabase();

    // 计算总大小
    const totalSize = db.videos.reduce((sum, v) => sum + (v.fileSize || 0), 0);

    res.json({
      success: true,
      count: db.videos.length,
      totalSize,
      videos: db.videos.map(v => ({
        id: v.id,
        filename: v.filename,
        taskNumber: v.taskNumber,
        fileSize: v.fileSize,
        createdAt: v.createdAt,
        downloadUrl: `/api/videos/download/${v.id}`
      }))
    });
  } catch (error) {
    console.error('[视频列表] ❌ 查询失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '查询失败'
    });
  }
});

/**
 * 删除视频
 * DELETE /api/videos/:id
 */
app.delete('/api/videos/:id', (req, res) => {
  try {
    const { id } = req.params;
    const db = readVideoDatabase();
    const videoIndex = db.videos.findIndex(v => v.id === id);

    if (videoIndex === -1) {
      return res.status(404).json({
        success: false,
        error: '视频不存在'
      });
    }

    const videoRecord = db.videos[videoIndex];

    // 删除文件
    if (fs.existsSync(videoRecord.filepath)) {
      fs.unlinkSync(videoRecord.filepath);
      console.log(`[视频删除] ✅ 已删除文件: ${videoRecord.filename}`);
    }

    // 从数据库删除
    db.videos.splice(videoIndex, 1);
    writeVideoDatabase(db);

    res.json({
      success: true,
      message: '视频已删除'
    });
  } catch (error) {
    console.error('[视频删除] ❌ 删除失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '删除失败'
    });
  }
});

// ============================================================
// 模型配置管理后台路由
// ============================================================

// 默认配置数据
const getDefaultConfig = () => ({
  version: '1.0.0',
  updatedAt: new Date().toISOString(),
  platforms: [
    {
      id: 'yunwuapi-platform',
      code: 'yunwuapi',
      name: '云雾API',
      description: '云雾AI视频生成平台',
      enabled: true,
      baseUrl: 'https://yunwu.ai',
      apiKeyRequired: true,
      models: [
        {
          id: 'veo-model',
          platformId: 'yunwuapi-platform',
          code: 'veo',
          name: 'Veo',
          description: 'Google Veo视频生成模型',
          enabled: true,
          useUnifiedEndpoint: true,
          checkEndpoint: '/veo/status',
          subModels: [
            { id: 'veo3.1-4k', modelId: 'veo-model', code: 'veo3.1-4k', name: 'Veo 3.1 4K', description: '4K 分辨率', enabled: true },
            { id: 'veo3.1-components-4k', modelId: 'veo-model', code: 'veo3.1-components-4k', name: 'Veo 3.1 Components 4K', description: '元素控制 4K', enabled: true },
            { id: 'veo3.1-pro-4k', modelId: 'veo-model', code: 'veo3.1-pro-4k', name: 'Veo 3.1 Pro 4K', description: 'Pro 4K 分辨率', enabled: true },
            { id: 'veo3.1', modelId: 'veo-model', code: 'veo3.1', name: 'Veo 3.1', description: 'Veo 3.1 标准版', enabled: true },
            { id: 'veo3.1-pro', modelId: 'veo-model', code: 'veo3.1-pro', name: 'Veo 3.1 Pro', description: 'Veo 3.1 专业版', enabled: true },
            { id: 'veo3.1-components', modelId: 'veo-model', code: 'veo3.1-components', name: 'Veo 3.1 Components', description: '元素控制', enabled: true },
            { id: 'veo3.1-fast-components', modelId: 'veo-model', code: 'veo3.1-fast-components', name: 'Veo 3.1 Fast Components', description: '快速元素控制', enabled: true },
            { id: 'veo3.1-fast', modelId: 'veo-model', code: 'veo3.1-fast', name: 'Veo 3.1 Fast', description: 'Veo 3.1 快速版', enabled: true, default: true }
          ],
          defaultSubModel: 'veo3.1-fast',
          supportsImageRef: true,
          maxDuration: 10,
          maxPromptLength: 500
        },
        {
          id: 'luma-model',
          platformId: 'yunwuapi-platform',
          code: 'luma',
          name: 'Luma',
          description: 'Luma Dream Machine视频生成',
          enabled: true,
          useUnifiedEndpoint: false,
          submitEndpoint: '/luma/generations',
          checkEndpoint: '/luma/status',
          subModels: [
            { id: 'ray-v2', modelId: 'luma-model', code: 'ray-v2', name: 'Ray V2', description: 'Luma Ray V2', enabled: true, default: true },
            { id: 'photon', modelId: 'luma-model', code: 'photon', name: 'Photon', description: 'Photon 模型', enabled: true },
            { id: 'photon-flash', modelId: 'luma-model', code: 'photon-flash', name: 'Photon Flash', description: '快速 Photon', enabled: true }
          ],
          defaultSubModel: 'ray-v2',
          supportsImageRef: true,
          maxDuration: 5,
          maxPromptLength: 500
        },
        {
          id: 'sora-model',
          platformId: 'yunwuapi-platform',
          code: 'sora',
          name: 'Sora',
          description: 'OpenAI Sora视频生成',
          enabled: true,
          useUnifiedEndpoint: true,
          checkEndpoint: '/sora/status',
          subModels: [
            { id: 'sora', modelId: 'sora-model', code: 'sora', name: 'Sora', description: 'OpenAI Sora', enabled: true },
            { id: 'sora-2', modelId: 'sora-model', code: 'sora-2', name: 'Sora 2', description: 'Sora 2 模型', enabled: true, default: true }
          ],
          defaultSubModel: 'sora-2',
          supportsImageRef: true,
          maxDuration: 10,
          maxPromptLength: 500
        },
        {
          id: 'runway-model',
          platformId: 'yunwuapi-platform',
          code: 'runway',
          name: 'Runway',
          description: 'Runway Gen-3视频生成',
          enabled: true,
          useUnifiedEndpoint: true,
          checkEndpoint: '/runway/status',
          subModels: [
            { id: 'gen3-alpha-turbo', modelId: 'runway-model', code: 'gen3-alpha-turbo', name: 'Gen-3 Alpha Turbo', description: '极速版', enabled: true, default: true },
            { id: 'gen3-alpha', modelId: 'runway-model', code: 'gen3-alpha', name: 'Gen-3 Alpha', description: '标准版', enabled: true },
            { id: 'gen3-alpha-extreme', modelId: 'runway-model', code: 'gen3-alpha-extreme', name: 'Gen-3 Alpha Extreme', description: '极致版', enabled: true }
          ],
          defaultSubModel: 'gen3-alpha-turbo',
          supportsImageRef: true,
          maxDuration: 10,
          maxPromptLength: 500
        },
        {
          id: 'minimax-model',
          platformId: 'yunwuapi-platform',
          code: 'minimax',
          name: 'MiniMax',
          description: 'MiniMax视频生成',
          enabled: true,
          useUnifiedEndpoint: true,
          checkEndpoint: '/minimax/status',
          subModels: [
            { id: 'minimax-video-01', modelId: 'minimax-model', code: 'minimax-video-01', name: 'MiniMax Video 01', description: '标准模型', enabled: true, default: true }
          ],
          defaultSubModel: 'minimax-video-01',
          supportsImageRef: false,
          maxDuration: 6,
          maxPromptLength: 500
        },
        {
          id: 'volcengine-model',
          platformId: 'yunwuapi-platform',
          code: 'volcengine',
          name: 'Seedance / 火山引擎',
          description: '字节跳动 Seedance / 火山引擎视频生成',
          enabled: true,
          useUnifiedEndpoint: true,
          checkEndpoint: '/volcengine/status',
          subModels: [
            { id: 'volc-video-01', modelId: 'volcengine-model', code: 'volc-video-01', name: 'Seedance 2.0', description: '标准模型', enabled: true, default: true }
          ],
          defaultSubModel: 'volc-video-01',
          supportsImageRef: true,
          maxDuration: 5,
          maxPromptLength: 500
        },
        {
          id: 'grok-model',
          platformId: 'yunwuapi-platform',
          code: 'grok',
          name: 'Grok',
          description: 'xAI Grok视频生成',
          enabled: true,
          useUnifiedEndpoint: true,
          checkEndpoint: '/grok/status',
          subModels: [
            { id: 'grok-video', modelId: 'grok-model', code: 'grok-video', name: 'Grok Video', description: 'Grok 视频模型', enabled: true, default: true }
          ],
          defaultSubModel: 'grok-video',
          supportsImageRef: false,
          maxDuration: 5,
          maxPromptLength: 500
        },
        {
          id: 'qwen-model',
          platformId: 'yunwuapi-platform',
          code: 'qwen',
          name: '通义千问',
          description: '阿里通义千问视频生成',
          enabled: true,
          useUnifiedEndpoint: true,
          checkEndpoint: '/qwen/status',
          subModels: [
            { id: 'qwen-video', modelId: 'qwen-model', code: 'qwen-video', name: 'Qwen Video', description: '通义千问视频', enabled: true, default: true }
          ],
          defaultSubModel: 'qwen-video',
          supportsImageRef: true,
          maxDuration: 5,
          maxPromptLength: 500
        }
      ]
    }
  ]
});

// 获取配置文件路径
const getConfigPath = () => path.join(__dirname, 'model-config.json');

// 读取配置
const loadConfig = () => {
  try {
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
    // 返回默认配置
    return getDefaultConfig();
  } catch (error) {
    console.error('[Admin] 读取配置失败:', error);
    return getDefaultConfig();
  }
};

// 保存配置
const saveConfig = (config) => {
  try {
    const configPath = getConfigPath();
    config.updatedAt = new Date().toISOString();
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    return { success: true };
  } catch (error) {
    console.error('[Admin] 保存配置失败:', error);
    return { success: false, error: error.message };
  }
};

// 服务管理后台静态页面
app.use('/admin', express.static(path.join(__dirname, 'public')));

// 管理后台API - 获取配置
app.get('/api/admin/config', (req, res) => {
  try {
    const config = loadConfig();
    res.json(config);
  } catch (error) {
    console.error('[Admin] 获取配置失败:', error);
    res.status(500).json({ success: false, error: '获取配置失败' });
  }
});

// 管理后台API - 导出配置
app.get('/api/admin/config/export', (req, res) => {
  try {
    const config = loadConfig();
    const json = JSON.stringify(config, null, 2);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=model-config-${new Date().toISOString().split('T')[0]}.json`);
    res.send(json);
  } catch (error) {
    console.error('[Admin] 导出配置失败:', error);
    res.status(500).json({ success: false, error: '导出配置失败' });
  }
});

// 管理后台API - 导入配置
app.post('/api/admin/config/import', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: '请上传配置文件' });
    }

    const config = JSON.parse(req.file.buffer.toString('utf8'));

    // 验证配置格式
    if (!config.platforms || !Array.isArray(config.platforms)) {
      return res.status(400).json({ success: false, error: '配置格式无效' });
    }

    // 保存配置
    saveConfig(config);

    res.json({ success: true, message: '导入成功' });
  } catch (error) {
    console.error('[Admin] 导入配置失败:', error);
    res.status(500).json({ success: false, error: '导入配置失败' });
  }
});

// 管理后台API - 重置配置
app.post('/api/admin/config/reset', (req, res) => {
  try {
    // 删除配置文件
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
    }

    res.json({ success: true, message: '重置成功' });
  } catch (error) {
    console.error('[Admin] 重置配置失败:', error);
    res.status(500).json({ success: false, error: '重置配置失败' });
  }
});

// 管理后台API - 添加平台
app.post('/api/admin/platforms', (req, res) => {
  try {
    const config = loadConfig();
    const newPlatform = {
      ...req.body,
      id: `platform-${Date.now()}`,
      models: req.body.models || []
    };

    config.platforms.push(newPlatform);
    saveConfig(config);

    res.json({ success: true, message: '平台添加成功', data: newPlatform });
  } catch (error) {
    console.error('[Admin] 添加平台失败:', error);
    res.status(500).json({ success: false, error: '添加平台失败' });
  }
});

// 管理后台API - 更新平台
app.put('/api/admin/platforms/:id', (req, res) => {
  try {
    const config = loadConfig();
    const { id } = req.params;

    const index = config.platforms.findIndex(p => p.id === id);
    if (index === -1) {
      return res.status(404).json({ success: false, error: '平台不存在' });
    }

    config.platforms[index] = { ...config.platforms[index], ...req.body };
    saveConfig(config);

    res.json({ success: true, message: '平台更新成功' });
  } catch (error) {
    console.error('[Admin] 更新平台失败:', error);
    res.status(500).json({ success: false, error: '更新平台失败' });
  }
});

// 管理后台API - 删除平台
app.delete('/api/admin/platforms/:id', (req, res) => {
  try {
    const config = loadConfig();
    const { id } = req.params;

    config.platforms = config.platforms.filter(p => p.id !== id);
    saveConfig(config);

    res.json({ success: true, message: '平台删除成功' });
  } catch (error) {
    console.error('[Admin] 删除平台失败:', error);
    res.status(500).json({ success: false, error: '删除平台失败' });
  }
});

// 管理后台API - 添加模型
app.post('/api/admin/platforms/:platformId/models', (req, res) => {
  try {
    const config = loadConfig();
    const { platformId } = req.params;

    const platform = config.platforms.find(p => p.id === platformId);
    if (!platform) {
      return res.status(404).json({ success: false, error: '平台不存在' });
    }

    const newModel = {
      ...req.body,
      id: `model-${Date.now()}`,
      subModels: req.body.subModels || []
    };

    platform.models.push(newModel);
    saveConfig(config);

    res.json({ success: true, message: '模型添加成功', data: newModel });
  } catch (error) {
    console.error('[Admin] 添加模型失败:', error);
    res.status(500).json({ success: false, error: '添加模型失败' });
  }
});

// 管理后台API - 更新模型
app.put('/api/admin/platforms/:platformId/models/:id', (req, res) => {
  try {
    const config = loadConfig();
    const { platformId, id } = req.params;

    const platform = config.platforms.find(p => p.id === platformId);
    if (!platform) {
      return res.status(404).json({ success: false, error: '平台不存在' });
    }

    const modelIndex = platform.models.findIndex(m => m.id === id);
    if (modelIndex === -1) {
      return res.status(404).json({ success: false, error: '模型不存在' });
    }

    platform.models[modelIndex] = { ...platform.models[modelIndex], ...req.body };
    saveConfig(config);

    res.json({ success: true, message: '模型更新成功' });
  } catch (error) {
    console.error('[Admin] 更新模型失败:', error);
    res.status(500).json({ success: false, error: '更新模型失败' });
  }
});

// 管理后台API - 删除模型
app.delete('/api/admin/platforms/:platformId/models/:id', (req, res) => {
  try {
    const config = loadConfig();
    const { platformId, id } = req.params;

    const platform = config.platforms.find(p => p.id === platformId);
    if (!platform) {
      return res.status(404).json({ success: false, error: '平台不存在' });
    }

    platform.models = platform.models.filter(m => m.id !== id);
    saveConfig(config);

    res.json({ success: true, message: '模型删除成功' });
  } catch (error) {
    console.error('[Admin] 删除模型失败:', error);
    res.status(500).json({ success: false, error: '删除模型失败' });
  }
});

// 管理后台API - 添加子模型
app.post('/api/admin/platforms/:platformId/models/:modelId/submodels', (req, res) => {
  try {
    const config = loadConfig();
    const { platformId, modelId } = req.params;

    const platform = config.platforms.find(p => p.id === platformId);
    if (!platform) {
      return res.status(404).json({ success: false, error: '平台不存在' });
    }

    const model = platform.models.find(m => m.id === modelId);
    if (!model) {
      return res.status(404).json({ success: false, error: '模型不存在' });
    }

    const newSubModel = {
      ...req.body,
      id: `sub-${Date.now()}`
    };

    model.subModels.push(newSubModel);
    saveConfig(config);

    res.json({ success: true, message: '子模型添加成功', data: newSubModel });
  } catch (error) {
    console.error('[Admin] 添加子模型失败:', error);
    res.status(500).json({ success: false, error: '添加子模型失败' });
  }
});

// 管理后台API - 更新子模型
app.put('/api/admin/platforms/:platformId/models/:modelId/submodels/:id', (req, res) => {
  try {
    const config = loadConfig();
    const { platformId, modelId, id } = req.params;

    const platform = config.platforms.find(p => p.id === platformId);
    if (!platform) {
      return res.status(404).json({ success: false, error: '平台不存在' });
    }

    const model = platform.models.find(m => m.id === modelId);
    if (!model) {
      return res.status(404).json({ success: false, error: '模型不存在' });
    }

    const subModelIndex = model.subModels.findIndex(sm => sm.id === id);
    if (subModelIndex === -1) {
      return res.status(404).json({ success: false, error: '子模型不存在' });
    }

    model.subModels[subModelIndex] = { ...model.subModels[subModelIndex], ...req.body };
    saveConfig(config);

    res.json({ success: true, message: '子模型更新成功' });
  } catch (error) {
    console.error('[Admin] 更新子模型失败:', error);
    res.status(500).json({ success: false, error: '更新子模型失败' });
  }
});

// 管理后台API - 删除子模型
app.delete('/api/admin/platforms/:platformId/models/:modelId/submodels/:id', (req, res) => {
  try {
    const config = loadConfig();
    const { platformId, modelId, id } = req.params;

    const platform = config.platforms.find(p => p.id === platformId);
    if (!platform) {
      return res.status(404).json({ success: false, error: '平台不存在' });
    }

    const model = platform.models.find(m => m.id === modelId);
    if (!model) {
      return res.status(404).json({ success: false, error: '模型不存在' });
    }

    model.subModels = model.subModels.filter(sm => sm.id !== id);
    saveConfig(config);

    res.json({ success: true, message: '子模型删除成功' });
  } catch (error) {
    console.error('[Admin] 删除子模型失败:', error);
    res.status(500).json({ success: false, error: '删除子模型失败' });
  }
});

// API 路由
app.use('/api/projects', projectsRouter);
app.use('/api/nodes', nodesRouter);
app.use('/api/connections', connectionsRouter);
app.use('/api/media', mediaRouter);

// 静态文件：上传的媒体文件
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

/**
 * 404 处理
 */
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: '接口不存在'
  });
});

/**
 * 启动服务器
 */

// 托管前端静态文件（生产构建产物）
const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  // SPA fallback: 所有非 API 路由返回 index.html
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/admin')) {
      return next();
    }
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log('🚀 AIYOU Backend Server started');
  console.log(`📍 HTTP: http://localhost:${PORT}`);
  console.log(`🔧 Health: http://localhost:${PORT}/api/health`);
  console.log(`📤 Upload: http://localhost:${PORT}/api/upload-oss`);
  console.log(`🎛️  Admin: http://localhost:${PORT}/admin`);
  if (fs.existsSync(distPath)) {
    console.log(`🌐 Frontend: http://localhost:${PORT}`);
  }
  console.log('');
  console.log('⚙️  OSS Configuration:');
  console.log(`   Bucket: ${ossConfig.bucket}`);
  console.log(`   Region: ${ossConfig.region}`);
});
