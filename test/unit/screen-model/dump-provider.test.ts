import { describe, it, expect, beforeEach } from 'vitest';
import { buildScreenModel, parseRef, _resetGenerationForTest } from '../../../src/screen-model/dump-provider';

beforeEach(() => _resetGenerationForTest());

describe('buildScreenModel', () => {
  it('分配 @eN#sN 代际引用,代际单调递增', () => {
    const layout = JSON.stringify({
      attributes: { bounds: '[0,0][10,10]' },
      children: [
        { attributes: { type: 'Row', clickable: 'true', text: 'A', bounds: '[0,0][5,5]' } },
        { attributes: { type: 'Row', clickable: 'true', text: 'B', bounds: '[0,5][5,10]' } },
      ],
    });
    const m1 = buildScreenModel(layout);
    expect(m1.generation).toBe(1);
    expect(m1.elements[0]?.ref).toBe('@e0#s1');
    expect(m1.elements[1]?.ref).toBe('@e1#s1');
    const m2 = buildScreenModel(layout);
    expect(m2.generation).toBe(2);
    expect(m2.elements[0]?.ref).toBe('@e0#s2');
  });

  it('parseRef 解析 @eN#sN', () => {
    expect(parseRef('@e3#s7')).toEqual({ idx: 3, gen: 7 });
    expect(parseRef('bad')).toBeUndefined();
  });
});
