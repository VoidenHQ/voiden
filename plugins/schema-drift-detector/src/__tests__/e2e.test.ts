import { describe, it, expect, vi, beforeEach } from 'vitest';
import schemaDriftDetectorPlugin from '../main';
import { driftStore } from '../store/driftStore';
import { runSchemaDriftCheck } from '../runner';

describe('Schema Drift Detector Plugin E2E', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('initializes and registers response section and hook', async () => {
    let responseHandler: any;
    let registeredSection: any;
    let registeredStatusBarItem: any;

    const mockContext: any = {
      registerResponsePanelSection: vi.fn((section) => {
        registeredSection = section;
      }),
      onProcessResponse: vi.fn((handler) => {
        responseHandler = handler;
      }),
      registerStatusBarItem: vi.fn((item) => {
        registeredStatusBarItem = item;
      }),
      response: {
        getCurrentTabId: vi.fn(async () => 'tab-123'),
      },
      ui: {
        showToast: vi.fn(),
      },
    };

    const plugin = schemaDriftDetectorPlugin(mockContext);
    await plugin.onload();

    expect(mockContext.registerResponsePanelSection).toHaveBeenCalled();
    expect(mockContext.onProcessResponse).toHaveBeenCalled();
    expect(mockContext.registerStatusBarItem).toHaveBeenCalled();
    expect(registeredSection.id).toBe('schema-drift');

    // 1. First execution -> Records baseline
    await responseHandler({
      status: 200,
      url: 'https://api.example.com/items',
      body: [{ id: 1, title: 'Item 1' }],
    });

    let report = driftStore.getReport('tab-123');
    expect(report).toBeDefined();
    expect(report?.isNewBaseline).toBe(true);
    expect(registeredSection.hasResults('tab-123')).toBe(true);

    // 2. Second execution with modified type -> Detects breaking change
    await responseHandler({
      status: 200,
      url: 'https://api.example.com/items',
      body: [{ id: '1', title: 'Item 1' }],
    });

    report = driftStore.getReport('tab-123');
    expect(report).toBeDefined();
    expect(report?.isNewBaseline).toBe(false);
    expect(report?.hasBreakingChanges).toBe(true);
    expect(report?.summary.breaking).toBe(1);
    expect(mockContext.ui.showToast).toHaveBeenCalledWith(
      expect.stringContaining('breaking change(s) detected'),
      'warning'
    );
  });

  it('runs programmatic CI schema drift check', () => {
    const baseline = {
      user: {
        id: 100,
        name: 'Alice',
        tags: ['admin', 'staff'],
      },
    };

    const changed = {
      user: {
        id: 100,
        name: 'Alice',
        tags: [1, 2], // breaking array type mutation
        newProfile: { bio: 'hi' },
      },
    };

    const result = runSchemaDriftCheck({
      baselineJsonOrSchema: baseline,
      currentResponseOrPayload: changed,
    });

    expect(result.success).toBe(false);
    expect(result.hasBreakingChanges).toBe(true);
    expect(result.markdown).toContain('BREAKING CHANGES DETECTED');
    expect(result.text).toContain('[BREAKING]');
  });
});
