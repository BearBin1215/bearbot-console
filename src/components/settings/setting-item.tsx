import type { ReactNode } from 'react';
import { Tooltip } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';

interface SettingItemProps {
  /** 设置名称 */
  label: ReactNode;
  /** 帮助提示（可选，提供时在名称后显示问号图标，悬浮图标展示） */
  tooltip?: ReactNode;
  /** 右侧自定义内容 */
  children: ReactNode;
}

/** 设置项目 */
export default function SettingItem({ label, tooltip, children }: SettingItemProps) {
  return (
    <div className='flex items-center'>
      <div className='flex flex-[1_1] items-center gap-1'>
        {label}
        {tooltip && (
          <Tooltip title={tooltip}>
            <QuestionCircleOutlined className='text-gray-400' />
          </Tooltip>
        )}
      </div>
      <div className='flex-[0_0_240px] flex justify-end'>
        {children}
      </div>
    </div>
  );
}
