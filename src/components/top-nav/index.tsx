import { useState, useMemo } from 'react';
import {
  AppstoreOutlined,
  ClockCircleOutlined,
  CaretUpOutlined,
  CaretDownOutlined,
  LoadingOutlined,
  BarChartOutlined,
} from '@ant-design/icons';
import { Button, Segmented, Tag, Tooltip } from 'antd';
import dayjs from 'dayjs';
import { getNextCronTime } from '@/lib/cron';
import type { TaskRunRecord } from '@shared/types';
import type { TaskInfo } from '@/lib/types';
import { type StatsRange } from '@/lib/task';
import { useAccountStore } from '@/stores/account-store';
import { useTaskStore } from '@/stores/task-store';
import { useTaskRunStore } from '@/stores/task-run-store';
import TaskStatsTable from './task-stats-table';

/** 统计已启用的任务数量 */
function getActiveCount(tasks: TaskInfo[]): number {
  return tasks.filter((t) => t.enabled).length;
}

/** 获取最近的下次执行任务，返回 { name, time }，无任务时返回 null */
function getNextRun(tasks: TaskInfo[]): { name: string; time: string } | null {
  const enabledTasks = tasks.filter((t) => t.enabled);
  if (enabledTasks.length === 0) {
    return null;
  }
  let earliestTime: Date | null = null;
  let earliestTask: TaskInfo | null = null;
  for (const task of enabledTasks) {
    const next = getNextCronTime(task.cron);
    if (next && (!earliestTime || next < earliestTime)) {
      earliestTime = next;
      earliestTask = task;
    }
  }
  if (!earliestTime || !earliestTask) {
    return null;
  }
  const time = dayjs(earliestTime).format('YYYY年M月D日 HH:mm');
  return { name: earliestTask.name, time };
}

/** 根据执行记录计算最近一周的成功/失败/停止计数 */
function getRunStats(records: TaskRunRecord[]): {
  totalCount: number;
  successCount: number;
  failedCount: number;
  abortedCount: number;
} {
  /** 统计窗口：一周 */
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  let successCount = 0;
  let failedCount = 0;
  let abortedCount = 0;
  for (const r of records) {
    // 统计窗口内的成功/失败/停止计数（按结束时间过滤，与图表统计口径一致）
    if (r.endTime >= cutoff) {
      if (r.aborted) {
        abortedCount++;
      } else if (r.success) {
        successCount++;
      } else {
        failedCount++;
      }
    }
  }
  return {
    totalCount: successCount + failedCount + abortedCount,
    successCount,
    failedCount,
    abortedCount,
  };
}

export default function TopNav() {
  const [expanded, setExpanded] = useState(false);
  const [statsRange, setStatsRange] = useState<StatsRange>('week');
  const tasks = useTaskStore((s) => s.tasks);
  const runningKeys = useTaskStore((s) => s.runningKeys);
  const hasLoggedIn = useAccountStore((s) => s.accounts.some((a) => a.loggedIn));
  const records = useTaskRunStore((s) => s.records);

  const activeCount = useMemo(() => getActiveCount(tasks), [tasks]);
  // 依赖 runningKeys：任务执行完成后触发重新计算下次执行时间
  const nextRun = useMemo(() => getNextRun(tasks), [tasks, runningKeys]);
  // 任务统计与最近执行（依赖 records：每次执行记录更新后重新计算）
  const stats = useMemo(() => getRunStats(records), [records]);
  // taskKey → 当前任务名映射，渲染时动态查找，避免改名后历史记录显示不一致
  const taskNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tasks) {
      m.set(t.taskKey, t.name);
    }
    return m;
  }, [tasks]);

  /** 正在执行的任务列表 */
  const runningTasks = useMemo(() => {
    const list: { key: string; name: string }[] = [];
    for (const key of runningKeys) {
      const name = taskNameMap.get(key);
      if (name) {
        list.push({ key, name });
      }
    }
    return list;
  }, [runningKeys, taskNameMap]);

  const toggleExpanded = () => {
    setExpanded((prev) => !prev);
  };

  return (
    <div className='border-b border-ant bg-white/40'>
      <div className='flex items-center justify-between px-3 py-2'>
        <div className='flex items-center gap-8'>
          <div className='flex items-center gap-2'>
            <AppstoreOutlined className='text-blue-500' />
            <span className='text-gray-500'>激活任务</span>
            <Tag color='blue' className='font-bold'>
              {activeCount}
            </Tag>
          </div>
          <div className='flex items-center gap-2'>
            <BarChartOutlined className='text-purple-500' />
            <span className='text-gray-500'>本周统计</span>
            <div className='flex items-center gap-1'>
              <Tag color='blue' className='m-0'>共 {stats.totalCount}</Tag>
              <Tag color='green' className='m-0'>成功 {stats.successCount}</Tag>
              <Tag color='red' className='m-0'>失败 {stats.failedCount}</Tag>
              <Tag className='m-0'>中止 {stats.abortedCount}</Tag>
            </div>
          </div>
          <div className='flex items-center gap-2'>
            <ClockCircleOutlined className='text-green-500' />
            <span className='text-gray-500'>下次执行</span>
            {!hasLoggedIn && <span className='text-gray-400'>未登录</span>}
            {hasLoggedIn && !nextRun && <span className='text-gray-400'>无</span>}
            {hasLoggedIn && nextRun && (
              <span className='font-medium'>{nextRun.name} {nextRun.time}</span>
            )}
          </div>
          {runningTasks.length > 0 && (
            <div className='flex items-center gap-2'>
              <LoadingOutlined className='text-orange-500' />
              <span className='text-gray-500'>正在执行</span>
              {/* 仅展示首个任务名，多余的放进后面的 +N 悬浮框 */}
              <span className='whitespace-nowrap font-medium'>{runningTasks[0].name}</span>
              {runningTasks.length > 1 && (
                <Tooltip
                  title={
                    <div className='flex flex-col gap-1'>
                      {runningTasks.slice(1).map((t) => (
                        <span key={t.key}>{t.name}</span>
                      ))}
                    </div>
                  }
                >
                  {/* +N 表示除首个外仍在执行的任务数，悬浮展示其余任务名 */}
                  <Tag color='orange' className='m-0 cursor-default whitespace-nowrap'>
                    +{runningTasks.length - 1}
                  </Tag>
                </Tooltip>
              )}
            </div>
          )}
        </div>
        <Tooltip title='更多'>
          <Button
            type='text'
            size='small'
            onClick={toggleExpanded}
            icon={expanded ? <CaretUpOutlined /> : <CaretDownOutlined />}
          />
        </Tooltip>
      </div>

      {expanded && (
        <div className='border-t border-ant-secondary px-3 py-2'>
          <div className='mb-2 flex items-center justify-between'>
            <span className='text-gray-500'>任务执行统计</span>
            <Segmented
              size='small'
              value={statsRange}
              onChange={(v) => setStatsRange(v as StatsRange)}
              options={[
                { label: '今日', value: 'today' },
                { label: '本周', value: 'week' },
                { label: '本月', value: 'month' },
              ]}
            />
          </div>
          <TaskStatsTable records={records} range={statsRange} />
        </div>
      )}
    </div>
  );
}
