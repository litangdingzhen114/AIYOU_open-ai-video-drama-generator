/**
 * AIYOU 漫剧生成平台 - 欢迎屏幕组件
 *
 * @developer 光波 (a@ggbo.com)
 * @copyright Copyright (c) 2025 光波. All rights reserved.
 */

// components/WelcomeScreen.tsx
import React from 'react';
import { useLanguage } from '../src/i18n/LanguageContext';

interface WelcomeScreenProps {
  visible: boolean;
}

/**
 * 欢迎屏幕组件
 * 在画布为空时显示
 */
export const WelcomeScreen: React.FC<WelcomeScreenProps> = React.memo(({ visible }) => {
  const { t } = useLanguage();

  if (!visible) return null;

  return (
    <div
      className={`absolute inset-0 flex flex-col items-center justify-center transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] z-50 pointer-events-none ${
        visible ? 'opacity-100 scale-100' : 'opacity-0 scale-105'
      }`}
    >
      {/* 背景壁纸 */}
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <img
          src="/aiyou-hero-wallpaper.jpg"
          alt=""
          aria-hidden="true"
          className="h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-black/35" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.18),rgba(0,0,0,0.72))]" />
      </div>

      {/* 标题 */}
      <div className="flex flex-col items-center justify-center mb-10 select-none animate-in fade-in slide-in-from-bottom-8 duration-1000">
        <div className="relative mb-8 w-full max-w-5xl px-4">
          <img
            src="/logo.png"
            alt="AIYOU Logo"
            className="h-80 md:h-[500px] xl:h-[600px] w-full object-contain"
          />
        </div>
      </div>
    </div>
  );
});
