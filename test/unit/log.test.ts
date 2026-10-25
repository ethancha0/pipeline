import { describe, expect, it } from 'vitest';
import { MASK, maskDeep, maskSecrets, registerSecret } from '../../src/log.js';

describe('maskSecrets', () => {
  it('masks registered secrets in strings, objects and errors', () => {
    registerSecret('hunter2-super-secret');
    expect(maskSecrets('pw=hunter2-super-secret;')).toBe(`pw=${MASK};`);
    expect(maskDeep({ a: ['x hunter2-super-secret'], b: 1 })).toEqual({ a: [`x ${MASK}`], b: 1 });
    expect(maskDeep(new Error('bad hunter2-super-secret')).message).toBe(`bad ${MASK}`);
  });

  it('leaves text without secrets unchanged', () => {
    expect(maskSecrets('nothing to see')).toBe('nothing to see');
  });
});
