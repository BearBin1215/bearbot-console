import { CaretDownOutlined, LoadingOutlined, UserOutlined } from '@ant-design/icons';
import { Avatar, Button, Popover, Tag } from 'antd';
import { useEffect, useState } from 'react';
import { useAccountStore } from '@/stores/account-store';
import { avatarUrl, displayLabel } from '@/lib/account';
import logo from '@/assets/logo.svg';
import LoginDialog from './login-dialog';
import MoegirlLink from '../moegirl-link';
import AccountManager from './account-manager';

/** Win10 激活窗口的系统边框近似色（半透明黑，可在自定义背景上获得与系统色化边框一致的叠加效果） */
const WIN10_BORDER_ACTIVE = 'rgba(0, 0, 0, 0.3)';
/** Win10 非激活窗口的系统边框近似色（系统非激活边框明显更浅） */
const WIN10_BORDER_INACTIVE = 'rgba(0, 0, 0, 0.06)';

/** Win10 检测结果缓存，避免重复异步探测 */
let win10Detection: Promise<boolean> | undefined;

/**
 * 检测当前系统是否为 Windows 10
 *
 * UA-CH 的 platformVersion 主版本在 Win11 起为 13+，Win10 为 0~10。
 */
function detectWindows10(): Promise<boolean> {
  win10Detection ??= (async () => {
    const uaData = navigator.userAgentData;
    if (uaData) {
      const hints = await uaData.getHighEntropyValues(['platform', 'platformVersion']);
      return hints.platform === 'Windows' && Number(hints.platformVersion.split('.')[0]) < 13;
    }
    // 回退：UA 字符串本身无法区分 Win10/Win11（均为 Windows NT 10.0），仅能确认是 Windows
    return /Windows NT 10/.test(navigator.userAgent);
  })();
  return win10Detection;
}

/** 自定义标题栏，提供窗口拖拽区域与账号管理入口 */
export default function TitleBar() {
  const [loginOpen, setLoginOpen] = useState(false);
  const defaultAccount = useAccountStore((s) => s.accounts[0]);
  const loaded = useAccountStore((s) => s.loaded);
  /** Win10 下用于补齐顶部边框的颜色；非 Win10、窗口最大化或未检测完成时为 undefined（不绘制） */
  const [topBorderColor, setTopBorderColor] = useState<string>();

  useEffect(() => {
    if (__WEB_DEMO__) {
      return;
    }
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    detectWindows10().then((isWin10) => {
      if (cancelled || !isWin10) { return; }
      const refresh = () => {
        // 最大化时系统边框随窗口外扩移出屏幕外，无需再模拟顶部边框
        const maximized = window.innerWidth >= screen.availWidth && window.innerHeight >= screen.availHeight;
        if (maximized) {
          setTopBorderColor(undefined);
        } else {
          setTopBorderColor(document.hasFocus() ? WIN10_BORDER_ACTIVE : WIN10_BORDER_INACTIVE);
        }
      };
      refresh();
      window.addEventListener('focus', refresh);
      window.addEventListener('blur', refresh);
      window.addEventListener('resize', refresh);
      cleanup = () => {
        window.removeEventListener('focus', refresh);
        window.removeEventListener('blur', refresh);
        window.removeEventListener('resize', refresh);
      };
    }).catch(() => {
      if (!cancelled) {
        setTopBorderColor(undefined);
      }
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

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
        // Win10 隐藏标题栏后系统仅绘制左、右、下三侧边框，顶部用 1px 线补齐以统一观感
        borderTop: topBorderColor ? `1px solid ${topBorderColor}` : undefined,
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
