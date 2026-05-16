import React, { useEffect, useState, useCallback } from 'react';
import { AlertCircle, CheckCircle, Eye, EyeOff, RefreshCw, Wand2 } from 'lucide-react';
import { validateOpenAIKey } from '../../services/openaiImageService';

interface GptImageTabProps {
  onClose: () => void;
}

export const GptImageTab: React.FC<GptImageTabProps> = React.memo(({ onClose }) => {
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [validationStatus, setValidationStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSaved, setIsSaved] = useState(false);

  useEffect(() => {
    const savedKey = localStorage.getItem('OPENAI_API_KEY');
    if (savedKey) {
      setApiKey(savedKey);
      setValidationStatus('success');
    }
  }, []);

  const handleSave = useCallback(async () => {
    const trimmedKey = apiKey.trim();
    if (!trimmedKey) {
      setValidationStatus('error');
      setErrorMessage('请输入 OpenAI API Key');
      return;
    }

    setIsValidating(true);
    setValidationStatus('idle');

    try {
      const isValid = await validateOpenAIKey(trimmedKey);
      if (!isValid) {
        setValidationStatus('error');
        setErrorMessage('API Key 验证失败，请检查是否正确');
        return;
      }

      localStorage.setItem('OPENAI_API_KEY', trimmedKey);
      window.dispatchEvent(new CustomEvent('apiKeyUpdated'));
      setValidationStatus('success');
      setErrorMessage('');
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);
      setTimeout(onClose, 500);
    } catch (error) {
      setValidationStatus('error');
      setErrorMessage(error instanceof Error ? error.message : '保存失败');
    } finally {
      setIsValidating(false);
    }
  }, [apiKey, onClose]);

  const handleClear = useCallback(() => {
    setApiKey('');
    setValidationStatus('idle');
    setErrorMessage('');
    localStorage.removeItem('OPENAI_API_KEY');
    window.dispatchEvent(new CustomEvent('apiKeyUpdated'));
  }, []);

  return (
    <>
      <div className="p-6 space-y-6">
        <div className="space-y-1">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Wand2 size={16} className="text-fuchsia-400" />
            GPT 生图
          </h3>
          <p className="text-[11px] text-slate-400">
            这里单独配置 OpenAI API Key，用于 GPT Image 2 模块
          </p>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="text-sm font-medium text-slate-300">OpenAI API Key</span>
            <span className="text-red-500 ml-1">*</span>
          </label>
          <div className="relative">
            <input
              type={showApiKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setValidationStatus('idle');
                setErrorMessage('');
              }}
              placeholder="sk-..."
              className="w-full px-4 py-3 pr-12 bg-white/5 border border-white/10 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-fuchsia-500/50 focus:bg-white/10 transition-all font-mono text-sm"
            />
            <button
              onClick={() => setShowApiKey(!showApiKey)}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-white transition-colors"
              type="button"
            >
              {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <div className="text-xs text-slate-400 space-y-1">
            <p>• 用于 GPT Image 2 的独立图像生成通道</p>
            <p>• OpenAI Key 仅保存在浏览器本地</p>
          </div>
        </div>

        {validationStatus === 'success' && (
          <div className="flex items-center gap-2 text-emerald-400 text-sm">
            <CheckCircle size={16} />
            <span>API Key 已验证</span>
          </div>
        )}

        {validationStatus === 'error' && (
          <div className="flex items-center gap-2 text-red-400 text-sm">
            <AlertCircle size={16} />
            <span>{errorMessage}</span>
          </div>
        )}
      </div>

      <div className="relative flex items-center justify-between px-6 py-4 border-t border-white/5 bg-[#121214]">
        <button
          onClick={handleClear}
          className="px-4 py-2 text-sm text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-all"
          disabled={!apiKey}
        >
          清除
        </button>

        <div className="flex items-center gap-3">
          {isSaved && <span className="text-[10px] text-green-400">已保存</span>}
          <button
            onClick={onClose}
            className="px-6 py-2.5 text-sm font-medium text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition-all"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={isValidating || !apiKey.trim()}
            className="px-6 py-2.5 text-sm font-medium text-black bg-fuchsia-400 hover:bg-fuchsia-300 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isValidating ? (
              <>
                <RefreshCw size={14} className="animate-spin" />
                验证中...
              </>
            ) : (
              '保存'
            )}
          </button>
        </div>
      </div>
    </>
  );
});

export default GptImageTab;
