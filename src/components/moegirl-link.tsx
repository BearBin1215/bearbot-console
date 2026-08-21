import { useSettingsStore } from '@/stores/settings-store';

interface MoegirlLinkProps {
  /** 页面标题（必填） */
  title: string;
  /** 显示内容，不传则显示 title */
  children?: React.ReactNode;
  /** 自定义 className */
  className?: string;
}

/** 萌娘百科链接组件 */
export default function MoegirlLink({ title, children, className }: MoegirlLinkProps) {
  const moegirlDomain = useSettingsStore((s) => s.moegirlDomain);
  const base = `https://${moegirlDomain}`;
  const safeTitle = title.replace(/ /g, '_');
  const url = `${base}/${safeTitle}`;

  // 默认字号类与调用方 className 合并而非替换
  const classes = ['text-[length:inherit]!', className].filter(Boolean).join(' ');

  return (
    <a
      href={url}
      target='_blank'
      rel='noopener noreferrer'
      className={classes}
    >
      {children ?? title}
    </a>
  );
}
