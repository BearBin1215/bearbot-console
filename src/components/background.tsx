import { useEffect, useRef, useState } from 'react';
import { useSettingsStore } from '@/stores/settings-store';
import { useOpacityDraftStore } from '@/stores/opacity-draft-store';

/**
 * 将背景图配置值转换为可渲染的图片地址
 *
 * 以 /、data: 或 http(s) 开头的地址（网页演示模式下的打包资源 URL）直接使用，
 * 其余视为本地文件路径，走 Electron 自定义协议读取
 */
function toImageUrl(currentImage: string): string {
  if (/^(data:|https?:|\/)/.test(currentImage)) {
    return currentImage;
  }
  return `local-file://localhost/?path=${encodeURIComponent(currentImage.replace(/\\/g, '/'))}`;
}

/** 图层 */
interface BgLayer {
  id: number;
  /** 图片地址 */
  url: string;
  /** true = 正在淡出（opacity→0），过渡后会被移除 */
  fading: boolean;
}

/**
 * 背景图层 + 半透明遮罩
 *
 * 有背景图片时渲染轮播图层，并在其上覆盖一层半透明白色遮罩使文字更易阅读。
 * 拖拽透明度滑块时通过 opacityDraft store 实时预览，松手后回退到持久化值。
 *
 * opacityDraft 的高频更新仅影响此组件自身，不会向上冒泡导致 Layout 及其子树重渲染。
 */
export default function Background() {
  const backgroundImages = useSettingsStore((s) => s.backgroundImages);
  const backgroundInterval = useSettingsStore((s) => s.backgroundInterval);
  const backgroundMode = useSettingsStore((s) => s.backgroundMode);
  const backgroundFadeDuration = useSettingsStore((s) => s.backgroundFadeDuration);
  const persistedOpacity = useSettingsStore((s) => s.backgroundOpacity);
  const opacityDraft = useOpacityDraftStore((s) => s.draft);
  const backgroundOpacity = opacityDraft ?? persistedOpacity;

  // 当前显示图片在所有图片中的索引
  const [currentIndex, setCurrentIndex] = useState(0);

  // 轮播逻辑：周期 = 显示时长 + 过渡时长，确保淡出完成后再切下一张
  useEffect(() => {
    if (backgroundImages.length <= 1) {
      return;
    }
    const timer = setInterval(() => {
      setCurrentIndex((prev) => {
        if (backgroundMode === 'random') {
          let next = prev;
          while (next === prev) {
            next = Math.floor(Math.random() * backgroundImages.length);
          }
          return next;
        }
        return (prev + 1) % backgroundImages.length;
      });
    }, backgroundInterval + backgroundFadeDuration);
    return () => clearInterval(timer);
  }, [backgroundImages.length, backgroundInterval, backgroundMode, backgroundFadeDuration]);

  // 图片变化时重置索引
  useEffect(() => {
    if (backgroundImages.length > 0 && currentIndex >= backgroundImages.length) {
      setCurrentIndex(0);
    }
  }, [backgroundImages.length, currentIndex]);

  const currentImage = backgroundImages.length > 0
    ? (backgroundImages[currentIndex] ?? '')
    : '';
  const imageUrl = currentImage ? toImageUrl(currentImage) : '';

  // 交叉淡入淡出
  const [layers, setLayers] = useState<BgLayer[]>([]);
  const currentUrlRef = useRef('');
  const idRef = useRef(0);

  useEffect(() => {
    // 无图：清空
    if (!imageUrl) {
      if (currentUrlRef.current) {
        currentUrlRef.current = '';
        setLayers([]);
      }
      return;
    }

    // 同图：跳过
    if (imageUrl === currentUrlRef.current) {
      return;
    }

    const isFirstLoad = !currentUrlRef.current;
    currentUrlRef.current = imageUrl;
    const newLayer: BgLayer = { id: idRef.current++, url: imageUrl, fading: false };

    // 首次加载：直接显示，无旧图可淡出
    if (isFirstLoad) {
      setLayers([newLayer]);
      return;
    }

    // 切换：新图放底层，其余标记为淡出
    setLayers((prev) => [newLayer, ...prev.map((l) => ({ ...l, fading: true }))]);

    // 过渡结束，删除标记为淡出的旧图
    const timer = setTimeout(() => {
      setLayers((prev) => prev.filter((l) => !l.fading));
    }, backgroundFadeDuration);

    return () => clearTimeout(timer);
  }, [imageUrl]);

  if (layers.length === 0) {
    return null;
  }

  return (
    <div className='pointer-events-none absolute inset-0 z-0 overflow-hidden'>
      {layers.map((layer) => (
        <div
          key={layer.id}
          className='absolute inset-0 bg-cover bg-center bg-no-repeat'
          style={{
            backgroundImage: `url("${layer.url.replace(/"/g, '\\"')}")`,
            opacity: layer.fading ? 0 : 1,
            transition: `opacity ${backgroundFadeDuration}ms ease-in-out`,
          }}
        />
      ))}
      <div
        className='absolute inset-0'
        style={{ backgroundColor: `rgba(255, 255, 255, ${backgroundOpacity / 100})` }}
      />
    </div>
  );
}
