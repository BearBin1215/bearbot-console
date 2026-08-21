import { useState, useEffect } from 'react';
import { Divider, Form, Input, InputNumber, Modal, Select, Typography } from 'antd';
import { Cron } from 'react-js-cron';
import { formatCron } from '@/lib/cron';
import { displayLabel } from '@/lib/account';
import type { Account, TaskParamField, TaskParamValues } from '@shared/types';
import 'react-js-cron/styles.css';

/** react-js-cron 中文 locale */
const ZH_CN_LOCALE = {
  everyText: '每',
  emptyMonths: '所有月份',
  emptyMonthDays: '所有日期',
  emptyMonthDaysShort: '所有',
  emptyWeekDays: '所有星期',
  emptyWeekDaysShort: '所有',
  emptyHours: '所有小时',
  emptyMinutes: '所有分钟',
  emptyMinutesForHourPeriod: '每小时的第 0 分钟',
  yearOption: '年',
  monthOption: '月',
  weekOption: '周',
  dayOption: '天',
  hourOption: '小时',
  minuteOption: '分钟',
  rebootOption: '重启',
  prefixPeriod: '每',
  prefixMonths: '的',
  prefixMonthDays: '的',
  prefixWeekDays: '星期',
  prefixWeekDaysForMonthAndYearPeriod: '或',
  prefixHours: '的',
  prefixMinutes: ':',
  prefixMinutesForHourPeriod: '的第',
  suffixMinutesForHourPeriod: '分钟',
  errorInvalidCron: '无效的 cron 表达式',
  clearButtonText: '清空',
  weekDays: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
  months: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
  altWeekDays: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
  altMonths: ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'],
};

interface TaskSettingsProps {
  /** 弹窗是否打开 */
  open: boolean;
  /** 任务编码（只读） */
  taskKey: string;
  /** 当前名称 */
  name: string;
  /** 当前描述 */
  description?: string;
  /** 当前 cron 值 */
  cron: string;
  /** 绑定的执行账号 id（未设置时为默认账号） */
  accountId?: string;
  /** 可选账号列表 */
  accounts: Account[];
  /** 默认名称（用于 placeholder） */
  defaultName: string;
  /** 默认描述（用于 placeholder） */
  defaultDescription?: string;
  /** 任务参数字段定义（来自注册表，用于动态生成输入框，可选） */
  paramFields?: TaskParamField[];
  /** 用户已保存的参数值（用于回填，可选） */
  paramValues?: TaskParamValues;
  /** 保存回调 */
  onSave: (data: {
    name: string;
    description: string;
    cron: string;
    accountId?: string;
    params?: TaskParamValues;
  }) => void;
  /** 关闭回调 */
  onClose: () => void;
}

/**
 * 根据 TaskParamField 类型构造对应的表单控件
 *
 * - `string` - 单行输入框
 * - `text` - 多行文本框
 * - `number` - 数字输入框
 * - `multi-string` - 多值输入框（Select tags 模式）
 * - `select` - 下拉单选框
 * - `multi-select` - 下拉多选框
 */
function renderParamControl(field: TaskParamField) {
  const common = {
    placeholder: field.placeholder,
  };
  switch (field.type) {
    case 'number':
      return <InputNumber className='w-full!' {...common} />;
    case 'text':
      return <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} {...common} />;
    case 'multi-string':
      return (
        <Select
          mode='tags'
          tokenSeparators={[',', '\n']}
          {...common}
        />
      );
    case 'multi-select':
      return (
        <Select
          mode='multiple'
          options={field.options}
          allowClear
          {...common}
        />
      );
    case 'select':
      return (
        <Select
          options={field.options}
          allowClear
          {...common}
        />
      );
    case 'string':
    default:
      return <Input {...common} />;
  }
}

/** 任务设置弹窗，编辑基本信息、执行时间、任务参数 */
export default function TaskSettings({
  open,
  taskKey,
  name,
  description,
  cron,
  accountId,
  accounts,
  defaultName,
  defaultDescription,
  paramFields,
  paramValues,
  onSave,
  onClose,
}: TaskSettingsProps) {
  const [form] = Form.useForm();
  const [tempCron, setTempCron] = useState(cron);
  const hasParams = !!paramFields && paramFields.length > 0;

  // 打开弹窗时同步当前值
  useEffect(() => {
    if (open) {
      // 先重置表单：任务参数为嵌套对象，setFieldsValue 会合并而非替换，
      // 不先 reset 会导致未保存的参数编辑在重新打开时残留（表现为输入即生效）
      form.resetFields();
      form.setFieldsValue({ name, description, account: accountId });
      // 回填任务参数（未填项留空，让 placeholder/默认值生效）
      if (hasParams) {
        const paramObj: Record<string, number | string | string[]> = {};
        for (const field of paramFields!) {
          const v = paramValues?.[field.key];
          if (v !== undefined) {
            paramObj[field.key] = v;
          }
        }
        form.setFieldsValue({ params: paramObj });
      }
      setTempCron(cron);
    }
  }, [open, name, description, cron, accountId, accounts, form, hasParams, paramFields, paramValues]);

  const handleSave = async () => {
    const values = await form.validateFields();
    // 仅收集注册表声明字段的参数值，空值剔除以让 runner 回退默认值
    let params: TaskParamValues | undefined;
    if (hasParams) {
      const formParams = (values.params ?? {}) as TaskParamValues;
      const collected: TaskParamValues = {};
      for (const field of paramFields!) {
        const v = formParams[field.key];
        if (v !== undefined && v !== '' && v !== null && !(Array.isArray(v) && v.length === 0)) {
          collected[field.key] = v;
        }
      }
      params = collected;
    }
    onSave({
      name: values.name?.trim() ?? '',
      description: values.description?.trim() ?? '',
      cron: tempCron,
      accountId: values.account || undefined,
      params,
    });
  };

  return (
    <Modal
      title='任务设置'
      open={open}
      onOk={handleSave}
      onCancel={onClose}
      okText='保存'
      cancelText='取消'
      width={720}
    >
      <Form
        form={form}
        layout='horizontal'
        colon={false}
        labelCol={{ span: 5 }}
        wrapperCol={{ span: 19 }}
        initialValues={{ name, description }}
      >
        <Form.Item
          label='编码'
          className='mb-2!'
        >
          <Typography.Text code>{taskKey}</Typography.Text>
        </Form.Item>

        <Form.Item
          label='名称'
          name='name'
          className='mb-2!'
        >
          <Input placeholder={defaultName} />
        </Form.Item>

        <Form.Item
          label='描述'
          name='description'
          className='mb-2!'
        >
          <Input placeholder={defaultDescription ?? '无'} />
        </Form.Item>

        <Form.Item
          label='账号'
          name='account'
          className='mb-2!'
          tooltip='执行该任务的账号，留空使用默认账号（列表首个）'
        >
          <Select
            allowClear
            placeholder='默认账号'
            options={accounts.map((a) => ({
              label: displayLabel(a),
              value: a.id,
            }))}
          />
        </Form.Item>

        {hasParams && (
          <>
            <Divider plain>任务参数</Divider>
            {paramFields!.map((field) => (
              <Form.Item
                key={field.key}
                label={field.label}
                name={['params', field.key]}
                className='mb-2!'
                tooltip={field.help}
                rules={field.required ? [{ required: true, message: `请输入${field.label}` }] : undefined}
              >
                {renderParamControl(field)}
              </Form.Item>
            ))}
          </>
        )}
      </Form>

      <Divider plain>执行时间</Divider>

      <div className='mb-2 text-sm'>
        <span className='text-gray-500'>预览：</span>
        <span className='font-medium text-gray-700'>
          {formatCron(tempCron)}
          {tempCron && (
            <>（{tempCron}）</>
          )}
        </span>
      </div>
      <Cron
        value={tempCron}
        setValue={setTempCron}
        locale={ZH_CN_LOCALE}
        allowedPeriods={['year', 'month', 'week', 'day', 'hour', 'minute']}
        clockFormat='24-hour-clock'
      />
    </Modal>
  );
}
