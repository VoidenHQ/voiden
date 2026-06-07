// ============================================================================
// PIPELINE HOOK REGISTRY TEST SUITE
// ============================================================================
// Comprehensive tests for:
// 1. HookRegistry singleton and hook management
// 2. Hook execution order (priority-based)
// 3. PipelineExecutor with all 8 stages
// 4. HybridPipelineExecutor security boundaries
// 5. Error handling and negative cases
// 6. Hook context validation
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Editor } from '@tiptap/core';


// ============================================================================
// MOCK SETUP
// ============================================================================

const createMockEditor = () => {
  return {
    getJSON: vi.fn(() => ({ type: 'doc', content: [] })),
    schema: { nodes: {}, marks: {} },
  } as unknown as Editor;
};


const mockElectron = {
   request: {
    sendSecure: vi.fn().mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: [['content-type', 'application/json']],
      body: Buffer.from(JSON.stringify({ success: true })),
      requestMeta: { url: 'https://api.example.com' },
    }),
  },
};

// Mock window.electron
if (typeof window !== 'undefined') {
  (window as any).electron = mockElectron;
}
import {
  HookRegistry,
  hookRegistry,
  PipelineExecutor,
  HybridPipelineExecutor,
  PipelineStage,
  Hook,
  HookHandler,
} from '../index';

describe('HookRegistry', () => {
  let registry: HookRegistry;

  beforeEach(() => {
    registry = HookRegistry.getInstance();
    registry.clearAll();
    
  });

  describe('singleton pattern', () => {
    it('voiden test : singleton returns same instance', () => {
      const instance1 = HookRegistry.getInstance();
      const instance2 = HookRegistry.getInstance();
      expect(instance1).toBe(instance2);
    });

    it('voiden test : maintain state across get instances', () => {
      const instance1 = HookRegistry.getInstance();
      instance1.registerHook('test', PipelineStage.PreProcessing, vi.fn());

      const instance2 = HookRegistry.getInstance();
      const hooks = instance2.getHooks(PipelineStage.PreProcessing);
      
      expect(hooks).toHaveLength(1);
    });
  });

  describe('registerHook', () => {
    it('voiden test : register hook for specific stage', () => {
      const handler = vi.fn();
      registry.registerHook('ext-1', PipelineStage.PreProcessing, handler);

      const hooks = registry.getHooks(PipelineStage.PreProcessing);
      expect(hooks).toHaveLength(1);
      expect(hooks[0].extensionId).toBe('ext-1');
      expect(hooks[0].handler).toBe(handler);
    });

    it('voiden test : sort hooks by priority', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const handler3 = vi.fn();

      registry.registerHook('ext-1', PipelineStage.PreProcessing, handler1, 200);
      registry.registerHook('ext-2', PipelineStage.PreProcessing, handler2, 50);
      registry.registerHook('ext-3', PipelineStage.PreProcessing, handler3, 100);

      const hooks = registry.getHooks(PipelineStage.PreProcessing);
      expect(hooks[0].extensionId).toBe('ext-2'); // priority 50
      expect(hooks[1].extensionId).toBe('ext-3'); // priority 100
      expect(hooks[2].extensionId).toBe('ext-1'); // priority 200
    });

    it('voiden test : default priority to 100', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      registry.registerHook('ext-1', PipelineStage.PreProcessing, handler1); // default 100
      registry.registerHook('ext-2', PipelineStage.PreProcessing, handler2, 50);

      const hooks = registry.getHooks(PipelineStage.PreProcessing);
      expect(hooks[0].extensionId).toBe('ext-2'); // priority 50
      expect(hooks[1].extensionId).toBe('ext-1'); // priority 100
    });

    it('voiden test : handle negative priorities', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const handler3 = vi.fn();

      registry.registerHook('ext-1', PipelineStage.PreProcessing, handler1, 100);
      registry.registerHook('ext-2', PipelineStage.PreProcessing, handler2, -50);
      registry.registerHook('ext-3', PipelineStage.PreProcessing, handler3, 0);

      const hooks = registry.getHooks(PipelineStage.PreProcessing);
      expect(hooks[0].extensionId).toBe('ext-2'); // priority -50
      expect(hooks[1].extensionId).toBe('ext-1'); // priority 100
      expect(hooks[2].extensionId).toBe('ext-3'); // priority 0

    });

    it('voiden test : allow multiple hooks for different stages', () => {
      registry.registerHook('ext-1', PipelineStage.PreProcessing, vi.fn());
      registry.registerHook('ext-1', PipelineStage.PostProcessing, vi.fn());

      expect(registry.getHooks(PipelineStage.PreProcessing)).toHaveLength(1);
      expect(registry.getHooks(PipelineStage.PostProcessing)).toHaveLength(1);
    });
  });

  describe('unregisterExtension', () => {
    it('voiden test : remove all hooks for extension', () => {
      registry.registerHook('ext-1', PipelineStage.PreProcessing, vi.fn());
      registry.registerHook('ext-1', PipelineStage.PostProcessing, vi.fn());
      registry.registerHook('ext-2', PipelineStage.PreProcessing, vi.fn());

      registry.unregisterExtension('ext-1');

      expect(registry.getHooks(PipelineStage.PreProcessing)).toHaveLength(1);
      expect(registry.getHooks(PipelineStage.PostProcessing)).toHaveLength(0);
      expect(registry.getHooks(PipelineStage.PreProcessing)[0].extensionId).toBe('ext-2');
    });

    it('voiden test : handle unregistering non-existent extension', () => {
      registry.registerHook('ext-1', PipelineStage.PreProcessing, vi.fn());
      
      expect(() => {
        registry.unregisterExtension('non-existent');
      }).not.toThrow();

      expect(registry.getHooks(PipelineStage.PreProcessing)).toHaveLength(1);
    });
  });

  describe('executeHooks', () => {
    it('voiden test : execute all hooks in priority order', async () => {
      const execOrder: string[] = [];
      
      const handler1 = vi.fn(() =>{
        execOrder.push('ext-1')
      });
      const handler2 = vi.fn(() => {
        execOrder.push('ext-2')
      });
      const handler3 = vi.fn(() => {
        execOrder.push('ext-3')
      });

      registry.registerHook('ext-1', PipelineStage.PreProcessing, handler1, 100);
      registry.registerHook('ext-2', PipelineStage.PreProcessing, handler2, 50);
      registry.registerHook('ext-3', PipelineStage.PreProcessing, handler3, 200);

      await registry.executeHooks(PipelineStage.PreProcessing, { test: 'data' });

      expect(execOrder).toEqual(['ext-2', 'ext-1', 'ext-3']);
    });

    it('voiden test : pass context to all hooks', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      registry.registerHook('ext-1', PipelineStage.PreProcessing, handler1);
      registry.registerHook('ext-2', PipelineStage.PreProcessing, handler2);

      const context = { test: 'data' };
      await registry.executeHooks(PipelineStage.PreProcessing, context);

      expect(handler1).toHaveBeenCalledWith(context);
      expect(handler2).toHaveBeenCalledWith(context);
    });

    it('voiden test : handle async hooks', async () => {
      const handler = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
      });

      registry.registerHook('ext-1', PipelineStage.PreProcessing, handler);
      
      await registry.executeHooks(PipelineStage.PreProcessing, {});
      
      expect(handler).toHaveBeenCalled();
    });

    it('voiden test : continue execution on hook error', async () => {
      const handler1 = vi.fn(() => {
        throw new Error('Hook 1 failed');
      });
      const handler2 = vi.fn();

      registry.registerHook('ext-1', PipelineStage.PreProcessing, handler1, 50);
      registry.registerHook('ext-2', PipelineStage.PreProcessing, handler2, 100);

      await registry.executeHooks(PipelineStage.PreProcessing, {});

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled(); // Should still execute
    });

    it('voiden test : handle stage with no hooks', async () => {
      await expect(
        registry.executeHooks(PipelineStage.PreProcessing, {})
      ).resolves.toBeUndefined();
    });
  });

  describe('clearAll', () => {
    it('voiden test : remove all hooks from all stages', () => {
      registry.registerHook('ext-1', PipelineStage.PreProcessing, vi.fn());
      registry.registerHook('ext-2', PipelineStage.PostProcessing, vi.fn());
      registry.registerHook('ext-3', PipelineStage.PreSend, vi.fn());

      registry.clearAll();

      expect(registry.getHooks(PipelineStage.PreProcessing)).toHaveLength(0);
      expect(registry.getHooks(PipelineStage.PostProcessing)).toHaveLength(0);
      expect(registry.getHooks(PipelineStage.PreSend)).toHaveLength(0);
    });
  });

  describe('getStats', () => {
    it('voiden test : return hook counts per stage', () => {
      registry.registerHook('ext-1', PipelineStage.PreProcessing, vi.fn());
      registry.registerHook('ext-2', PipelineStage.PreProcessing, vi.fn());
      registry.registerHook('ext-3', PipelineStage.PostProcessing, vi.fn());

      const stats = registry.getStats();

      expect(stats[PipelineStage.PreProcessing]).toBe(2);
      expect(stats[PipelineStage.PostProcessing]).toBe(1);
    });
  });
});

describe('PipelineExecutor', () => {
  let executor: PipelineExecutor;
  let mockEditor: Editor;
  let registry: HookRegistry;

  beforeEach(() => {
    mockEditor = createMockEditor();
    registry = HookRegistry.getInstance();
    registry.clearAll();
    executor = new PipelineExecutor(mockEditor);

    // Mock fetch
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: new Map([['content-type', 'application/json']]),
      json: async () => ({ success: true }),
      text: async () => JSON.stringify({ success: true }),
      arrayBuffer: async () => new ArrayBuffer(0),
      url: 'https://api.example.com',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('execute', () => {
    it('voiden test : execute all pipeline stages', async () => {
      const result = await executor.execute();

      expect(result.success).toBe(true);
      expect(result.requestState).toBeDefined();
      expect(result.responseState).toBeDefined();
    });

    it('voiden test : initialize request state', async () => {
      const result = await executor.execute();

      expect(result.requestState.method).toBe('GET');
      expect(result.requestState.url).toBe('');
      expect(result.requestState.headers).toEqual([]);
      expect(result.requestState.queryParams).toEqual([]);
    });
  });

  describe('Stage 1: PreProcessing', () => {
    it('voiden test : execute pre-processing hooks', async () => {
      const hookHandler = vi.fn();
      registry.registerHook('test-ext', PipelineStage.PreProcessing, hookHandler);

      await executor.execute();

      expect(hookHandler).toHaveBeenCalled();
    });

    it('voiden test : pass correct context to pre-processing hooks', async () => {
      let capturedContext: any;
      
      registry.registerHook('test-ext', PipelineStage.PreProcessing, (ctx) => {
        capturedContext = ctx;
      });

      await executor.execute();

      expect(capturedContext.editor).toBe(mockEditor);
      expect(capturedContext.requestState).toBeDefined();
      expect(typeof capturedContext.cancel).toBe('function');
    });

    it('voiden test : cancel execution when requested', async () => {
      registry.registerHook('test-ext', PipelineStage.PreProcessing, (ctx: any) => {
        ctx.cancel();
      });

      const result = await executor.execute();

      expect(result.success).toBe(false);
      expect(result.cancelled).toBe(true);
    });

    it('voiden test : handle invalid context', async () => {
      registry.registerHook('test-ext', PipelineStage.PreProcessing, (ctx: any) => {
        // Try to access non-existent properties
        ctx.nonExistent?.someMethod?.();
      });

      const result = await executor.execute();
      expect(result.success).toBe(true); // Should continue despite error
    });
  });

  describe('Stage 2: RequestCompilation', () => {
    it('voiden test : execute request compilation hooks', async () => {
      const hookHandler = vi.fn();
      registry.registerHook('test-ext', PipelineStage.RequestCompilation, hookHandler);

      await executor.execute();

      expect(hookHandler).toHaveBeenCalled();
    });

    it('voiden test : provide addHeader helper in context', async () => {
      registry.registerHook('test-ext', PipelineStage.RequestCompilation, (ctx: any) => {
        ctx.addHeader('X-Custom-Header', 'test-value');
      });

      const result = await executor.execute();

      expect(result.requestState.headers).toContainEqual({
        key: 'X-Custom-Header',
        value: 'test-value',
        enabled: true,
      });
    });

    it('voiden test : provide addQueryParam helper in context', async () => {
      registry.registerHook('test-ext', PipelineStage.RequestCompilation, (ctx: any) => {
        ctx.addQueryParam('foo', 'bar');
      });

      const result = await executor.execute();

      expect(result.requestState.queryParams).toContainEqual({
        key: 'foo',
        value: 'bar',
        enabled: true,
      });
    });

    it('voiden test : handle multiple headers and params', async () => {
      registry.registerHook('test-ext', PipelineStage.RequestCompilation, (ctx: any) => {
        ctx.addHeader('Header-1', 'value-1');
        ctx.addHeader('Header-2', 'value-2');
        ctx.addQueryParam('param1', 'value1');
        ctx.addQueryParam('param2', 'value2');
      });

      const result = await executor.execute();

      expect(result.requestState.headers).toHaveLength(2);
      expect(result.requestState.queryParams).toHaveLength(2);
    });

    it('voiden test : handle invalid arguments gracefully', async () => {
      registry.registerHook('test-ext', PipelineStage.RequestCompilation, (ctx: any) => {
        // Invalid inputs
        ctx.addHeader(null, undefined);
        ctx.addQueryParam(123, { invalid: 'object' });
        ctx.addHeader('', '');
      });

      const result = await executor.execute();
      expect(result.success).toBe(true); // Should not crash
    });
  });

  describe('Stage 5: PreSend', () => {
    it('voiden test : execute pre-send hooks', async () => {
      const hookHandler = vi.fn();
      registry.registerHook('test-ext', PipelineStage.PreSend, hookHandler);

      await executor.execute();

      expect(hookHandler).toHaveBeenCalled();
    });

    it('voiden test : have access to compiled request state', async () => {
      let capturedContext: any;

      registry.registerHook('compile', PipelineStage.RequestCompilation, (ctx: any) => {
        ctx.requestState.url = 'https://api.example.com';
      });

      registry.registerHook('presend', PipelineStage.PreSend, (ctx: any) => {
        capturedContext = ctx;
      });

      await executor.execute();

      expect(capturedContext.requestState.url).toBe('https://api.example.com');
    });

    it('voiden test : allow modifications to request state', async () => {
      registry.registerHook('test-ext', PipelineStage.PreSend, (ctx: any) => {
        ctx.requestState.url = 'https://modified.example.com';
      });

      const result = await executor.execute();

      expect(result.requestState.url).toBe('https://modified.example.com');
    });
  });

  describe('Stage 8: PostProcessing', () => {
    it('voiden test : execute post-processing hooks', async () => {
      const hookHandler = vi.fn();
      registry.registerHook('test-ext', PipelineStage.PostProcessing, hookHandler);

      await executor.execute();

      expect(hookHandler).toHaveBeenCalled();
    });

    it('voiden test : have access to both request and response state', async () => {
      let capturedContext: any;

      registry.registerHook('test-ext', PipelineStage.PostProcessing, (ctx: any) => {
        capturedContext = ctx;
      });

      await executor.execute();

      expect(capturedContext.requestState).toBeDefined();
      expect(capturedContext.responseState).toBeDefined();
      expect(capturedContext.responseState.status).toBe(200);
    });

    it('voiden test : handle response data access', async () => {
      let responseBody: any;

      registry.registerHook('test-ext', PipelineStage.PostProcessing, (ctx: any) => {
        responseBody = ctx.responseState.body;
      });

      await executor.execute();

      expect(responseBody).toEqual({ success: true });
    });

    it('voiden test : handle null or undefined response gracefully', async () => {
      registry.registerHook('test-ext', PipelineStage.PostProcessing, (ctx: any) => {
        // Try to access potentially missing data
        const _ = ctx.responseState?.body?.nonExistent?.deepProperty;
      });

      const result = await executor.execute();
      expect(result.success).toBe(true);
    });
  });

  describe('error handling', () => {
    it('voiden test : return error result if pipeline fails', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const result = await executor.execute();

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('Network error');
    });

    it('voiden test : handle hook errors gracefully', async () => {
      registry.registerHook('failing-ext', PipelineStage.PreProcessing, () => {
        throw new Error('Hook failed');
      });

      registry.registerHook('normal-ext', PipelineStage.PreProcessing, vi.fn());

      const result = await executor.execute();
      
      // Pipeline should continue despite hook failure
      expect(result.success).toBe(true);
    });
  });
});

describe('Negative Cases and Edge Cases', () => {
  let registry: HookRegistry;

  beforeEach(() => {
    registry = HookRegistry.getInstance();
    registry.clearAll();
  });

  describe('invalid hook handlers', () => {
    it('voiden test : handle null handler', () => {
      expect(() => {
        registry.registerHook('test', PipelineStage.PreProcessing, null as any);
      }).not.toThrow();
    });

    it('voiden test : handle undefined handler', () => {
      expect(() => {
        registry.registerHook('test', PipelineStage.PreProcessing, undefined as any);
      }).not.toThrow();
    });

    it('voiden test : handle non-function handler', () => {
      expect(() => {
        registry.registerHook('test', PipelineStage.PreProcessing, 'not-a-function' as any);
      }).not.toThrow();
    });
  });

  describe('invalid priorities', () => {
    it('voiden test : handle NaN priority', () => {
      const handler = vi.fn();
      registry.registerHook('test', PipelineStage.PreProcessing, handler, NaN);

      const hooks = registry.getHooks(PipelineStage.PreProcessing);
      expect(hooks).toHaveLength(1);
    });

    it('voiden test : handle Infinity priority', () => {
      const handler = vi.fn();
      registry.registerHook('test', PipelineStage.PreProcessing, handler, Infinity);

      const hooks = registry.getHooks(PipelineStage.PreProcessing);
      expect(hooks).toHaveLength(1);
    });

    it('voiden test : handle very large priorities', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      registry.registerHook('test-1', PipelineStage.PreProcessing, handler1, 999999999);
      registry.registerHook('test-2', PipelineStage.PreProcessing, handler2, 1);

      const hooks = registry.getHooks(PipelineStage.PreProcessing);
      expect(hooks[0].extensionId).toBe('test-2'); // Lower priority first
    });
  });

  describe('context mutations', () => {
    it('voiden test : handle context being set to null', async () => {
      registry.registerHook('test', PipelineStage.PreProcessing, (ctx: any) => {
        ctx = null; // Try to nullify context
      });

      await expect(
        registry.executeHooks(PipelineStage.PreProcessing, { test: 'data' })
      ).resolves.toBeUndefined();
    });

    it('voiden test : handle context property deletion', async () => {
      const context = { editor: createMockEditor(), requestState: {} };
      
      registry.registerHook('test', PipelineStage.PreProcessing, (ctx: any) => {
        delete ctx.editor;
      });

      await registry.executeHooks(PipelineStage.PreProcessing, context);
      
      // Context should be mutated
      expect(context.editor).toBeUndefined();
    });
  });

  describe('async errors', () => {
    it('voiden test : handle promise rejection in hook', async () => {
      registry.registerHook('test', PipelineStage.PreProcessing, async () => {
        throw new Error('Async error');
      });

      registry.registerHook('test-2', PipelineStage.PreProcessing, vi.fn());

      await expect(
        registry.executeHooks(PipelineStage.PreProcessing, {})
      ).resolves.toBeUndefined();
    });

  });

});