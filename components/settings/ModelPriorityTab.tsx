import React, { useState, useEffect, useCallback } from 'react';
import { Image as ImageIcon, Type, Music, Video, RefreshCw } from 'lucide-react';
import {
  ModelCategory,
  getModelsByCategory,
  IMAGE_MODELS,
  TEXT_MODELS,
  AUDIO_MODELS,
  VIDEO_MODELS
} from '../../services/modelConfig';

interface CategoryConfig {
  label: string;
  icon: React.ElementType;
  description: string;
  localStorageKey: string;
  builtinModels: { id: string; name: string }[];
}

const CATEGORIES: Record<string, CategoryConfig> = {
  text: {
    label: '文本模型 (LLM)',
    icon: Type,
    description: '剧本生成、分镜描述、提示词优化等文本任务',
    localStorageKey: 'default_text_model',
    builtinModels: TEXT_MODELS.map(m => ({ id: m.id, name: m.name }))
  },
  image: {
    label: '图片模型',
    icon: ImageIcon,
    description: '文生图、角色设计、分镜图片生成',
    localStorageKey: 'default_image_model',
    builtinModels: IMAGE_MODELS.map(m => ({ id: m.id, name: m.name }))
  },
  video: {
    label: '视频模型',
    icon: Video,
    description: '文生视频、分镜视频生成，包含 Seedance / 豆包',
    localStorageKey: 'default_video_model',
    builtinModels: VIDEO_MODELS.map(m => ({ id: m.id, name: m.name }))
  },
  audio: {
    label: '音频模型',
    icon: Music,
    description: 'TTS 语音合成、音效生成',
    localStorageKey: 'default_audio_model',
    builtinModels: AUDIO_MODELS.map(m => ({ id: m.id, name: m.name }))
  }
};

interface ModelPriorityTabProps {
  onClose: () => void;
}

export const ModelPriorityTab: React.FC<ModelPriorityTabProps> = React.memo(({ onClose }) => {
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  const [yunwuModels, setYunwuModels] = useState<string[]>([]);
  const [isSaved, setIsSaved] = useState(false);

  useEffect(() => {
    // 读取每个类别已保存的默认模型
    const saved: Record<string, string> = {};
    Object.entries(CATEGORIES).forEach(([key, cat]) => {
      const val = localStorage.getItem(cat.localStorageKey);
      if (val) saved[key] = val;
    });
    setDefaults(saved);

    // 读取云雾模型列表
    const cached = localStorage.getItem('YUNWU_MODELS');
    if (cached) {
      try { setYunwuModels(JSON.parse(cached)); } catch {}
    }
  }, []);

  const handleChange = useCallback((category: string, modelId: string) => {
    setDefaults(prev => ({ ...prev, [category]: modelId }));
  }, []);

  const handleSave = useCallback(() => {
    Object.entries(CATEGORIES).forEach(([key, cat]) => {
      const val = defaults[key];
      if (val) {
        localStorage.setItem(cat.localStorageKey, val);
      } else {
        localStorage.removeItem(cat.localStorageKey);
      }
    });
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
    setTimeout(onClose, 500);
  }, [defaults, onClose]);

  const handleReset = useCallback(() => {
    Object.entries(CATEGORIES).forEach(([, cat]) => {
      localStorage.removeItem(cat.localStorageKey);
    });
    setDefaults({});
  }, []);

  // 合并内置模型和云雾模型，去重
  const getOptionsForCategory = (category: string): { id: string; name: string }[] => {
    const cat = CATEGORIES[category];
    const builtin = cat.builtinModels;
    const builtinIds = new Set(builtin.map(m => m.id));

    // 云雾模型中不在内置列表里的
    const extra = yunwuModels
      .filter(id => !builtinIds.has(id))
      .map(id => ({ id, name: id }));

    return [...builtin, ...extra];
  };

  return (
    <>
      <div className="p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-white">默认模型配置</h3>
            <p className="text-[11px] text-slate-400">
              为每种任务类型选择默认使用的模型
            </p>
          </div>
          <button
            onClick={handleReset}
            className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-[10px] text-slate-400 hover:text-white transition-all flex items-center gap-1"
          >
            <RefreshCw size={12} />
            <span>重置全部</span>
          </button>
        </div>

        {Object.entries(CATEGORIES).map(([key, category]) => {
          const Icon = category.icon;
          const options = getOptionsForCategory(key);
          const currentValue = defaults[key] || '';

          return (
            <div key={key} className="space-y-2">
              <div className="flex items-center gap-2">
                <Icon size={16} className="text-slate-500" />
                <span className="text-xs font-bold text-slate-300">{category.label}</span>
              </div>
              <p className="text-[10px] text-slate-500">{category.description}</p>
              <select
                value={currentValue}
                onChange={(e) => handleChange(key, e.target.value)}
                className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-cyan-500/50 focus:bg-white/10 transition-all appearance-none cursor-pointer"
              >
                <option value="" className="bg-[#1a1a2e]">使用系统默认</option>
                {options.map((model) => (
                  <option key={model.id} value={model.id} className="bg-[#1a1a2e]">
                    {model.name}
                  </option>
                ))}
              </select>
            </div>
          );
        })}

        {yunwuModels.length === 0 && (
          <p className="text-[10px] text-slate-500 mt-2">
            提示：在「基础设置」中配置云雾 API Key 后，可获取更多可用模型
          </p>
        )}
      </div>

      {/* Footer */}
      <div className="relative flex items-center justify-between px-6 py-4 border-t border-white/5 bg-[#121214]">
        <div className="text-[10px] text-slate-500">
          {isSaved && <span className="text-green-400">已保存</span>}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            className="px-6 py-2.5 text-sm font-medium text-white bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 rounded-xl transition-all"
          >
            保存设置
          </button>
        </div>
      </div>
    </>
  );
});
