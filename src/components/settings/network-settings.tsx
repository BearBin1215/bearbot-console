import { Input, InputNumber, Select } from 'antd';
import { useSettingsStore } from '@/stores/settings-store';
import type { MoegirlDomain } from '@shared/types';
import SettingItem from './setting-item';

/** 萌娘百科网络请求相关设置（域名、UA、重试） */
export default function NetworkSettings() {
  const moegirlDomain = useSettingsStore((s) => s.moegirlDomain);
  const setMoegirlDomain = useSettingsStore((s) => s.setMoegirlDomain);
  const userAgent = useSettingsStore((s) => s.userAgent);
  const setUserAgent = useSettingsStore((s) => s.setUserAgent);
  const retryCount = useSettingsStore((s) => s.retryCount);
  const setRetryCount = useSettingsStore((s) => s.setRetryCount);
  const retryInterval = useSettingsStore((s) => s.retryInterval);
  const setRetryInterval = useSettingsStore((s) => s.setRetryInterval);
  const requestTimeout = useSettingsStore((s) => s.requestTimeout);
  const setRequestTimeout = useSettingsStore((s) => s.setRequestTimeout);
  const minRequestInterval = useSettingsStore((s) => s.minRequestInterval);
  const setMinRequestInterval = useSettingsStore((s) => s.setMinRequestInterval);

  return (
    <>
      <SettingItem label='萌娘百科 API 请求域名'>
        <Select
          className='w-60!'
          value={moegirlDomain}
          onChange={(v) => setMoegirlDomain(v as MoegirlDomain)}
          options={[
            { value: 'zh.moegirl.org.cn', label: 'zh.moegirl.org.cn' },
            { value: 'mzh.moegirl.org.cn', label: 'mzh.moegirl.org.cn' },
          ]}
        />
      </SettingItem>
      <SettingItem label='萌娘百科 API 请求 UA'>
        <Input
          className='w-60!'
          value={userAgent}
          onChange={(e) => setUserAgent(e.target.value)}
        />
      </SettingItem>
      <SettingItem label='请求失败重试次数'>
        <div className='flex gap-1'>
          <InputNumber
            className='w-22!'
            min={0}
            max={10}
            precision={0}
            controls={false}
            value={retryCount}
            onChange={(v) => v !== null && setRetryCount(v)}
            suffix='次'
          />
          <InputNumber
            className='w-37!'
            min={100}
            max={30000}
            precision={0}
            controls={false}
            value={retryInterval}
            onChange={(v) => v !== null && setRetryInterval(v)}
            prefix='间隔'
            suffix='ms'
          />
        </div>
      </SettingItem>
      <SettingItem label='请求超时时间'>
        <InputNumber
          className='w-60!'
          min={1000}
          max={120000}
          precision={0}
          controls={false}
          value={requestTimeout}
          onChange={(v) => v !== null && setRequestTimeout(v)}
          suffix='ms'
        />
      </SettingItem>
      <SettingItem
        label='全局请求间隔'
        tooltip='所有萌百 API 请求共享的最小发起间隔。0 表示不限速'
      >
        <InputNumber
          className='w-60!'
          min={0}
          max={10000}
          precision={0}
          controls={false}
          value={minRequestInterval}
          onChange={(v) => v !== null && setMinRequestInterval(v)}
          suffix='ms'
        />
      </SettingItem>
    </>
  );
}
