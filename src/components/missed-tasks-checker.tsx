import { useEffect, useState } from 'react';
import { App, Checkbox, Modal } from 'antd';
import dayjs from 'dayjs';
import type { MissedTaskInfo } from '@shared/types';
import { useTaskStore } from '@/stores/task-store';
import { useTaskRunStore } from '@/stores/task-run-store';

/**
 * 错过任务提示
 *
 * 任务配置与执行记录加载完成后，向主进程查询应用关闭期间错过的预期执行；
 * 存在时以勾选列表弹窗提示，可一键补跑选中的任务。
 */
export default function MissedTasksChecker() {
  const { message } = App.useApp();
  const tasksLoaded = useTaskStore((s) => s.loaded);
  const runsLoaded = useTaskRunStore((s) => s.loaded);
  /** 需要提示的错过任务；null 表示弹窗关闭 */
  const [missed, setMissed] = useState<MissedTaskInfo[] | null>(null);
  /** 已勾选的任务 key，弹窗打开时默认为全部 */
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);

  useEffect(() => {
    if (!tasksLoaded || !runsLoaded) {
      return;
    }
    let cancelled = false;
    void window.ipcRenderer.invoke('tasks:check-missed').then((list) => {
      if (cancelled || list.length === 0) {
        return;
      }
      setMissed(list);
      setSelectedKeys(list.map((m) => m.taskKey));
    });
    return () => {
      cancelled = true;
    };
  }, [tasksLoaded, runsLoaded]);

  /** 是否已勾选全部任务 */
  const allChecked = missed !== null && selectedKeys.length === missed.length;

  /** 勾选或取消勾选单个任务 */
  const toggleTask = (taskKey: string, checked: boolean) => {
    setSelectedKeys((keys) => (checked ? [...keys, taskKey] : keys.filter((k) => k !== taskKey)));
  };

  /** 关闭弹窗并清空选择状态 */
  const close = () => {
    setMissed(null);
    setSelectedKeys([]);
  };

  /** 补跑勾选的任务：逐个触发主进程执行，运行状态与结果由日志面板展示 */
  const handleRun = () => {
    for (const taskKey of selectedKeys) {
      void window.ipcRenderer.invoke('task:run', { taskKey });
    }
    message.success(`已开始执行 ${selectedKeys.length} 个任务`);
    close();
  };

  return (
    <Modal
      open={missed !== null}
      title='应用关闭期间可能错过的任务'
      width={600}
      okText='运行选中任务'
      cancelText='暂不运行'
      onOk={handleRun}
      onCancel={close}
      okButtonProps={{ disabled: selectedKeys.length === 0 }}
    >
      <div className='flex flex-col gap-2'>
        <Checkbox
          checked={allChecked}
          indeterminate={selectedKeys.length > 0 && !allChecked}
          onChange={(e) => setSelectedKeys(e.target.checked && missed ? missed.map((m) => m.taskKey) : [])}
        >
          全选
        </Checkbox>
        <div className='flex flex-col gap-1 max-h-[50vh] overflow-y-auto'>
          {(missed ?? []).map((m) => (
            <Checkbox
              key={m.taskKey}
              checked={selectedKeys.includes(m.taskKey)}
              onChange={(e) => toggleTask(m.taskKey, e.target.checked)}
            >
              <span className='font-medium'>{m.taskName}</span>
              <span className='text-gray-500'>
                {' 预期 '}
                {dayjs(m.lastExpectedTime).format('MM-DD HH:mm')}
                （上次执行 {m.lastRunTime ? dayjs(m.lastRunTime).format('MM-DD HH:mm') : '无'}）
              </span>
            </Checkbox>
          ))}
        </div>
      </div>
    </Modal>
  );
}
