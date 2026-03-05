// ============================================================================
// PLUGIN SYSTEM TEST SUITE
// ============================================================================
// This comprehensive test suite covers:
// 1. Store functionality (usePluginStore, useEditorEnhancementStore)
// 2. Plugin context API
// 3. Plugin lifecycle (onload/onunload)
// 4. Integration scenarios
// 5. Error handling and edge cases
// ============================================================================

import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { act } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import React from 'react';


// ============================================================================
// MOCK SETUP
// ============================================================================

// Mock electron APIs
const mockElectron = {
  sidebar: {
    registerSidebarTab: vi.fn(),
    getTabs: vi.fn(),
    activateTab: vi.fn(),
  },
  tab: {
    add: vi.fn(),
    getActiveTab: vi.fn(),
  },
  files: {
    getVoidFiles: vi.fn(),
    write: vi.fn(),
    createDirectory: vi.fn(),
    read: vi.fn(),
  },
  utils: {
    pathJoin: vi.fn(),
  },
  ipc: {
    invoke: vi.fn(),
  },
  searchFiles: vi.fn(),
};

// Mock window.electron
if (typeof window !== 'undefined') {
  (window as any).electron = mockElectron;
}

import {
  usePluginStore,
  useEditorEnhancementStore,
  createPlugin,
  getPlugins,
  getLinkableNodeTypes,
  getNodeDisplayName,
} from '../plugins';
import type { Plugin, PluginContext, SlashCommandGroup, EditorAction } from '@voiden/sdk';
vi.mock('@/core/projects/hooks', () => ({
  getProjects: vi.fn().mockResolvedValue({
    activeProject: '/test/project/path',
  }),
}));

vi.mock('@/core/extensions/hooks', () => ({
  useGetExtensions: vi.fn(),
}));

vi.mock('@/core/editors/voiden/VoidenEditor', () => ({
  useVoidenEditorStore: {
    getState: vi.fn(() => ({
      editor: {
        schema: { nodes: {}, marks: {} },
      },
    })),
  },
  useEditorStore: {
    getState: vi.fn(),
  },
  proseClasses: ['prose', 'prose-sm'],
}));

vi.mock('@/core/editors/code/CodeEditorStore', () => ({
  useCodeEditorStore: {
    getState: vi.fn(() => ({
      activeEditor: { editor: {} },
    })),
  },
}));

vi.mock('@/core/stores/panelStore', () => ({
  usePanelStore: {
    getState: vi.fn(() => ({
      rightPanelOpen: false,
      openRightPanel: vi.fn(),
      closeRightPanel: vi.fn(),
      openBottomPanel: vi.fn(),
      closeBottomPanel: vi.fn(),
    })),
  },
}));

vi.mock('@/core/request-engine/requestOrchestrator', () => ({
  requestOrchestrator: {
    registerRequestHandler: vi.fn(),
    registerResponseHandler: vi.fn(),
    registerResponseSection: vi.fn(),
    clear: vi.fn(),
  },
}));

vi.mock('@/core/paste/pasteOrchestrator', () => ({
  pasteOrchestrator: {
    registerBlockOwner: vi.fn(),
    registerBlockExtension: vi.fn(),
    registerPatternHandler: vi.fn(),
    clear: vi.fn(),
  },
}));



describe('usePluginStore', () => {
  beforeEach(() => {
    // Reset store before each test
    usePluginStore.setState({
      isInitialized: false,
      pluginErrors: [],
      sidebar: { left: [], right: [] },
      panels: { main: [], bottom: [] },
      editorActions: [],
      statusBarItems: [],
    });
  });

  describe('initialization', () => {
    it('voiden test : initialize store with false', () => {
      const { isInitialized } = usePluginStore.getState();
      expect(isInitialized).toBe(false);
    });

    it('voiden test : initialize store to true', () => {
      act(() => {
        usePluginStore.getState().initialize();
      });

      const { isInitialized } = usePluginStore.getState();
      expect(isInitialized).toBe(true);
    });
  });

  describe('error handling', () => {
    it('voiden test : add plugin errors', () => {
      act(() => {
        usePluginStore.getState().addPluginError('test-plugin', 'Test error message');
      });

      const { pluginErrors } = usePluginStore.getState();
      expect(pluginErrors).toHaveLength(1);
      expect(pluginErrors[0]).toEqual({
        extensionId: 'test-plugin',
        error: 'Test error message',
      });
    });

    it('voiden test : accumulate multiple errors', () => {
      act(() => {
        usePluginStore.getState().addPluginError('plugin-1', 'Error 1');
        usePluginStore.getState().addPluginError('plugin-2', 'Error 2');
      });

      const { pluginErrors } = usePluginStore.getState();
      expect(pluginErrors).toHaveLength(2);
    });

    it('voiden test : clear all errors', () => {
      act(() => {
        usePluginStore.getState().addPluginError('plugin-1', 'Error 1');
        usePluginStore.getState().addPluginError('plugin-2', 'Error 2');
        usePluginStore.getState().clearPluginErrors();
      });

      const { pluginErrors } = usePluginStore.getState();
      expect(pluginErrors).toHaveLength(0);
    });
  });

  describe('sidebar management', () => {
    it('voiden test : add tabs to left sidebar', () => {
      const testTab = {
        id: 'test-tab',
        title: 'Test Tab',
        component: () => React.createElement('div'),
      };

      act(() => {
        usePluginStore.getState().addSidebarTab('left', testTab);
      });

      const { sidebar } = usePluginStore.getState();
      expect(sidebar.left).toHaveLength(1);
      expect(sidebar.left[0]).toEqual(testTab);
    });

    it('voiden test : add tabs to right sidebar', () => {
      const testTab = {
        id: 'test-tab',
        title: 'Test Tab',
        component: () => React.createElement('div'),
      };

      act(() => {
        usePluginStore.getState().addSidebarTab('right', testTab);
      });

      const { sidebar } = usePluginStore.getState();
      expect(sidebar.right).toHaveLength(1);
      expect(sidebar.right[0]).toEqual(testTab);
    });

    it('voiden test : maintain separate left and right sidebars', () => {
      const leftTab = { id: 'left-1', title: 'Left', component: () => null };
      const rightTab = { id: 'right-1', title: 'Right', component: () => null };

      act(() => {
        usePluginStore.getState().addSidebarTab('left', leftTab);
        usePluginStore.getState().addSidebarTab('right', rightTab);
      });

      const { sidebar } = usePluginStore.getState();
      expect(sidebar.left).toHaveLength(1);
      expect(sidebar.right).toHaveLength(1);
      expect(sidebar.left[0].id).toBe('left-1');
      expect(sidebar.right[0].id).toBe('right-1');
    });
  });

  describe('panel management', () => {
    it('voiden test : register panels', () => {
      const testPanel = {
        id: 'test-panel',
        title: 'Test Panel',
        component: () => React.createElement('div'),
      };

      act(() => {
        usePluginStore.getState().registerPanel('main', testPanel);
      });

      const { panels } = usePluginStore.getState();
      expect(panels.main).toHaveLength(1);
      expect(panels.main[0]).toEqual(testPanel);
    });

    it('voiden test : support multiple panels in same location', () => {
      const panel1 = { id: 'panel-1', title: 'Panel 1', component: () => null };
      const panel2 = { id: 'panel-2', title: 'Panel 2', component: () => null };

      act(() => {
        usePluginStore.getState().registerPanel('main', panel1);
        usePluginStore.getState().registerPanel('main', panel2);
      });

      const { panels } = usePluginStore.getState();
      expect(panels.main).toHaveLength(2);
    });

    it('voiden test : create new panel arrays for undefined panel IDs', () => {
      const testPanel = { id: 'test', title: 'Test', component: () => null };

      act(() => {
        usePluginStore.getState().registerPanel('custom-panel', testPanel);
      });

      const { panels } = usePluginStore.getState();
      expect(panels['custom-panel']).toHaveLength(1);
    });
  });

  describe('editor actions', () => {
    it('voiden test : add editor actions', () => {
      const action: EditorAction = {
        id: 'test-action',
        component: () => React.createElement("div"),
        predicate: vi.fn(),
      };

      act(() => {
        usePluginStore.getState().addEditorAction(action);
      });

      const { editorActions } = usePluginStore.getState();
      expect(editorActions).toHaveLength(1);
      expect(editorActions[0]).toEqual(action);
    });

    it('voiden test : accumulate multiple actions', () => {
      const action1: EditorAction = { id: '1', component: () => React.createElement('div'), predicate: vi.fn() };
      const action2: EditorAction = { id: '2', component: () => React.createElement('div'), predicate: vi.fn() };

      act(() => {
        usePluginStore.getState().addEditorAction(action1);
        usePluginStore.getState().addEditorAction(action2);
      });

      const { editorActions } = usePluginStore.getState();
      expect(editorActions).toHaveLength(2);
    });
  });

  describe('status bar items', () => {
    it('voiden test : add status bar item', () => {
      const item = {
        id: 'test-item',
        icon: 'Zap',
        label: 'Test',
        tooltip: 'Test tooltip',
        position: 'left' as const,
        onClick: vi.fn(),
      };

      act(() => {
        usePluginStore.getState().addStatusBarItem(item);
      });

      const { statusBarItems } = usePluginStore.getState();
      expect(statusBarItems).toHaveLength(1);
      expect(statusBarItems[0]).toEqual(item);
    });

    it('voiden test : accumulate multiple status bar items', () => {
      const item1 = {
        id: 'item-1',
        icon: 'Zap',
        tooltip: 'Item 1',
        position: 'left' as const,
        onClick: vi.fn(),
      };
      const item2 = {
        id: 'item-2',
        icon: 'Star',
        tooltip: 'Item 2',
        position: 'right' as const,
        onClick: vi.fn(),
      };

      act(() => {
        usePluginStore.getState().addStatusBarItem(item1);
        usePluginStore.getState().addStatusBarItem(item2);
      });

      const { statusBarItems } = usePluginStore.getState();
      expect(statusBarItems).toHaveLength(2);
    });
  });
});

describe('createPlugin', () => {
  let onloadSpy: Mock;
  let onunloadSpy: Mock;

  beforeEach(() => {
    // Reset stores
    usePluginStore.setState({
      isInitialized: false,
      pluginErrors: [],
      sidebar: { left: [], right: [] },
      panels: { main: [], bottom: [] },
      editorActions: [],
      statusBarItems: [],
    });
    useEditorEnhancementStore.setState({
      voidenSlashGroups: [],
      voidenExtensions: [],
      codemirrorExtensions: [],
    });

    onloadSpy = vi.fn();
    onunloadSpy = vi.fn();
  });

  it('voiden test : create plugin with onload and onunload methods', () => {
    const pluginModule = (ctx: PluginContext): Plugin => ({
      onload: async (ctx) => {
        onloadSpy();
      },
      onunload: async () => {
        onunloadSpy();
      },
    });

    const plugin = createPlugin(pluginModule, 'test-plugin');

    expect(plugin).toHaveProperty('onload');
    expect(plugin).toHaveProperty('onunload');
    expect(typeof plugin.onload).toBe('function');
    expect(typeof plugin.onunload).toBe('function');
  });

  it('voiden test : call onload when plugin.onload is invoked', async () => {
    const pluginModule = (ctx: PluginContext): Plugin => ({
      onload: async (ctx) => {
        onloadSpy();
      },
      onunload: async () => { },
    });

    const plugin = createPlugin(pluginModule, 'test-plugin');
    await plugin.onload();

    expect(onloadSpy).toHaveBeenCalledTimes(1);
  });

  it('voiden test : call onunload when plugin.onunload is invoked', async () => {
    const pluginModule = (ctx: PluginContext): Plugin => ({
      onload: async (ctx) => { },
      onunload: async () => {
        onunloadSpy();
      },
    });

    const plugin = createPlugin(pluginModule, 'test-plugin');
    await plugin.onunload();

    expect(onunloadSpy).toHaveBeenCalledTimes(1);
  });

  describe('context.exposeHelpers', () => {
    it('voiden test : expose helpers globally', async () => {
      const testHelpers = {
        myHelper: vi.fn(),
        anotherHelper: vi.fn(),
      };
      const pluginModule = (ctx: PluginContext): Plugin => ({
        onload: async (ctx) => {
          ctx.exposeHelpers(testHelpers);
        },
        onunload: async () => { },
      });

      const plugin = createPlugin(pluginModule, 'test-plugin');
      await plugin.onload();

      expect(window.__voidenHelpers__?.['test-plugin']).toEqual(testHelpers);
    });
  });

  describe('context.registerSidebarTab', () => {
    it('voiden test : register sidebar tabs', async () => {
      const testTab = {
        id: 'test-tab',
        title: 'Test Tab',
        component: () => React.createElement('div'),
      };

      const pluginModule = (ctx: PluginContext): Plugin => ({
        onload: async (ctx) => {
          ctx.registerSidebarTab('left', testTab);
        },
        onunload: async () => { },
      });

      const plugin = createPlugin(pluginModule, 'test-plugin');
      await plugin.onload();

      const { sidebar } = usePluginStore.getState();
      expect(sidebar.left).toHaveLength(1);
      expect(sidebar.left[0]).toEqual(testTab);
    });

    it('voiden test : call electron API when registering sidebar tabs', async () => {
      const testTab = {
        id: 'test-tab',
        title: 'Test Tab',
        component: () => React.createElement('div'),
      };

      const pluginModule = (ctx: PluginContext): Plugin => ({
        onload: async (ctx) => {
          ctx.registerSidebarTab('right', testTab);
        },
        onunload: async () => { },
      });

      const plugin = createPlugin(pluginModule, 'test-plugin');
      await plugin.onload();

      expect(mockElectron.sidebar.registerSidebarTab).toHaveBeenCalledWith('right', {
        extensionId: 'test-plugin',
        id: 'test-tab',
        title: 'Test Tab',
      });
    });
  });

  describe('context.addVoidenSlashGroup', () => {
    it('voiden test : add slash command groups', async () => {
      const group: SlashCommandGroup = {
        title: 'Test Commands',
        name: "test-command",
        commands: [{ name: "command", slash: "/cmd", description: "cmd test", label: 'Command', action: vi.fn() }],
      };

      const pluginModule = (ctx: PluginContext): Plugin => ({
        onload: async (ctx) => {
          ctx.addVoidenSlashGroup(group);
        },
        onunload: async () => { },
      });

      const plugin = createPlugin(pluginModule, 'test-plugin');
      await plugin.onload();

      const { voidenSlashGroups } = useEditorEnhancementStore.getState();
      expect(voidenSlashGroups).toHaveLength(1);
      expect(voidenSlashGroups[0]).toEqual(group);
    });
  });

  describe('context.registerVoidenExtension', () => {
    it('voiden test : register Voiden extensions', async () => {
      const mockExtension = { name: 'custom-node', type: 'node' } as any;

      const pluginModule = (ctx: PluginContext): Plugin => ({
        onload: async (ctx) => {
          ctx.registerVoidenExtension(mockExtension);
        },
        onunload: async () => { },
      });

      const plugin = createPlugin(pluginModule, 'test-plugin');
      await plugin.onload();

      const { voidenExtensions } = useEditorEnhancementStore.getState();
      expect(voidenExtensions).toHaveLength(1);
      expect(voidenExtensions[0]).toEqual(mockExtension);
    });
  });

  describe('context.registerCodemirrorExtension', () => {
    it('voiden test : register CodeMirror extensions', async () => {
      const mockExtension = { name: 'codemirror-plugin' };

      const pluginModule = (ctx: PluginContext): Plugin => ({
        onload: async (ctx) => {
          ctx.registerCodemirrorExtension(mockExtension);
        },
        onunload: async () => { },
      });

      const plugin = createPlugin(pluginModule, 'test-plugin');
      await plugin.onload();

      const { codemirrorExtensions } = useEditorEnhancementStore.getState();
      expect(codemirrorExtensions).toHaveLength(1);
      expect(codemirrorExtensions[0]).toEqual(mockExtension);
    });
  });

  describe('context.registerPanel', () => {
    it('voiden test : register panels', async () => {
      const panel = {
        id: 'test-panel',
        title: 'Test Panel',
        component: () => React.createElement('div'),
      };

      const pluginModule = (ctx: PluginContext): Plugin => ({
        onload: async (ctx) => {
          ctx.registerPanel('main', panel);
        },
        onunload: async () => { },
      });

      const plugin = createPlugin(pluginModule, 'test-plugin');
      await plugin.onload();

      const { panels } = usePluginStore.getState();
      expect(panels.main).toHaveLength(1);
      expect(panels.main[0]).toEqual(panel);
    });
  });

  describe('context.registerEditorAction', () => {
    it('voiden test : register editor actions with valid components', async () => {
      const action: EditorAction = {
        id: 'test-action',
        component: () => React.createElement('div'),
        predicate: vi.fn(),
      };

      const pluginModule = (ctx: PluginContext): Plugin => ({
        onload: async (ctx) => {
          ctx.registerEditorAction(action);
        },
        onunload: async () => { },
      });

      const plugin = createPlugin(pluginModule, 'test-plugin');
      await plugin.onload();

      const { editorActions } = usePluginStore.getState();
      expect(editorActions).toHaveLength(1);
      expect(editorActions[0]).toEqual(action);
    });

    it('voiden test : not register actions with invalid components', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

      const invalidAction = {
        id: 'invalid',
        label: 'Invalid',
        component: 'not-a-function' as any,
        onClick: vi.fn(),
      };

      const pluginModule = (ctx: PluginContext): Plugin => ({
        onload: async (ctx) => {
          ctx.registerEditorAction(invalidAction);
        },
        onunload: async () => { },
      });

      const plugin = createPlugin(pluginModule, 'test-plugin');
      await plugin.onload();

      const { editorActions } = usePluginStore.getState();
      expect(editorActions).toHaveLength(0);
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  describe('context.registerStatusBarItem', () => {
    it('voiden test : register status bar item with valid onClick', async () => {
      const item = {
        id: 'test-sb',
        icon: 'Zap',
        tooltip: 'Test',
        position: 'left' as const,
        onClick: vi.fn(),
      };

      const pluginModule = (ctx: PluginContext): Plugin => ({
        onload: async (ctx) => {
          ctx.registerStatusBarItem(item);
        },
        onunload: async () => { },
      });

      const plugin = createPlugin(pluginModule, 'test-plugin');
      await plugin.onload();

      const { statusBarItems } = usePluginStore.getState();
      expect(statusBarItems).toHaveLength(1);
      expect(statusBarItems[0]).toEqual(item);
    });

    it('voiden test : not register status bar item with invalid onClick', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

      const invalidItem = {
        id: 'invalid',
        icon: 'Zap',
        tooltip: 'Bad',
        position: 'left' as const,
        onClick: 'not-a-function' as any,
      };

      const pluginModule = (ctx: PluginContext): Plugin => ({
        onload: async (ctx) => {
          ctx.registerStatusBarItem(invalidItem);
        },
        onunload: async () => { },
      });

      const plugin = createPlugin(pluginModule, 'test-plugin');
      await plugin.onload();

      const { statusBarItems } = usePluginStore.getState();
      expect(statusBarItems).toHaveLength(0);
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  describe('context.project APIs', () => {
    it('voiden test : get active Voiden editor', async () => {
      let capturedEditor: any;

      const pluginModule = (ctx: PluginContext): Plugin => ({
        onload: async (ctx) => {
          capturedEditor = ctx.project.getActiveEditor('voiden');
        },
        onunload: async () => { },
      });

      const plugin = createPlugin(pluginModule, 'test-plugin');
      await plugin.onload();

      expect(capturedEditor).toBeDefined();
      expect(capturedEditor).toHaveProperty('schema');
    });

    it('voiden test : get active code editor', async () => {
      let capturedEditor: any;

      const pluginModule = (ctx: PluginContext): Plugin => ({
        onload: async (ctx) => {
          capturedEditor = ctx.project.getActiveEditor('code');
        },
        onunload: async () => { },
      });

      const plugin = createPlugin(pluginModule, 'test-plugin');
      await plugin.onload();

      expect(capturedEditor).toBeDefined();
    });

    it('voiden test : get active project', async () => {
      let project: any;

      const pluginModule = (ctx: PluginContext): Plugin => ({
        onload: async (ctx) => {
          project = await ctx.project.getActiveProject();
        },
        onunload: async () => { },
      });

      const plugin = createPlugin(pluginModule, 'test-plugin');
      await plugin.onload();

      expect(project).toBe('/test/project/path');
    });

    it('voiden test : get project path', async () => {
      let path: any;

      const pluginModule = (ctx: PluginContext): Plugin => ({
        onload: async (ctx) => {
          path = await ctx.project.getActiveProject();
        },
        onunload: async () => { },
      });

      const plugin = createPlugin(pluginModule, 'test-plugin');
      await plugin.onload();

      expect(path).toBe('/test/project/path');
    });

    it('voiden test : create files', async () => {
      const pluginModule = (ctx: PluginContext): Plugin => ({
        onload: async (ctx) => {
          await ctx.project.createFile('test.txt', 'content');
        },
        onunload: async () => { },
      });

      const plugin = createPlugin(pluginModule, 'test-plugin');
      await plugin.onload();

      expect(mockElectron.files.write).toHaveBeenCalledWith('test.txt', 'content');
    });

    it('voiden test : create folders', async () => {
      const pluginModule = (ctx: PluginContext): Plugin => ({
        onload: async (ctx) => {
          await ctx.project.createFolder('newfolder');
        },
        onunload: async () => { },
      });

      const plugin = createPlugin(pluginModule, 'test-plugin');
      await plugin.onload();

      expect(mockElectron.files.createDirectory).toHaveBeenCalledWith('', 'newfolder');
    });

    it('voiden test : open files with proper path handling', async () => {
      mockElectron.utils.pathJoin.mockResolvedValue('/test/project/path/file.txt');

      const pluginModule = (ctx: PluginContext): Plugin => ({
        onload: async (ctx) => {
          await ctx.project.openFile('file.txt');
        },
        onunload: async () => { },
      });

      const plugin = createPlugin(pluginModule, 'test-plugin');
      await plugin.onload();

      expect(mockElectron.utils.pathJoin).toHaveBeenCalledWith(
        '/test/project/path',
        'file.txt'
      );
      expect(mockElectron.ipc.invoke).toHaveBeenCalledWith(
        'fileLink:open',
        '/test/project/path/file.txt',
        'file.txt'
      );
    });

    it('voiden test : handle openFile without skipJoin', async () => {
      mockElectron.utils.pathJoin.mockResolvedValue('/absolute/path/file.txt');

      const pluginModule = (ctx: PluginContext): Plugin => ({
        onload: async (ctx) => {
          await ctx.project.openFile('/absolute/path/file.txt');
        },
        onunload: async () => { },
      });

      const plugin = createPlugin(pluginModule, 'test-plugin');
      await plugin.onload();

      expect(mockElectron.ipc.invoke).toHaveBeenCalledWith(
        'fileLink:open',
        '/absolute/path/file.txt',
        'file.txt'
      );
    });
  });
});


describe('Mock Dependencies - Project Hooks', () => {
  it('voiden test : call getProjects hook', async () => {
    const { getProjects } = await import('@/core/projects/hooks');
    const result = await getProjects();

    expect(result).toBeDefined();
    expect(result.activeProject).toBe('/test/project/path');
  });
})

