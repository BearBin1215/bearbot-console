import { PlusOutlined } from '@ant-design/icons';
import { Button } from 'antd';
import { useAccountStore } from '@/stores/account-store';
import AccountRow from './account-row';

interface AccountManagerProps {
  /** 点击"添加账号"时触发（由父组件打开登录弹窗）；网页演示模式无添加入口 */
  onAdd?: () => void;
}

/** 账号管理下拉内容：列出全部账号（可设为默认/删除）+ 添加账号入口（桌面版） */
export default function AccountManager({ onAdd }: AccountManagerProps) {
  const accounts = useAccountStore((s) => s.accounts);
  const setDefaultAccount = useAccountStore((s) => s.setDefaultAccount);
  const removeAccount = useAccountStore((s) => s.removeAccount);
  const defaultId = accounts[0]?.id;

  return (
    <div className='flex w-64 flex-col gap-1'>
      {accounts.map((a) => (
        <AccountRow
          key={a.id}
          account={a}
          isDefault={a.id === defaultId}
          onSetDefault={setDefaultAccount}
          onRemove={removeAccount}
        />
      ))}
      {!__WEB_DEMO__ && onAdd && (
        <Button
          size='small'
          icon={<PlusOutlined />}
          onClick={onAdd}
        >
          添加账号
        </Button>
      )}
    </div>
  );
}
