import { useEffect, useRef, useState } from 'react';
import {
  Button,
  Divider,
  Form,
  InputNumber,
  Modal,
  Radio,
  Tooltip,
} from 'antd';
import {
  DeleteOutlined,
  EyeOutlined,
  HolderOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Draggable, { type DraggableData, type DraggableEvent } from 'react-draggable';
import { reorderById } from '@/lib/dnd-utils';
import { useSettingsStore } from '@/stores/settings-store';

/** 可排序的图片项 */
function SortableImageItem({
  path,
  onRemove,
  onView,
}: {
  path: string;
  onRemove: () => void;
  onView: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: path });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className='flex items-center justify-between border-b border-gray-200 px-2 py-1.5 last:border-b-0'
    >
      <div className='flex items-center gap-2 overflow-hidden'>
        <Button
          type='text'
          size='small'
          icon={<HolderOutlined />}
          className='cursor-grab shrink-0'
          {...attributes}
          {...listeners}
        />
        <span className='truncate text-sm'>{path}</span>
      </div>
      <div className='flex shrink-0 items-center'>
        <Tooltip title='查看'>
          <Button
            type='text'
            size='small'
            icon={<EyeOutlined />}
            onClick={onView}
          />
        </Tooltip>
        <Button
          type='text'
          size='small'
          danger
          icon={<DeleteOutlined />}
          onClick={onRemove}
        />
      </div>
    </div>
  );
}

interface BackgroundSettingsProps {
  open: boolean;
  onClose: () => void;
}

/** 背景图片设置弹窗 */
export default function BackgroundSettings({ open, onClose }: BackgroundSettingsProps) {
  const [form] = Form.useForm();
  const backgroundImages = useSettingsStore((s) => s.backgroundImages);
  const setBackgroundImages = useSettingsStore((s) => s.setBackgroundImages);
  const backgroundInterval = useSettingsStore((s) => s.backgroundInterval);
  const setBackgroundInterval = useSettingsStore((s) => s.setBackgroundInterval);
  const backgroundMode = useSettingsStore((s) => s.backgroundMode);
  const setBackgroundMode = useSettingsStore((s) => s.setBackgroundMode);
  const backgroundFadeDuration = useSettingsStore((s) => s.backgroundFadeDuration);
  const setBackgroundFadeDuration = useSettingsStore((s) => s.setBackgroundFadeDuration);

  // 弹窗打开时同步表单字段
  useEffect(() => {
    if (open) {
      form.setFieldsValue({
        backgroundMode,
        backgroundInterval: Math.round(backgroundInterval / 1000),
        backgroundFadeDuration: Math.round(backgroundFadeDuration / 1000),
      });
    }
  }, [open, backgroundInterval, backgroundMode, backgroundFadeDuration, form]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleFormChange = (_changed: Record<string, unknown>, allValues: Record<string, unknown>) => {
    if ('backgroundInterval' in allValues) {
      setBackgroundInterval((allValues.backgroundInterval as number) * 1000);
    }
    if ('backgroundMode' in allValues) {
      setBackgroundMode(allValues.backgroundMode as 'sequential' | 'random');
    }
    if ('backgroundFadeDuration' in allValues) {
      setBackgroundFadeDuration((allValues.backgroundFadeDuration as number) * 1000);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const newImages = reorderById(backgroundImages, event);
    if (newImages) {
      setBackgroundImages(newImages);
    }
  };

  const handleAddImage = async () => {
    const filePath = await window.ipcRenderer.invoke('settings:select-image');
    if (filePath && !backgroundImages.includes(filePath)) {
      setBackgroundImages([...backgroundImages, filePath]);
    }
  };

  const handleRemoveImage = (index: number) => {
    setBackgroundImages(backgroundImages.filter((_, i) => i !== index));
  };

  const handleView = (filePath: string) => {
    window.ipcRenderer.invoke('settings:preview-image', filePath);
  };

  // #region 弹窗拖拽相关逻辑
  /** 是否禁用弹窗拖动（仅鼠标悬停在标题栏时启用） */
  const [dragDisabled, setDragDisabled] = useState(true);
  /** 弹窗可拖动范围，拖动开始时按视口与弹窗位置计算 */
  const [bounds, setBounds] = useState({ left: 0, top: 0, bottom: 0, right: 0 });
  /** 可拖动 Modal 的拖动节点引用 */
  const dragRef = useRef<HTMLDivElement>(null);

  /** 拖动开始时计算边界，限制弹窗在视口内移动 */
  const onDragStart = (_event: DraggableEvent, uiData: DraggableData) => {
    const { clientWidth, clientHeight } = window.document.documentElement;
    const targetRect = dragRef.current?.getBoundingClientRect();
    if (!targetRect) {
      return;
    }
    setBounds({
      left: -targetRect.left + uiData.x,
      right: clientWidth - (targetRect.right - uiData.x),
      top: -targetRect.top + uiData.y,
      bottom: clientHeight - (targetRect.bottom - uiData.y),
    });
  };
  // #endregion

  return (
    <Modal
      title={
        <div
          style={{ width: '100%', cursor: 'move' }}
          onMouseEnter={() => setDragDisabled(false)}
          onMouseLeave={() => setDragDisabled(true)}
        >
          背景图片设置
        </div>
      }
      open={open}
      onCancel={onClose}
      footer={null}
      mask={false}
      width={640}
      modalRender={(node) => (
        <Draggable
          disabled={dragDisabled}
          bounds={bounds}
          nodeRef={dragRef}
          onStart={onDragStart}
        >
          <div ref={dragRef}>{node}</div>
        </Draggable>
      )}
    >
      <div className='mb-2 flex items-center justify-between'>
        <span className='text-sm font-medium'>图片列表</span>
        <Button
          size='small'
          icon={<PlusOutlined />}
          onClick={handleAddImage}
        >
          添加图片
        </Button>
      </div>
      {backgroundImages.length > 0 ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={backgroundImages}
            strategy={verticalListSortingStrategy}
          >
            <div className='rounded border border-ant'>
              {backgroundImages.map((path, index) => (
                <SortableImageItem
                  key={path}
                  path={path}
                  onRemove={() => handleRemoveImage(index)}
                  onView={() => handleView(path)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <div className='rounded border border-ant p-4 text-center text-gray-400'>
          暂无背景图片，点击"添加图片"选择
        </div>
      )}

      <Divider size='medium' />

      <Form
        form={form}
        layout='horizontal'
        labelCol={{ span: 5 }}
        wrapperCol={{ span: 19 }}
        onValuesChange={handleFormChange}
        initialValues={{
          backgroundMode: 'sequential',
          backgroundInterval: 600,
          backgroundFadeDuration: 1,
        }}
      >
        <Form.Item
          label='轮播模式'
          name='backgroundMode'
          className='mb-2!'
        >
          <Radio.Group>
            <Radio value='sequential'>顺序</Radio>
            <Radio value='random'>随机</Radio>
          </Radio.Group>
        </Form.Item>

        <Form.Item
          label='轮播间隔'
          name='backgroundInterval'
          className='mb-2!'
        >
          <InputNumber
            min={1}
            max={86400}
            suffix='秒'
            className='w-32!'
            controls={false}
          />
        </Form.Item>

        <Form.Item
          label='过渡时长'
          name='backgroundFadeDuration'
          className='mb-2!'
        >
          <InputNumber
            min={0}
            max={60}
            suffix='秒'
            className='w-32!'
            controls={false}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
