import { useEffect } from 'react';
import { App } from 'antd';
import dayjs from 'dayjs';
import { useTaskStore } from '@/stores/task-store';
import { useTaskRunStore } from '@/stores/task-run-store';

/**
 * 错过任务检查器（无 UI，仅副作用）
 *
 * 在任务配置与执行记录加载完成后，向主进程查询关闭期间错过的预期执行，存在时弹窗提示
 */
export default function MissedTasksChecker() {
  const { modal } = App.useApp();
  const tasksLoaded = useTaskStore((s) => s.loaded);
  const runsLoaded = useTaskRunStore((s) => s.loaded);

  useEffect(() => {
    if (!tasksLoaded || !runsLoaded) {
      return;
    }
    let cancelled = false;
    void window.ipcRenderer.invoke('tasks:check-missed').then((missed) => {
      if (cancelled) {
        return;
      }
      if (missed.length === 0) {
        return;
      }
      modal.info({
        title: '以下启用任务在应用关闭期间可能错过',
        content: (
          <div className='flex flex-col gap-2'>
            <ul className='flex flex-col gap-1 m-0'>
              {missed.map((m) => (
                <li key={m.taskKey}>
                  <span className='font-medium'>{m.taskName}</span>
                  <span className='text-gray-500'>
                    {' 预期 '}
                    {dayjs(m.lastExpectedTime).format('MM-DD HH:mm')}
                    （上次执行 {m.lastRunTime ? dayjs(m.lastRunTime).format('MM-DD HH:mm') : '无'}）
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ),
        width: 600,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [tasksLoaded, runsLoaded, modal]);

  return null;
}
