import React from 'react';
import {
  AlertCircle,
  CheckCircle,
  Clock3,
  Image as ImageIcon,
  Layers,
  Video,
} from 'lucide-react';
import {
  getVideoProviderCatalog,
  type VideoProviderReadiness,
} from '../../services/videoProviders';

interface VideoProvidersTabProps {
  onClose: () => void;
}

const READINESS_META: Record<
  VideoProviderReadiness,
  {
    label: string;
    className: string;
    icon: React.ElementType;
  }
> = {
  ready: {
    label: '已注册',
    className: 'text-emerald-300 border-emerald-500/20 bg-emerald-500/10',
    icon: CheckCircle,
  },
  preview: {
    label: '预览',
    className: 'text-amber-300 border-amber-500/20 bg-amber-500/10',
    icon: Clock3,
  },
  stub: {
    label: '占位',
    className: 'text-slate-300 border-white/10 bg-white/5',
    icon: AlertCircle,
  },
};

export const VideoProvidersTab: React.FC<VideoProvidersTabProps> = React.memo(({ onClose }) => {
  const providers = getVideoProviderCatalog();

  return (
    <>
      <div className="p-6 space-y-5">
        <div className="space-y-1">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Layers size={16} className="text-cyan-400" />
            视频提供商目录
          </h3>
          <p className="text-[11px] text-slate-400">
            展示当前注册到运行时的提供商、能力和接入状态
          </p>
        </div>

        <div className="space-y-3">
          {providers.map((provider) => {
            const readiness = READINESS_META[provider.readiness];
            const ReadinessIcon = readiness.icon;

            return (
              <div
                key={provider.name}
                className="rounded-xl border border-white/10 bg-black/40 p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-white">
                        {provider.displayName}
                      </span>
                      <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-400">
                        {provider.name}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-500">
                      {provider.readiness === 'ready'
                        ? '已注册并可用于路由'
                        : provider.readiness === 'preview'
                          ? '预览接入，适合后续扩展'
                          : '仅保留注册位，尚未接入真实 API'}
                    </p>
                  </div>

                  <div
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${readiness.className}`}
                  >
                    <ReadinessIcon size={12} />
                    <span>{readiness.label}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-300 sm:grid-cols-4">
                  <div className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2">
                    <Video size={12} className="text-cyan-400" />
                    <span>文生视频</span>
                    <span className="ml-auto font-semibold text-white">
                      {provider.supportedFeatures.textToVideo ? '是' : '否'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2">
                    <ImageIcon size={12} className="text-purple-400" />
                    <span>图生视频</span>
                    <span className="ml-auto font-semibold text-white">
                      {provider.supportedFeatures.imageToVideo ? '是' : '否'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2">
                    <Clock3 size={12} className="text-emerald-400" />
                    <span>最长时长</span>
                    <span className="ml-auto font-semibold text-white">
                      {provider.supportedFeatures.maxDuration}s
                    </span>
                  </div>
                  <div className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2">
                    <Layers size={12} className="text-amber-400" />
                    <span>支持比例</span>
                    <span className="ml-auto font-semibold text-white">
                      {provider.supportedFeatures.supportedRatios.join(' / ')}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-4">
          <p className="text-[11px] text-slate-300 leading-relaxed">
            Sora 2 的实际 API Key 仍在「Sora 2」标签页配置；这里的目录只负责展示注册状态和能力信息，
            方便后续把其他视频提供商接进同一套路由。
          </p>
        </div>
      </div>

      <div className="relative flex items-center justify-between border-t border-white/5 bg-[#121214] px-6 py-4">
        <div className="text-[10px] text-slate-500">
          已注册 {providers.length} 个提供商
        </div>
        <button
          onClick={onClose}
          className="rounded-xl px-6 py-2.5 text-sm font-medium text-white bg-gradient-to-r from-cyan-500 to-purple-500 hover:from-cyan-400 hover:to-purple-400 transition-all"
        >
          关闭
        </button>
      </div>
    </>
  );
});

export default VideoProvidersTab;
