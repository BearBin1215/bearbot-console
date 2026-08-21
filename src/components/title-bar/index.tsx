import { CaretDownOutlined, LoadingOutlined, UserOutlined } from '@ant-design/icons';
import { Avatar, Button, Popover, Tag } from 'antd';
import { useState } from 'react';
import { useAccountStore } from '@/stores/account-store';
import { avatarUrl, displayLabel } from '@/lib/account';
import logo from '@/assets/logo.svg';
import LoginDialog from './login-dialog';
import MoegirlLink from '../moegirl-link';
import AccountManager from './account-manager';

/** 自定义标题栏，提供窗口拖拽区域与账号管理入口 */
export default function TitleBar() {
  const [loginOpen, setLoginOpen] = useState(false);
  const defaultAccount = useAccountStore((s) => s.accounts[0]);
  const loaded = useAccountStore((s) => s.loaded);

  /** 右侧账号区域：加载中显示转圈，已加载按登录状态显示用户或未登录入口 */
  let accountArea: React.ReactNode;
  if (!loaded) {
    accountArea = <Avatar size={22} icon={<LoadingOutlined />} />;
  } else if (defaultAccount) {
    accountArea = (
      <>
        <MoegirlLink title={`User:${defaultAccount.username}`} className='flex cursor-pointer items-center gap-1'>
          <Avatar
            size={22}
            src={avatarUrl(defaultAccount.userId)}
            icon={<UserOutlined />}
          />
          <Tag color='purple' className='m-0 max-w-24 truncate'>{displayLabel(defaultAccount)}</Tag>
        </MoegirlLink>
        <Popover
          arrow={false}
          content={<AccountManager onAdd={() => setLoginOpen(true)} />}
          trigger='click'
          placement='bottomRight'
        >
          <Button
            type='link'
            size='small'
            icon={<CaretDownOutlined />}
          />
        </Popover>
      </>
    );
  } else {
    accountArea = (
      <div
        className='flex cursor-pointer items-center gap-1'
        onClick={() => setLoginOpen(true)}
      >
        <Avatar size={22} icon={<UserOutlined />} />
        <span className='text-xs text-gray-400 hover:text-gray-600'>未登录</span>
      </div>
    );
  }

  return (
    <div
      className='flex h-9 shrink-0 items-center justify-between bg-white/40 select-none'
      style={{
        // 左侧避让系统控件（macOS 交通灯），无控件时至少保留 12px 基础内边距
        paddingLeft: 'max(env(titlebar-area-x, 0px), 12px)',
        // 右侧避让系统控件（Windows/Linux 标题栏按钮），无控件时回退 0
        paddingRight: 'calc(100% - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100%))',
        // 支持拖拽移动窗口
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}
    >
      <div className='flex items-center gap-1'>
        <img
          src={logo}
          alt=''
          draggable={false}
          className='h-4 w-4 select-none'
        />
        <span className='text-xs select-none'>{__APP_NAME__}</span>
      </div>
      <div
        className='flex items-center gap-2'
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {accountArea}
      </div>
      <LoginDialog open={loginOpen} onClose={() => setLoginOpen(false)} />
    </div>
  );
}
