import { describe, it, expect, vi } from 'vitest';

const mockElectron = {
  variables: {
    readMerged: vi.fn(),
  },
};

if (typeof window !== 'undefined') {
  (window as any).electron = mockElectron;
}

import { preSendProcessHook } from '../runtimeVariables';

describe('preSendProcessHook', () => {
  it('voiden test : preserves a missing {{process.*}} reference when an unrelated runtime variable exists', async () => {
    mockElectron.variables.readMerged.mockResolvedValueOnce({ unrelated: 'present' });

    const result = await preSendProcessHook({
      headers: [{ key: 'Authorization', value: 'Bearer {{process.missing}}' }],
    });

    expect(result.headers[0].value).toBe('Bearer {{process.missing}}');
  });

  it('voiden test : neighboring control - preserves the reference when no runtime variables are set at all', async () => {
    mockElectron.variables.readMerged.mockResolvedValueOnce({});

    const result = await preSendProcessHook({
      headers: [{ key: 'Authorization', value: 'Bearer {{process.missing}}' }],
    });

    expect(result.headers[0].value).toBe('Bearer {{process.missing}}');
  });

  it('voiden test : still substitutes a resolvable {{process.*}} reference', async () => {
    mockElectron.variables.readMerged.mockResolvedValueOnce({ token: 'abc123' });

    const result = await preSendProcessHook({
      headers: [{ key: 'Authorization', value: 'Bearer {{process.token}}' }],
    });

    expect(result.headers[0].value).toBe('Bearer abc123');
  });
});
