import { describe, it, expect } from 'vitest';
import { flattenLayout } from '../../../src/layout/flatten';

const node = (attrs: Record<string, string>, children: any[] = []) => ({ attributes: attrs, children });
const layout = JSON.stringify(node({ bounds: '[0,0][100,100]' }, [
  node({ id: 'wifi_entry', key: 'wifi_key', type: 'Row', clickable: 'true', bounds: '[0,0][100,50]', enabled: 'true', scrollable: 'false' }),
  node({ type: 'Text', text: 'WLAN', bounds: '[0,0][40,50]' }),
  node({ type: 'SearchField', hint: '搜索设置项', bounds: '[0,50][100,60]' }),
  node({ type: 'List', scrollable: 'true', bounds: '[0,60][100,100]' }),
]));

describe('flattenLayout', () => {
  it('提取独立 id 与 key', () => {
    const els = flattenLayout(layout);
    const wifi = els.find((e) => e.id === 'wifi_entry');
    expect(wifi?.id).toBe('wifi_entry');
    expect(wifi?.key).toBe('wifi_key');
  });
  it('提取 enabled / scrollable / hint', () => {
    const els = flattenLayout(layout);
    expect(els.find((e) => e.type === 'Row')?.enabled).toBe(true);
    expect(els.find((e) => e.type === 'List')?.scrollable).toBe(true);
    expect(els.find((e) => e.type === 'SearchField')?.hint).toBe('搜索设置项');
  });
  it('保留 scrollable 容器(放宽过滤)', () => {
    const els = flattenLayout(layout);
    expect(els.some((e) => e.scrollable && e.type === 'List')).toBe(true);
  });
});
