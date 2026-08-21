import { useMemo, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { App, Button, Switch, Tag, Tooltip } from 'antd';
import { HolderOutlined, PlayCircleOutlined, PoweroffOutlined, SettingOutlined } from '@ant-design/icons';
import type { TaskRunRecord } from '@shared/types';
import type { TaskInfo } from '@/lib/types';
import { formatCron, isCronValid, isHighFrequencyCron } from '@/lib/cron';
import { getRunStatus } from '@/lib/task';
import { getMissingRequiredParams } from '@/lib/task';
import { useTaskStore } from '@/stores/task-store';
import { useAccountStore } from '@/stores/account-store';
import { useTaskRunStore } from '@/stores/task-run-store';
import TaskSettings from './task-settings';
import dayjs from 'dayjs';

/** 将毫秒时长格式化为中文时长 */
function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}时${minutes}分${seconds}秒`;
  }
  if (minutes > 0) {
    return `${minutes}分${seconds}秒`;
  }
  return `${seconds}秒`;
}

/** 任务卡片组件 */
export default function TaskItem({ task }: { task: TaskInfo }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const canEnable = isCronValid(task.cron);
  const { modal, message } = App.useApp();

  const running = useTaskStore((s) => s.runningKeys.has(task.taskKey));
  const toggleTask = useTaskStore((s) => s.toggleTask);
  const updateTaskCron = useTaskStore((s) => s.updateTaskCron);
  const updateTaskOverrides = useTaskStore((s) => s.updateTaskOverrides);
  const updateTaskAccount = useTaskStore((s) => s.updateTaskAccount);
  const updateTaskParams = useTaskStore((s) => s.updateTaskParams);
  const accounts = useAccountStore((s) => s.accounts);
  const records = useTaskRunStore((s) => s.records);

  /** 判断任务绑定账号是否已登录（未绑定则回退默认账号） */
  const loggedIn = accounts.some((a) => a.id === (task.accountId ?? accounts[0]?.id) && a.loggedIn);

  /** 最近一次执行记录（按 endTime 取最大），无记录时为 null */
  const lastRun = useMemo(() => {
    let last: TaskRunRecord | null = null;
    for (const r of records) {
      if (r.taskKey === task.taskKey && (!last || r.endTime > last.endTime)) {
        last = r;
      }
    }
    return last;
  }, [records, task.taskKey]);

  /**
   * 启用任务前检查必填参数与执行频率：
   * - 必填参数缺失时提醒并阻止（快于每 10 分钟一次时弹窗确认，避免高频执行对服务器造成压力）；
   * - 停用任务直接执行，无需确认。
   */
  const handleToggle = (enabled: boolean) => {
    if (enabled) {
      const missing = getMissingRequiredParams(task.params, task.paramValues);
      if (missing.length > 0) {
        message.warning(`任务缺少必填参数：${missing.join('、')}，请先在设置中填写`);
        return;
      }
    }
    if (enabled && isHighFrequencyCron(task.cron)) {
      modal.confirm({
        title: '执行频率较高',
        content: `任务执行频率快于每 10 分钟一次（${formatCron(task.cron)}），确认启用？`,
        okText: '确认',
        cancelText: '取消',
        okButtonProps: { danger: true },
        onOk: () => toggleTask(task.taskKey, true),
      });
      return;
    }
    toggleTask(task.taskKey, enabled);
  };

  /** 手动执行前检查必填参数，缺失时提醒并阻止 */
  const handleRun = () => {
    const missing = getMissingRequiredParams(task.params, task.paramValues);
    if (missing.length > 0) {
      message.warning(`任务缺少必填参数：${missing.join('、')}，请先在设置中填写`);
      return;
    }
    window.ipcRenderer.invoke('task:run', { taskKey: task.taskKey });
  };

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.taskKey });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className='flex gap-2 rounded border border-ant p-3'
    >
      <div className='flex-1 flex flex-col gap-2'>
        <div className='flex items-center gap-1'>
          <button
            type='button'
            className='cursor-grab text-gray-400 hover:text-gray-600'
            {...attributes}
            {...listeners}
          >
            <HolderOutlined />
          </button>
          <Tooltip title={task.taskKey}>
            <span className='font-medium'>{task.name}</span>
          </Tooltip>
          <Tooltip title={task.cron}>
            <Tag color='blue'>{formatCron(task.cron)}</Tag>
          </Tooltip>
          {lastRun && (
            <Tooltip title={`上次执行于 ${dayjs(lastRun.startTime).format('YYYY-MM-DD HH:mm:ss')}`}>
              <Tag color={getRunStatus(lastRun).color}>
                {getRunStatus(lastRun).label} {formatDuration(lastRun.endTime - lastRun.startTime)}
              </Tag>
            </Tooltip>
          )}
        </div>
        <div className='text-xs text-gray-500'>{task.description}</div>
      </div>

      <div className='flex flex-col items-end justify-between gap-2'>
        <Tooltip title={canEnable ? '' : '未设置有效的执行时间'}>
          <Switch
            size='small'
            checked={task.enabled}
            onChange={handleToggle}
            disabled={!canEnable}
          />
        </Tooltip>
        <div className='flex gap-2'>
          {running ? (
            <Tooltip title='停止执行'>
              <Button
                size='small'
                danger
                icon={<PoweroffOutlined />}
                onClick={() => window.ipcRenderer.invoke('task:stop', task.taskKey)}
              />
            </Tooltip>
          ) : (
            <Tooltip title={!loggedIn ? '未登录' : '手动执行'}>
              <Button
                size='small'
                icon={<PlayCircleOutlined />}
                onClick={handleRun}
                disabled={!loggedIn}
              />
            </Tooltip>
          )}
          <Tooltip title='设置'>
            <Button
              size='small'
              icon={<SettingOutlined />}
              onClick={() => setSettingsOpen(true)}
              disabled={running}
            />
          </Tooltip>
        </div>
      </div>

      <TaskSettings
        open={settingsOpen}
        taskKey={task.taskKey}
        name={task.name}
        description={task.description}
        cron={task.cron}
        accountId={task.accountId}
        accounts={accounts}
        defaultName={task.defaultName}
        defaultDescription={task.defaultDescription}
        paramFields={task.params}
        paramValues={task.paramValues}
        onSave={(data) => {
          updateTaskCron(task.taskKey, data.cron);
          updateTaskOverrides(task.taskKey, { name: data.name, description: data.description });
          updateTaskAccount(task.taskKey, data.accountId);
          if (data.params !== undefined) {
            updateTaskParams(task.taskKey, data.params);
          }
          setSettingsOpen(false);
        }}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
