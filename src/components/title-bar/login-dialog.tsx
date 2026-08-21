import { Modal, Input, Button, Form, App } from 'antd';
import { useAccountStore } from '@/stores/account-store';

interface LoginDialogProps {
  open: boolean;
  onClose: () => void;
}

/** 萌娘百科登录/添加账号弹窗 */
export default function LoginDialog({ open, onClose }: LoginDialogProps) {
  const { message } = App.useApp();
  const addAccount = useAccountStore((s) => s.addAccount);
  const loading = useAccountStore((s) => s.loading);
  const accounts = useAccountStore((s) => s.accounts);
  const hasAccount = accounts.length > 0;
  const [form] = Form.useForm();

  const handleLogin = async () => {
    try {
      const values = await form.validateFields();
      await addAccount(values.username, values.password);
      message.success(hasAccount ? '账号添加成功' : '登录成功');
      onClose();
      form.resetFields();
    } catch (error) {
      if ((error as { errorFields?: unknown }).errorFields) {
        return;
      }
      message.error((error as Error).message || '登录失败');
    }
  };

  return (
    <Modal
      title={hasAccount ? '添加账号' : '登录'}
      open={open}
      onCancel={onClose}
      footer={[
        <Button key='cancel' onClick={onClose}>取消</Button>,
        <Button
          key='login'
          type='primary'
          loading={loading}
          onClick={handleLogin}
        >
          {hasAccount ? '添加账号' : '登录'}
        </Button>,
      ]}
    >
      <Form
        form={form}
        colon={false}
        labelCol={{ span: 4 }}
        wrapperCol={{ span: 20 }}
        onFinish={handleLogin}
      >
        <Form.Item
          className='mb-3!'
          label='用户名'
          name='username'
          validateTrigger={['onBlur']}
          rules={[
            { required: true, message: '请输入用户名' },
            {
              validator: (_, value) =>
                value && accounts.some((a) => a.username === value)
                  ? Promise.reject('该账号已登录')
                  : Promise.resolve(),
            },
          ]}
        >
          <Input />
        </Form.Item>
        <Form.Item
          className='mb-3!'
          label='密码'
          name='password'
          rules={[{ required: true, message: '请输入密码' }]}
        >
          <Input.Password onPressEnter={handleLogin} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
