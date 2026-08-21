import { useEffect, useState } from 'react';
import { Button, Input, Slider } from 'antd';
import { SettingOutlined } from '@ant-design/icons';
import { useSettingsStore } from '@/stores/settings-store';
import { useOpacityDraftStore } from '@/stores/opacity-draft-store';
import SettingItem from './setting-item';
import BackgroundSettings from './background-settings';

/** 界面相关设置（字体、背景） */
export default function InterfaceSettings() {
  const uiFont = useSettingsStore((s) => s.uiFont);
  const setUiFont = useSettingsStore((s) => s.setUiFont);
  const codeFont = useSettingsStore((s) => s.codeFont);
  const setCodeFont = useSettingsStore((s) => s.setCodeFont);

  const backgroundImages = useSettingsStore((s) => s.backgroundImages);
  const backgroundOpacity = useSettingsStore((s) => s.backgroundOpacity);
  const setBackgroundOpacity = useSettingsStore((s) => s.setBackgroundOpacity);
  const opacityDraft = useOpacityDraftStore((s) => s.draft);
  const setOpacityDraft = useOpacityDraftStore((s) => s.setDraft);

  const [uiFontDraft, setUiFontDraft] = useState(uiFont);
  const [codeFontDraft, setCodeFontDraft] = useState(codeFont);
  const [bgSettingsOpen, setBgSettingsOpen] = useState(false);

  // 外部更新时同步 draft 状态
  useEffect(() => { setUiFontDraft(uiFont); }, [uiFont]);
  useEffect(() => { setCodeFontDraft(codeFont); }, [codeFont]);

  return (
    <>
      <SettingItem label='界面字体'>
        <Input
          className='w-60!'
          placeholder='CSS font-family 值'
          value={uiFontDraft}
          onChange={(e) => setUiFontDraft(e.target.value)}
          onBlur={() => setUiFont(uiFontDraft)}
        />
      </SettingItem>
      <SettingItem label='日志字体'>
        <Input
          className='w-60!'
          placeholder='CSS font-family 值'
          value={codeFontDraft}
          onChange={(e) => setCodeFontDraft(e.target.value)}
          onBlur={() => setCodeFont(codeFontDraft)}
        />
      </SettingItem>
      <SettingItem label='背景图片'>
        <div className='flex items-center gap-2'>
          <span className='text-sm text-gray-500'>
            {backgroundImages.length > 0 ? `${backgroundImages.length} 张图片` : '未设置'}
          </span>
          <Button
            icon={<SettingOutlined />}
            onClick={() => setBgSettingsOpen(true)}
          >
            设置
          </Button>
        </div>
      </SettingItem>
      <SettingItem label='背景透明度'>
        <Slider
          min={0}
          max={100}
          value={opacityDraft ?? backgroundOpacity}
          onChange={(v) => setOpacityDraft(v)}
          onChangeComplete={(v) => {
            setBackgroundOpacity(v);
            setOpacityDraft(null);
          }}
          className='w-full'
        />
      </SettingItem>

      <BackgroundSettings open={bgSettingsOpen} onClose={() => setBgSettingsOpen(false)} />
    </>
  );
}
