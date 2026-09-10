import { useEffect, useState } from 'react';
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

  /** 端口输入草稿值：确认提交后才写入设置，避免逐字输入触发多次服务重启与日志刷屏 */
  const [portDraft, setPortDraft] = useState<number | null>(webhookPort);
  // 已保存端口被外部变更时同步草稿显示
  useEffect(() => setPortDraft(webhookPort), [webhookPort]);

  /** 提交端口草稿：合法且变更时写入设置，非法时回显当前已保存端口 */
  const commitPort = () => {
    const port = portDraft !== null && Number.isInteger(portDraft) && portDraft >= 1 && portDraft <= 65535
      ? portDraft
      : null;
    // 经 getState 读取最新值：onPressEnter 与 onBlur 连续触发时避免重复写入
    if (port !== null) {
      if (port !== useSettingsStore.getState().webhookPort) {
        setWebhookPort(port);
      }
      setPortDraft(port);
    } else {
      setPortDraft(useSettingsStore.getState().webhookPort);
    }
  };

  /** 复制 Token 到剪贴板 */
  const handleCopyToken = async () => {
    await navigator.clipboard.writeText(webhookToken);
    message.success('Token 已复制');
  };

  /** 调用主进程重新生成 Token（旧 Token 立即失效） */
  const handleRegenerate = async () => {
    try {
      const token = await window.ipcRenderer.invoke('webhook:regenerate-token');
      setWebhookToken(token);
      message.success('Token 已重新生成');
    } catch {
      message.error('Token 生成失败');
    }
  };

  /**
   * 开启服务时若 Token 为空则先生成再开启
   *
   * Token 必须由渲染进程发起生成并同步本地 state：若仅依赖主进程在服务启动时兜底生成，
   * 渲染进程本地仍为空值，后续任意设置变更触发的全量持久化会把主进程的 Token 覆盖回空。
   * 先写 Token 再写开关，保证携带 enabled: true 的那次持久化必然已带上新 Token。
   */
  const handleEnable = async (v: boolean) => {
    try {
      if (v && !webhookToken) {
        const token = await window.ipcRenderer.invoke('webhook:regenerate-token');
        setWebhookToken(token);
      }
      setWebhookEnabled(v);
    } catch {
      message.error('开启服务失败');
    }
  };

  return (
    <>
      <SettingItem
        label='Webhook 触发服务'
        tooltip='启动本地 HTTP 服务，收到携带 Token 的请求时触发对应任务（还需在对应任务的设置中开启 Webhook 触发）'
      >
        <Switch
          checked={webhookEnabled}
          onChange={handleEnable}
        />
      </SettingItem>
      <SettingItem
        label='监听地址'
        tooltip={<>仅本机：仅回环地址可达（frp 等本机转发工具仍可连接），端口不对局域网开放；<br />局域网：所有网卡可达，局域网设备与本机转发（frp 等）均可连接</>}
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
          value={portDraft}
          onChange={(v) => setPortDraft(v)}
          onPressEnter={commitPort}
          onBlur={commitPort}
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
            description='旧 Token 将立即失效，调用方需要同步更新'
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
