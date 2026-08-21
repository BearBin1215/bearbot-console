import { useMemo } from 'react';
import { Progress, Table, type TableColumnsType } from 'antd';
import type { TaskRunRecord } from '@shared/types';
import { useTaskStore } from '@/stores/task-store';
import { aggregateTaskRunStats, type StatsRange, type TaskStatItem } from '@/lib/task';

/** 任务执行统计表格属性 */
interface TaskStatsTableProps {
  /** 任务执行记录（已按时间顺序追加） */
  records: TaskRunRecord[];
  /** 统计时间段 */
  range: StatsRange;
}

/** 按成功率返回进度条颜色：>=80% 绿、<50% 红、其余橙 */
function getRateColor(rate: number): string {
  const percent = rate * 100;
  if (percent >= 80) {
    return '#52c41a';
  }
  if (percent < 50) {
    return '#ff4d4f';
  }
  return '#faad14';
}

/** 任务执行统计表格列定义 */
const COLUMNS: TableColumnsType<TaskStatItem> = [
  {
    title: '任务',
    dataIndex: 'name',
    key: 'name',
    ellipsis: true,
  },
  {
    title: '次数',
    dataIndex: 'total',
    key: 'total',
    width: 80,
    align: 'center',
    sorter: (a, b) => a.total - b.total,
    defaultSortOrder: 'descend',
  },
  {
    title: '成功',
    dataIndex: 'success',
    key: 'success',
    width: 70,
    align: 'center',
    sorter: (a, b) => a.success - b.success,
    render: (v: number) => <span className='text-green-600'>{v}</span>,
  },
  {
    title: '失败',
    dataIndex: 'failed',
    key: 'failed',
    width: 70,
    align: 'center',
    sorter: (a, b) => a.failed - b.failed,
    render: (v: number) => <span className='text-red-500'>{v}</span>,
  },
  {
    title: '中止',
    dataIndex: 'aborted',
    key: 'aborted',
    width: 70,
    align: 'center',
    sorter: (a, b) => a.aborted - b.aborted,
    render: (v: number) => <span className='text-gray-400'>{v}</span>,
  },
  {
    title: '成功率',
    dataIndex: 'successRate',
    key: 'successRate',
    width: 110,
    sorter: (a, b) => a.successRate - b.successRate,
    render: (v: number) => (
      <Progress
        percent={Math.round(v * 100)}
        size='small'
        strokeColor={getRateColor(v)}
      />
    ),
  },
];

/**
 * 任务执行统计表格。
 *
 * 按任务聚合选定时间段内的执行次数与成功率，数值列支持点击表头排序，
 * 默认按执行次数降序。无记录时展示空状态。
 */
export default function TaskStatsTable({ records, range }: TaskStatsTableProps) {
  const tasks = useTaskStore((s) => s.tasks);
  // taskKey -> 任务名映射，渲染时动态查找，未注册任务已被聚合函数过滤
  const taskNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tasks) {
      m.set(t.taskKey, t.name);
    }
    return m;
  }, [tasks]);

  const items = useMemo(
    () => aggregateTaskRunStats(records, range, taskNameMap),
    [records, range, taskNameMap],
  );

  return (
    <Table
      dataSource={items}
      columns={COLUMNS}
      rowKey='taskKey'
      size='small'
      pagination={false}
      scroll={{ y: 240 }}
      locale={{ emptyText: '暂无执行记录' }}
    />
  );
}
