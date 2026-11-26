import { useMemo, useState } from 'react';
import type { MvuSchemaField } from '../../core/types';
import { escapePointer, jsonType, truncate } from '../../core/util';

export interface JsonTreeProps {
  data: any;
  selectedPath?: string | null;
  onSelect?: (path: string, value: any, key: string) => void;
  schemaMap?: Map<string, MvuSchemaField>;
  issues?: Map<string, 'error' | 'warning'>;
  filter?: string;
  expandDepth?: number;
  onCopy?: (text: string, label: string) => void;
  maxRows?: number;
}

interface NodeProps extends JsonTreeProps {
  value: any;
  path: string;
  keyName: string;
  depth: number;
  collapsed: Set<string>;
  toggle: (path: string) => void;
  rows: { count: number };
  forcedOpen: Set<string>;
}

function valueClass(v: any): string {
  const t = jsonType(v);
  if (t === 'number') return 'num';
  if (t === 'string') return 'str';
  if (t === 'boolean') return 'bool';
  if (t === 'null') return 'null';
  return '';
}

function renderValue(v: any): string {
  const t = jsonType(v);
  if (t === 'string') return JSON.stringify(truncate(v, 90));
  if (t === 'null') return 'null';
  if (t === 'array') return `[ ${v.length} 项 ]`;
  if (t === 'object') return `{ ${Object.keys(v).length} 字段 }`;
  return String(v);
}

function matchesFilter(value: any, keyName: string, path: string, filter: string): boolean {
  if (!filter) return true;
  const q = filter.toLowerCase();
  if (keyName.toLowerCase().includes(q) || path.toLowerCase().includes(q)) return true;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).toLowerCase().includes(q);
  }
  return false;
}

function hasMatchDeep(value: any, keyName: string, path: string, filter: string): boolean {
  if (!filter) return true;
  if (matchesFilter(value, keyName, path, filter)) return true;
  if (Array.isArray(value)) return value.some((v, i) => hasMatchDeep(v, String(i), `${path}[${i}]`, filter));
  if (value && typeof value === 'object') return Object.entries(value).some(([k, v]) => hasMatchDeep(v, k, path ? `${path}.${k}` : k, filter));
  return false;
}

function Node(props: NodeProps) {
  const { value, path, keyName, depth, collapsed, toggle, rows, forcedOpen, schemaMap, issues, selectedPath, onSelect, filter, onCopy } = props;
  if (rows.count > (props.maxRows ?? 4000)) return null;

  const t = jsonType(value);
  const isContainer = t === 'object' || t === 'array';
  const open = isContainer && (!collapsed.has(path) || forcedOpen.has(path));
  const schema = schemaMap?.get(path);
  const issue = issues?.get(path);
  const selected = selectedPath === path;
  const pointer = '/' + (path.split('.').filter(Boolean).map(escapePointer).join('/'));

  rows.count++;

  const schemaBadge = schema ? (
    <span className="badge outline" style={{ height: 15, fontSize: 9.5 }} title={schema.constraints.join('\n') || undefined}>
      {schema.type}
      {schema.required ? '' : '?'}
    </span>
  ) : null;

  return (
    <>
      <div
        className={`tree-row ${selected ? 'sel' : ''}`}
        style={{ paddingLeft: 6 + depth * 12 }}
        onClick={() => onSelect?.(path, value, keyName)}
        title={pointer}
      >
        <span className="tw" onClick={(e) => { e.stopPropagation(); if (isContainer) toggle(path); }}>
          {isContainer ? (open ? '▾' : '▸') : ''}
        </span>
        <span className="tk">{keyName}</span>
        <span className="faint" style={{ fontSize: 10 }}>:</span>
        <span className={`tv ${valueClass(value)}`}>
          {renderValue(value)}
          {filter && typeof value === 'string' && value.toLowerCase().includes(filter.toLowerCase()) ? (
            <span className="badge info" style={{ marginLeft: 6, height: 14, fontSize: 9 }}>命中</span>
          ) : null}
        </span>
        {schemaBadge}
        {issue ? <span className={`badge ${issue === 'error' ? 'err' : 'warn'}`} style={{ height: 14, fontSize: 9 }}>{issue === 'error' ? '类型/范围错误' : '需注意'}</span> : null}
        <span className="tpath">
          <button
            className="btn ghost sm icon"
            style={{ width: 16, height: 16 }}
            title={`复制 JSON Pointer：${pointer}`}
            onClick={(e) => {
              e.stopPropagation();
              onCopy?.(pointer, 'JSON Pointer');
            }}
          >
            ¶
          </button>
        </span>
      </div>
      {open && isContainer
        ? (Array.isArray(value) ? value.map((v, i) => <Node key={i} {...props} value={v} keyName={`[${i}]`} path={path ? `${path}[${i}]` : `[${i}]`} depth={depth + 1} />) : (
            Object.entries(value).map(([k, v]) => <Node key={k} {...props} value={v} keyName={k} path={path ? `${path}.${k}` : k} depth={depth + 1} />)
          ))
        : null}
    </>
  );
}

export default function JsonTree(props: JsonTreeProps) {
  const { data, filter = '', expandDepth = 2 } = props;
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const rows = { count: 0 };

  const forcedOpen = useMemo(() => {
    const s = new Set<string>();
    if (!filter) return s;
    const walk = (v: any, path: string, keyName: string) => {
      if (!hasMatchDeep(v, keyName, path, filter)) return;
      if (path) s.add(path);
      if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`, String(i)));
      else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => walk(x, path ? `${path}.${k}` : k, k));
    };
    walk(data, '', 'root');
    return s;
  }, [data, filter]);

  const toggle = (path: string) => {
    const next = new Set(collapsed);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setCollapsed(next);
  };

  if (data === null || data === undefined) {
    return <div className="empty" style={{ padding: 24 }}><p>没有变量数据。</p></div>;
  }

  return (
    <div className="tree">
      {typeof data === 'object' ? (
        Array.isArray(data) ? (
          data.map((v, i) => <Node key={i} {...props} value={v} keyName={`[${i}]`} path={`[${i}]`} depth={0} collapsed={collapsed} toggle={toggle} rows={rows} forcedOpen={forcedOpen} />)
        ) : (
          Object.entries(data).map(([k, v]) => (
            <Node key={k} {...props} value={v} keyName={k} path={k} depth={0} collapsed={collapsed} toggle={toggle} rows={rows} forcedOpen={forcedOpen} />
          ))
        )
      ) : (
        <Node {...props} value={data} keyName="(根)" path="" depth={0} collapsed={collapsed} toggle={toggle} rows={rows} forcedOpen={forcedOpen} />
      )}
      {rows.count > (props.maxRows ?? 4000) ? (
        <div className="pad10 faint" style={{ fontSize: 11 }}>节点过多（超过 {props.maxRows ?? 4000}），已停止渲染。请使用搜索或表格视图缩小范围。</div>
      ) : null}
    </div>
  );
}
