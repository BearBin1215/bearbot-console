import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Spin } from 'antd';
import { reorderById } from '@/lib/dnd-utils';
import { useTaskStore } from '@/stores/task-store';
import TaskItem from './task-item';

/** 任务管理 */
export default function TaskList() {
  const tasks = useTaskStore((s) => s.tasks);
  const loaded = useTaskStore((s) => s.loaded);
  const reorderTasks = useTaskStore((s) => s.reorderTasks);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const newKeys = reorderById(
      tasks,
      event,
      (t) => t.taskKey,
    )?.map((t) => t.taskKey);
    if (newKeys) {
      reorderTasks(newKeys);
    }
  };

  if (!loaded) {
    return (
      <div className='flex justify-center p-6'>
        <Spin />
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={tasks.map((t) => t.taskKey)} strategy={verticalListSortingStrategy}>
        <div className='flex flex-col gap-3 p-3'>
          {tasks.map((task) => (
            <TaskItem
              key={task.taskKey}
              task={task}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
