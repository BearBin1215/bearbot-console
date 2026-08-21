import { useEffect, useMemo, useRef, useState } from 'react';
import { DeleteOutlined, SearchOutlined, CaretUpOutlined, CaretDownOutlined } from '@ant-design/icons';
import { Button, DatePicker, Input, Select, Spin, Tooltip } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import type { LogLevel } from '@shared/types';
import { useLogStore } from '@/stores/log-store';
import { useTaskStore } from '@/stores/task-store';
import LogRow from './log-row';

const { RangePicker } = DatePicker;

const LOG_LEVELS = ['INFO', 'WARN', 'ERROR'] as const;

/** 日志区 */
export default function LogPanel() {
  const logs = useLogStore((s) => s.logs);
  const loaded = useLogStore((s) => s.loaded);
  const clearLogs = useLogStore((s) => s.clearLogs);
  const tasks = useTaskStore((s) => s.tasks);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [levels, setLevels] = useState<LogLevel[]>([]);
  const [timeRange, setTimeRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [text, setText] = useState('');
  const [taskKeys, setTaskKeys] = useState<string[]>([]);

  // 是否展开
  const [expanded, setExpanded] = useState(false);

  // taskKey → 当前任务名映射，渲染时动态查找，避免改名后历史日志显示不一致
  const taskNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tasks) {
      m.set(t.taskKey, t.name);
    }
    return m;
  }, [tasks]);

  // 启动加载后瞬时滚到底部，后续新日志平滑跟随
  const initialScrollDone = useRef(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    if (!initialScrollDone.current && logs.length > 0) {
      el.scrollTop = el.scrollHeight;
      initialScrollDone.current = true;
    } else {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }, [logs]);

  const filteredLogs = useMemo(() => {
    const keyword = text.trim().toLowerCase();
    return logs.filter((log) => {
      if (levels.length > 0 && !levels.includes(log.level)) {
        return false;
      }
      if (taskKeys.length > 0 && !taskKeys.includes(log.taskKey)) {
        return false;
      }
      if (timeRange) {
        const logTime = dayjs(log.time);
        if (logTime.isBefore(timeRange[0]) || logTime.isAfter(timeRange[1])) {
          return false;
        }
      }
      if (keyword && !log.message.toLowerCase().includes(keyword)) {
        return false;
      }
      return true;
    });
  }, [logs, levels, taskKeys, timeRange, text]);

  return (
    <div className='flex h-full flex-col'>
      <div className='flex items-start gap-2 px-3 py-1.75 border-b border-ant-secondary'>
        <Button
          icon={expanded ? <CaretUpOutlined /> : <CaretDownOutlined />}
          onClick={() => setExpanded(!expanded)}
        />
        <div className='flex min-w-0 flex-1 flex-col gap-2'>
          <div className='flex items-center gap-2'>
            <Select
              className='grow basis-30'
              mode='multiple'
              allowClear
              maxTagCount='responsive'
              placeholder='全部级别'
              value={levels}
              onChange={(value) => setLevels(value as LogLevel[])}
              options={LOG_LEVELS.map((lvl) => ({ label: lvl, value: lvl }))}
            />
            <Input
              className='grow basis-75'
              allowClear
              suffix={<SearchOutlined />}
              placeholder='日志内容'
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
          {expanded && (
            <div className='flex flex-wrap items-center gap-2'>
              <Select
                className='grow basis-30'
                mode='multiple'
                allowClear
                maxTagCount='responsive'
                placeholder='全部任务'
                value={taskKeys}
                onChange={(value) => setTaskKeys(value as string[])}
                options={tasks.map((t) => ({ label: t.name, value: t.taskKey }))}
              />
              <RangePicker
                className='grow basis-75'
                showTime={{ format: 'HH:mm' }}
                format='YYYY-MM-DD HH:mm'
                value={timeRange}
                onChange={(value) => setTimeRange(value as [Dayjs, Dayjs] | null)}
              />
            </div>
          )}
        </div>
      </div>
      <div
        ref={scrollRef}
        className='relative flex-1 overflow-y-scroll p-2 pb-10 text-xs monospace'
      >
        {!loaded ? (
          <div className='flex justify-center pt-4'>
            <Spin />
          </div>
        ) : (
          <>
            {filteredLogs.map((log) => (
              <LogRow
                key={log.id}
                log={log}
                taskName={taskNameMap.get(log.taskKey) ?? log.taskKey}
              />
            ))}
            {logs.length > 0 && (
              <Tooltip title='清空'>
                <Button
                  className='fixed! bottom-2 right-3'
                  shape='circle'
                  icon={<DeleteOutlined />}
                  onClick={clearLogs}
                />
              </Tooltip>
            )}
          </>
        )}
      </div>
    </div>
  );
}
