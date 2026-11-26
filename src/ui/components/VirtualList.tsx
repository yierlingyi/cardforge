import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface VirtualListProps<T> {
  items: T[];
  rowHeight: number;
  render: (item: T, index: number) => ReactNode;
  overscan?: number;
  className?: string;
  empty?: ReactNode;
}

/**
 * 固定行高虚拟列表：只渲染可视区域 + overscan 行。
 * 用于数万条世界书条目浏览，滚动时不创建对应数量的 DOM 节点。
 */
export default function VirtualList<T>({ items, rowHeight, render, overscan = 10, className, empty }: VirtualListProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(400);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    setHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (el && el.scrollTop > items.length * rowHeight) el.scrollTop = 0;
  }, [items.length, rowHeight]);

  if (!items.length) {
    return <div className={`scroll ${className || ''}`} ref={ref}>{empty}</div>;
  }

  const total = items.length * rowHeight;
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visibleCount = Math.ceil(height / rowHeight) + overscan * 2;
  const end = Math.min(items.length, start + visibleCount);

  return (
    <div
      ref={ref}
      className={`scroll ${className || ''}`}
      style={{ position: 'relative', overflowY: 'auto' }}
      onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
    >
      <div style={{ height: total, position: 'relative' }}>
        {items.slice(start, end).map((item, i) => (
          <div key={start + i} style={{ position: 'absolute', top: (start + i) * rowHeight, left: 0, right: 0, height: rowHeight }}>
            {render(item, start + i)}
          </div>
        ))}
      </div>
    </div>
  );
}
