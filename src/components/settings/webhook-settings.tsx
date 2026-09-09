import { App, Button, Input, InputNumber, Popconfirm, Radio, Switch, Tooltip } from 'antd';
import { CopyOutlined, ReloadOutlined } from '@ant-design/icons';
import type { WebhookHost } from '@shared/types';
import { useSettingsStore } from '@/stores/settings-store';
import SettingItem from './setting-item';

/** Webhook 触发服务设置（开关、监听地址、端口、鉴权 Token） */
export default function WebhookSettings() {
  const { message } = App.useApp();
  const webhookEnabled = useSettingsStore((s) => s.webhookEnabled);
  const setWebhookEnabled = useSettingsStore((s) => s.setWebhookEnabled);
  const webhookHost = useSettingsStore((s) => s.webhookHost);
  const setWebhookHost = useSettingsStore((s) => s.setWebhookHost);
  const webhookPort = useSettingsStore((s) => s.webhookPort);
  const setWebhookPort = useSettingsStore((s) => s.setWebhookPort);
  const webhookToken = useSettingsStore((s) => s.webhookToken);
  const setWebhookToken = useSettingsStore((s) => s.setWebhookToken);

  /** 复制 Token 到剪贴板 */
  const handleCopyToken = async () => {
    await navigator.clipboard.writeText(webhookToken);
    message.success('Token 已复制');
  };

  /** 调用主进程重新生成 Token（旧 Token 立即失效） */
  const handleRegenerate = async () => {
    const token = await window.ipcRenderer.invoke('webhook:regenerate-token');
    setWebhookToken(token);
    message.success('Token 已重新生成');
  };

  return (
    <>
      <SettingItem
        label='Webhook 触发服务'
        tooltip='启动本地 HTTP 服务，收到携带 Token 的请求时触发对应任务（还需在对应任务的设置中开启 Webhook 触发）'
      >
        <Switch
          checked={webhookEnabled}
          onChange={setWebhookEnabled}
        />
      </SettingItem>
      <SettingItem
        label='监听地址'
        tooltip={<>仅本机：端口不对局域网开放，适合配合 frp / Cloudflare Tunnel 等转发；<br />局域网：允许局域网内设备直连</>}
      >
        <Radio.Group
          value={webhookHost}
          onChange={(e) => setWebhookHost(e.target.value as WebhookHost)}
          optionType='button'
          buttonStyle='solid'
          disabled={!webhookEnabled}
        >
          <Radio.Button value='127.0.0.1'>仅本机</Radio.Button>
          <Radio.Button value='0.0.0.0'>局域网</Radio.Button>
        </Radio.Group>
      </SettingItem>
      <SettingItem label='监听端口'>
        <InputNumber
          className='w-60!'
          min={1}
          max={65535}
          precision={0}
          controls={false}
          value={webhookPort}
          onChange={(v) => v !== null && setWebhookPort(v)}
          disabled={!webhookEnabled}
        />
      </SettingItem>
      <SettingItem
        label='鉴权 Token'
        tooltip='请求通过 Authorization: Bearer <Token> 头携带；重新生成后旧 Token 立即失效'
      >
        <div className='flex w-full gap-1'>
          <Input.Password
            className='flex-1'
            value={webhookToken}
            readOnly
            visibilityToggle
            disabled={!webhookEnabled}
          />
          <Tooltip title='复制'>
            <Button
              icon={<CopyOutlined />}
              disabled={!webhookEnabled}
              onClick={handleCopyToken}
            />
          </Tooltip>
          <Popconfirm
            title='重新生成 Token'
            description='旧 Token 将立即失效，正在使用它的调用方需要更新'
            okText='重新生成'
            cancelText='取消'
            onConfirm={handleRegenerate}
          >
            <Button
              icon={<ReloadOutlined />}
              disabled={!webhookEnabled}
            />
          </Popconfirm>
        </div>
      </SettingItem>
    </>
  );
}
