import { Button, Radio, Switch } from 'antd';
import { FolderOpenOutlined } from '@ant-design/icons';
import { useSettingsStore } from '@/stores/settings-store';
import type { CloseBehavior } from '@shared/types';
import SettingItem from './setting-item';

/** 应用行为相关设置（窗口关闭、执行通知、缓存目录） */
export default function AppSettings() {
  const closeBehavior = useSettingsStore((s) => s.closeBehavior);
  const setCloseBehavior = useSettingsStore((s) => s.setCloseBehavior);
  const notifyOnTaskComplete = useSettingsStore((s) => s.notifyOnTaskComplete);
  const setNotifyOnTaskComplete = useSettingsStore((s) => s.setNotifyOnTaskComplete);

  return (
    <>
      <SettingItem label='关闭窗口时'>
        <Radio.Group
          value={closeBehavior}
          onChange={(e) => setCloseBehavior(e.target.value as CloseBehavior)}
          optionType='button'
          buttonStyle='solid'
        >
          <Radio.Button value='minimize'>最小化</Radio.Button>
          <Radio.Button value='exit'>退出</Radio.Button>
        </Radio.Group>
      </SettingItem>
      <SettingItem label='任务执行结果通知'>
        <Switch
          checked={notifyOnTaskComplete}
          onChange={(v) => setNotifyOnTaskComplete(v)}
        />
      </SettingItem>
      <SettingItem label='本地缓存目录'>
        <Button
          icon={<FolderOpenOutlined />}
          onClick={() => window.ipcRenderer.invoke('settings:open-dir')}
        >
          打开
        </Button>
      </SettingItem>
    </>
  );
}
