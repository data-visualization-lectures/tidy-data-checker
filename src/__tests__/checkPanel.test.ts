import { describe, it, expect } from 'vitest';
import { isCheckPendingEncoding } from '../components/CheckPanel';

describe('isCheckPendingEncoding', () => {
  it('hides non-encoding findings until the encoding fix is applied', () => {
    expect(isCheckPendingEncoding('empty', false)).toBe(true);
    expect(isCheckPendingEncoding('encoding', false)).toBe(false);
    expect(isCheckPendingEncoding('empty', true)).toBe(false);
  });
});
