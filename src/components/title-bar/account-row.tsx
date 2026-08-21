import {
  LogoutOutlined,
  StarFilled,
  StarOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Avatar, Button, Tag, Tooltip } from 'antd';
import type { Account } from '@shared/types';
import { avatarUrl, displayLabel } from '@/lib/account';
import { groupMeta } from '@/lib/moegirl-dict';
import MoegirlLink from '../moegirl-link';

interface AccountRowProps {
  /** 账号信息 */
  account: Account;
  /** 是否为默认账号（控制星标图标与高亮颜色） */
  isDefault: boolean;
  /** 设为默认账号 */
  onSetDefault: (id: string) => void;
  /** 删除账号 */
  onRemove: (id: string) => void;
}

/** 账号管理下拉列表中的单行：头像 + 用户名 + 用户组徽章 + 登录态 + 操作按钮 */
export default function AccountRow({ account, isDefault, onSetDefault, onRemove }: AccountRowProps) {
  const badges = account.groups.filter((g) => groupMeta[g]?.badge);

  return (
    <div className='flex items-center gap-2'>
      <Avatar
        size={20}
        src={avatarUrl(account.userId)}
        icon={<UserOutlined />}
      />
      <MoegirlLink title={`User:${account.username}`}>
        <span className='truncate text-sm'>{displayLabel(account)}</span>
      </MoegirlLink>
      {badges.length > 0 && (
        <div className='flex gap-0.5'>
          {badges.map((g) => (
            <Tooltip key={g} title={groupMeta[g].label}>
              <Tag
                color='blue'
                className='m-0 px-1!'
              >
                {groupMeta[g].badge}
              </Tag>
            </Tooltip>
          ))}
        </div>
      )}
      <div className='ml-auto flex'>
        <Tooltip title={isDefault ? '默认账号' : '设为默认账号'}>
          <Button
            type='link'
            size='small'
            icon={isDefault ? <StarFilled className='text-amber-500!' /> : <StarOutlined />}
            onClick={() => {
              if (!isDefault) {
                onSetDefault(account.id);
              }
            }}
          />
        </Tooltip>
        <Tooltip title='删除账号'>
          <Button
            type='link'
            size='small'
            icon={<LogoutOutlined />}
            onClick={() => onRemove(account.id)}
          />
        </Tooltip>
      </div>
    </div>
  );
}
