import React, { useState, useEffect, useRef, useMemo, startTransition } from 'react';
import { Search, File, Folder, FilePlus, Terminal, Settings, FolderPlus, HelpCircle, Sparkles } from 'lucide-react';
import { MatchedFragment, highlightText } from '@/core/editors/voiden/extensions/MatchedFragment';
import { useAddPanelTab } from '@/core/layout/hooks';
import { cn } from '@/core/lib/utils';
import { useGetActiveDocument } from '@/core/file-system/hooks/useFileSystem';
import { useGetAppState } from '@/core/state/hooks';
import { useQueryClient } from '@tanstack/react-query';
import { usePanelStore } from '@/core/stores/panelStore';
import { useCodeEditorStore } from '@/core/editors/code/CodeEditorStore';
import { useDocumentStore } from '@/core/file-system/stores';
import { prettifyJSONC } from '@/utils/jsonc';
import {
  HttpHeadersHelp,
  HttpQueryParamsHelp,
  HttpUrlFormHelp,
  HttpMultipartFormHelp,
  HttpPathParamsHelp,
  HttpJsonBodyHelp,
  HttpXmlBodyHelp,
} from '@voiden/core-extensions/voiden-rest-api/help';
import { SimpleAssertionsHelp } from '@voiden/core-extensions/simple-assertions/help';
import { RuntimeVariablesHelp } from '@/core/editors/voiden/nodes/help';

interface CommandPaletteProps {
  isFocused: boolean;
  mode: 'files' | 'commands';
  onFocus: () => void;
  onBlur: () => void;
  onShowHelp: (title: string, content: React.ReactNode) => void;
}

interface FileItem {
  path: string;
  name: string;
  directory: string;
  relativePath: string;
  pathFragments?: MatchedFragment[];
  filenameFragments?: MatchedFragment[];
}

interface Command {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  action: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ isFocused, mode, onFocus, onBlur, onShowHelp }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredFiles, setFilteredFiles] = useState<FileItem[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showDropdown, setShowDropdown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { mutate: addPanelTab } = useAddPanelTab();
  const queryClient = useQueryClient();
  const { openBottomPanel, bottomPanelRef } = usePanelStore();
  const { data: activeFilePath } = useGetActiveDocument();

  // Prettify utilities
  const prettifyXML = (xml: string): string => {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xml, 'application/xml');
      const serializer = new XMLSerializer();
      const formatted = serializer.serializeToString(doc);
      // Basic indentation
      let indent = 0;
      return formatted
        .replace(/></g, '>\n<')
        .split('\n')
        .map(line => {
          if (line.match(/<\/\w/)) indent--;
          const indented = '  '.repeat(Math.max(0, indent)) + line;
          if (line.match(/<\w[^>]*[^\/]>$/)) indent++;
          return indented;
        })
        .join('\n');
    } catch {
      return xml;
    }
  };

  const prettifyHTML = (html: string): string => {
    try {
      let indent = 0;
      return html
        .replace(/></g, '>\n<')
        .split('\n')
        .map(line => {
          const trimmed = line.trim();
          if (trimmed.match(/^<\//)) indent--;
          const indented = '  '.repeat(Math.max(0, indent)) + trimmed;
          if (trimmed.match(/^<\w[^>]*[^\/]>$/) || trimmed.match(/^<\w[^>]*>$/)) {
            if (!trimmed.match(/<\w[^>]*\/>/)) indent++;
          }
          return indented;
        })
        .join('\n');
    } catch {
      return html;
    }
  };

  const handlePrettify = (type: 'json' | 'xml' | 'html') => {
    const editor = useCodeEditorStore.getState().activeEditor.editor;
    if (!editor) {
      console.warn('[CommandPalette] No active CodeMirror editor found');
      return;
    }

    const content = editor.state.doc.toString();
    let prettified: string;

    try {
      switch (type) {
        case 'json':
          prettified = prettifyJSONC(content);
          break;
        case 'xml':
          prettified = prettifyXML(content);
          break;
        case 'html':
          prettified = prettifyHTML(content);
          break;
        default:
          return;
      }

      // Replace editor content
      editor.dispatch({
        changes: {
          from: 0,
          to: editor.state.doc.length,
          insert: prettified,
        },
      });

      // Update document store if this is a tracked document
      if (activeFilePath && !activeFilePath.endsWith('.void')) {
        useDocumentStore.getState().setDocument(activeFilePath, prettified);
      }
    } catch (error) {
      console.error(`[CommandPalette] Error prettifying ${type}:`, error);
    }
  };

  // File creation state
  const [isCreatingFile, setIsCreatingFile] = useState(false);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [createFileType, setCreateFileType] = useState<'void' | 'any'>('void');
  const [createFilePath, setCreateFilePath] = useState('');
  const [folders, setFolders] = useState<string[]>([]);
  const [currentSuggestion, setCurrentSuggestion] = useState<string>('');
  const [isCreating, setIsCreating] = useState(false);

  // Get active directory
  const { data: appState } = useGetAppState();
  const activeDirectory = appState?.activeDirectory;

  // Debounce search query so we don't fire an IPC call on every keystroke
  const [debouncedQuery, setDebouncedQuery] = useState(searchQuery);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery), 150);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Session id regenerated each time the files picker opens so the main-process
  // cache knows when to reload vs. reuse the previously-collected file list.
  // Cleanup closes the server-side session so it can release its cached paths.
  const sessionIdRef = useRef<string>('');
  useEffect(() => {
    if (!(isFocused && mode === 'files')) return;
    const sessionId = crypto.randomUUID();
    sessionIdRef.current = sessionId;
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window.electron?.files as any)?.flatListCloseSession?.(sessionId);
    };
  }, [isFocused, mode]);

  // Server fetch — runs on debounced query. Server fuzzy-scores the full file
  // list and returns ranked results with matched fragments attached, so the
  // client just maps into FileItem shape and renders.
  useEffect(() => {
    if (!isFocused || !activeDirectory || mode !== 'files') return;

    let cancelled = false;
    setIsLoadingFiles(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window.electron?.files as any)
        .flatList(activeDirectory, sessionIdRef.current, debouncedQuery || undefined)
        .then((list: {
          name: string;
          path: string;
          pathFragments?: MatchedFragment[];
          filenameFragments?: MatchedFragment[];
        }[]) => {
          if (cancelled) return;
          setIsLoadingFiles(false);
          if (!list) return;
          const incoming: FileItem[] = list.map((f) => {
            const normPath = f.path.replace(/\\/g, '/');
            const normDir = activeDirectory.replace(/\\/g, '/');
            const rel = normPath.startsWith(normDir)
                ? normPath.slice(normDir.length).replace(/^\//, '')
                : normPath;
            return {
              path: f.path,
              name: f.name,
              directory: normPath.split('/').slice(0, -1).join('/') || '/',
              relativePath: rel,
              pathFragments: f.pathFragments,
              filenameFragments: f.filenameFragments,
            };
          });
          startTransition(() => setFilteredFiles(incoming));

          // Update folder suggestions
          const folderSet = new Set<string>();
          for (const f of list) {
            const relative = f.path.startsWith(activeDirectory)
                ? f.path.slice(activeDirectory.length + 1)
                : f.path;
            const parts = relative.split('/');
            let prefix = '';
            for (let i = 0; i < parts.length - 1; i++) {
              prefix += parts[i] + '/';
              folderSet.add(prefix);
            }
          }
          setFolders((prev) => [...new Set([...prev, ...[...folderSet]])].sort());
        });

    return () => { cancelled = true; };
  }, [isFocused, activeDirectory, debouncedQuery, mode]);

  // Calculate autocomplete suggestion based on current input
  useEffect(() => {
    if (!createFilePath || (!isCreatingFile && !isCreatingFolder)) {
      setCurrentSuggestion('');
      return;
    }

    // Find the last slash to determine what we're completing
    const lastSlashIndex = createFilePath.lastIndexOf('/');
    const currentPath = lastSlashIndex >= 0 ? createFilePath.substring(0, lastSlashIndex + 1) : '';
    const currentFragment = lastSlashIndex >= 0 ? createFilePath.substring(lastSlashIndex + 1) : createFilePath;

    // If creating a file and the current fragment has an extension, don't suggest
    // (but always suggest for folder creation)
    if (isCreatingFile && currentFragment.includes('.')) {
      setCurrentSuggestion('');
      return;
    }

    // Find matching folders that start with the current path
    const matchingFolders = folders.filter(folder => {
      // For root level, match folders that start with the fragment
      if (currentPath === '') {
        return folder.toLowerCase().startsWith(currentFragment.toLowerCase());
      }

      // For nested paths, match folders that start with currentPath
      if (!folder.startsWith(currentPath)) return false;

      const remainingPath = folder.substring(currentPath.length);
      const nextSlashIndex = remainingPath.indexOf('/');
      const nextSegment = nextSlashIndex >= 0 ? remainingPath.substring(0, nextSlashIndex) : remainingPath;

      return nextSegment.toLowerCase().startsWith(currentFragment.toLowerCase());
    });

    if (matchingFolders.length > 0) {
      // Get the first matching folder
      const firstMatch = matchingFolders[0];

      if (currentPath === '') {
        // Root level - suggest the folder name with trailing slash
        const slashIndex = firstMatch.indexOf('/');
        const suggestion = slashIndex >= 0 ? firstMatch.substring(0, slashIndex + 1) : firstMatch;
        setCurrentSuggestion(suggestion);
      } else {
        // Nested level
        const remainingPath = firstMatch.substring(currentPath.length);
        const nextSlashIndex = remainingPath.indexOf('/');
        const suggestion = nextSlashIndex >= 0 ? remainingPath.substring(0, nextSlashIndex + 1) : remainingPath;
        setCurrentSuggestion(currentPath + suggestion);
      }
    } else {
      setCurrentSuggestion('');
    }
  }, [createFilePath, folders, isCreatingFile, isCreatingFolder]);

  // Define available commands
  const commands: Command[] = useMemo(() => [
    {
      id: 'create-voiden-file',
      label: 'Create New Voiden File',
      description: 'Create a new .void file in the project',
      icon: <FilePlus size={16} className="text-accent" />,
      action: () => {
        setCreateFileType('void');
        setIsCreatingFile(true);
        setCreateFilePath('');
        setSearchQuery('');
      },
    },
    {
      id: 'create-any-file',
      label: 'Create New File',
      description: 'Create a new file with any extension',
      icon: <File size={16} className="text-accent" />,
      action: () => {
        setCreateFileType('any');
        setIsCreatingFile(true);
        setCreateFilePath('');
        setSearchQuery('');
      },
    },
    {
      id: 'create-folder',
      label: 'Create New Folder',
      description: 'Create a new folder in the project',
      icon: <FolderPlus size={16} className="text-accent" />,
      action: () => {
        setIsCreatingFolder(true);
        setCreateFilePath('');
        setSearchQuery('');
      },
    },
    {
      id: 'new-terminal',
      label: 'New Terminal',
      description: 'Open a new terminal tab',
      icon: <Terminal size={16} className="text-accent" />,
      action: async () => {
        try {
          const result = await window.electron?.terminal.new('bottom');

          // Open the bottom panel
          if (bottomPanelRef?.current) {
            bottomPanelRef.current.expand();
          }
          openBottomPanel();

          // Invalidate queries to refresh the UI
          if (result?.panelId) {
            await queryClient.invalidateQueries({ queryKey: ['panel:tabs', result.panelId] });
            await queryClient.invalidateQueries({ queryKey: ['tab:content', result.panelId, result.tabId] });

            // Force a refetch to ensure UI updates
            await queryClient.refetchQueries({ queryKey: ['panel:tabs', result.panelId] });
          }

          onBlur();
        } catch (error) {
          console.error('Failed to create terminal:', error);
        }
      },
    },
    {
      id: 'open-settings',
      label: 'Open Settings',
      description: 'Open application settings',
      icon: <Settings size={16} className="text-accent" />,
      action: () => {
        addPanelTab({
          panelId: 'main',
          tab: { id: crypto.randomUUID(), type: 'settings', title: 'Settings', source: null },
        });
        onBlur();
      },
    },
    // Prettify commands
    {
      id: 'prettify-json',
      label: 'Prettify JSON',
      description: 'Format JSON in the current editor',
      icon: <Sparkles size={16} className="text-accent" />,
      action: () => {
        handlePrettify('json');
        onBlur();
      },
    },
    {
      id: 'prettify-xml',
      label: 'Prettify XML',
      description: 'Format XML in the current editor',
      icon: <Sparkles size={16} className="text-accent" />,
      action: () => {
        handlePrettify('xml');
        onBlur();
      },
    },
    {
      id: 'prettify-html',
      label: 'Prettify HTML',
      description: 'Format HTML in the current editor',
      icon: <Sparkles size={16} className="text-accent" />,
      action: () => {
        handlePrettify('html');
        onBlur();
      },
    },
    // Help commands
    {
      id: 'help-headers',
      label: 'Help: HTTP Headers',
      description: 'Learn about HTTP headers and how to use them',
      icon: <HelpCircle size={16} className="text-accent" />,
      action: () => {
        onShowHelp('HTTP Headers', <HttpHeadersHelp />);
        setTimeout(() => onBlur(), 0);
      },
    },
    {
      id: 'help-query-params',
      label: 'Help: Query Parameters',
      description: 'Learn about query parameters and how to use them',
      icon: <HelpCircle size={16} className="text-accent" />,
      action: () => {
        onShowHelp('Query Parameters', <HttpQueryParamsHelp />);
        setTimeout(() => onBlur(), 0);
      },
    },
    {
      id: 'help-url-form',
      label: 'Help: URL-Encoded Form',
      description: 'Learn about URL-encoded form data',
      icon: <HelpCircle size={16} className="text-accent" />,
      action: () => {
        onShowHelp('URL-Encoded Form', <HttpUrlFormHelp />);
        setTimeout(() => onBlur(), 0);
      },
    },
    {
      id: 'help-multipart-form',
      label: 'Help: Multipart Form',
      description: 'Learn about multipart form data and file uploads',
      icon: <HelpCircle size={16} className="text-accent" />,
      action: () => {
        onShowHelp('Multipart Form', <HttpMultipartFormHelp />);
        setTimeout(() => onBlur(), 0);
      },
    },
    {
      id: 'help-path-params',
      label: 'Help: Path Parameters',
      description: 'Learn about path parameters in URLs',
      icon: <HelpCircle size={16} className="text-accent" />,
      action: () => {
        onShowHelp('Path Parameters', <HttpPathParamsHelp />);
        setTimeout(() => onBlur(), 0);
      },
    },
    {
      id: 'help-json-body',
      label: 'Help: JSON Body',
      description: 'Learn about sending JSON request bodies',
      icon: <HelpCircle size={16} className="text-accent" />,
      action: () => {
        onShowHelp('JSON Body', <HttpJsonBodyHelp />);
        setTimeout(() => onBlur(), 0);
      },
    },
    {
      id: 'help-xml-body',
      label: 'Help: XML Body',
      description: 'Learn about sending XML request bodies',
      icon: <HelpCircle size={16} className="text-accent" />,
      action: () => {
        onShowHelp('XML Body', <HttpXmlBodyHelp />);
        setTimeout(() => onBlur(), 0);
      },
    },
    {
      id: 'help-runtime-variables',
      label: 'Help: Runtime Variables',
      description: 'Learn about capturing values from responses',
      icon: <HelpCircle size={16} className="text-accent" />,
      action: () => {
        onShowHelp('Runtime Variables', <RuntimeVariablesHelp />);
        setTimeout(() => onBlur(), 0);
      },
    },
    {
      id: 'help-simple-assertions',
      label: 'Help: Assertions',
      description: 'Learn about validating API responses with assertions',
      icon: <HelpCircle size={16} className="text-accent" />,
      action: () => {
        onShowHelp('Simple Assertions', <SimpleAssertionsHelp />);
        setTimeout(() => onBlur(), 0);
      },
    },
  ], [addPanelTab, bottomPanelRef, openBottomPanel, queryClient, onBlur, onShowHelp, activeFilePath]);

  const [filteredCommands, setFilteredCommands] = useState<Command[]>(commands);

  // Filter commands based on search query
  useEffect(() => {
    if (mode !== 'commands') return;

    if (!searchQuery.trim()) {
      setFilteredCommands(commands);
      setSelectedIndex(0);
      return;
    }

    const query = searchQuery.toLowerCase();
    const filtered = commands.filter((cmd) =>
      cmd.label.toLowerCase().includes(query) ||
      cmd.description.toLowerCase().includes(query)
    );

    setFilteredCommands(filtered);
    setSelectedIndex(0);
  }, [searchQuery, mode, commands]);

  // Focus input when palette opens
  useEffect(() => {
    if (isFocused) {
      inputRef.current?.focus();
      inputRef.current?.select();
      if (!isCreatingFile) {
        setIsCreatingFile(false);
      }
    }
  }, [isFocused]);

  // Focus input when entering file creation mode
  useEffect(() => {
    if (isCreatingFile && inputRef.current) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
    }
  }, [isCreatingFile]);

  // Focus input when entering folder creation mode
  useEffect(() => {
    if (isCreatingFolder && inputRef.current) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
    }
  }, [isCreatingFolder]);

  // Show/hide dropdown based on focus
  useEffect(() => {
    setShowDropdown(isFocused);
  }, [isFocused]);


  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (isCreatingFile) {
        setIsCreatingFile(false);
        setSearchQuery('');
      } else {
        setSearchQuery('');
        inputRef.current?.blur();
        onBlur();
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const maxIndex = mode === 'commands' ? filteredCommands.length - 1 : filteredFiles.length - 1;
      setSelectedIndex((prev) => Math.min(prev + 1, maxIndex));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (mode === 'commands' && !isCreatingFile) {
        if (filteredCommands[selectedIndex]) {
          filteredCommands[selectedIndex].action();
        }
      } else if (mode === 'files' && filteredFiles[selectedIndex]) {
        openFile(filteredFiles[selectedIndex]);
      }
    }
  };

  // Handle keyboard for file creation
  const handleFileCreationKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {

    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setIsCreatingFile(false);
      setIsCreatingFolder(false);
      setCreateFilePath('');
      setSearchQuery('');
      inputRef.current?.blur();
      onBlur();
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      // Accept the current suggestion
      if (currentSuggestion && currentSuggestion.length > createFilePath.length) {
        setCreateFilePath(currentSuggestion);
      }
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (!isCreating) {
        if (isCreatingFolder) {
          handleCreateFolder();
        } else {
          handleCreateFile();
        }
      }
      return;
    }
  };

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current) {
      const selectedElement = listRef.current.children[selectedIndex] as HTMLElement;
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [selectedIndex]);

  const openFile = async (file: FileItem) => {
    try {
      const content = await window.electron?.files?.read(file.path);

      addPanelTab({
        panelId: 'main',
        tab: {
          id: crypto.randomUUID(),
          type: 'document',
          title: file.name,
          source: file.path,
          content: content || '',
        },
      });

      // Clear search and blur
      setSearchQuery('');
      inputRef.current?.blur();
      onBlur();
    } catch (error) {
      console.error('[CommandPalette] Error opening file:', error);
    }
  };

  const handleCreateFolder = async () => {
    const projectPath = activeDirectory;
    const rawInputPath = createFilePath.trim();
    if (!projectPath || !rawInputPath || isCreating) return;

    setIsCreating(true);

    try {
      const normalizedPath = rawInputPath
        .replace(/\\/g, '/')
        .replace(/^\.?\//, '')
        .replace(/\/+/g, '/')
        .replace(/\/$/, '');

      // Parse the path - extract parent folder and new folder name
      const lastSlashIndex = normalizedPath.lastIndexOf('/');
      let parentPath: string;
      let folderName: string;

      if (lastSlashIndex === -1) {
        // No slash - creating folder in project root
        parentPath = projectPath;
        folderName = normalizedPath;
      } else {
        // Has slash - extract parent path and folder name
        const relativePath = normalizedPath.substring(0, lastSlashIndex);
        parentPath = `${projectPath}/${relativePath}`;
        folderName = normalizedPath.substring(lastSlashIndex + 1);
      }

      if (!folderName) {
        setIsCreating(false);
        return;
      }

      await window.electron?.files.createDirectory(parentPath, folderName);

      // Invalidate file tree to refresh
      await queryClient.invalidateQueries({ queryKey: ['files:tree'] });

      // Reset and close
      setIsCreatingFolder(false);
      setCreateFilePath('');
      setSearchQuery('');
      setIsCreating(false);
      onBlur();
    } catch (error) {
      console.error('[CommandPalette] Error creating folder:', error);
      setIsCreating(false);
    }
  };

  const handleCreateFile = async () => {
    const projectPath = activeDirectory;
    const rawInputPath = createFilePath.trim();
    if (!projectPath || !rawInputPath || isCreating) return;

    setIsCreating(true);

    try {
      const normalizedPath = rawInputPath
        .replace(/\\/g, '/')
        .replace(/^\.?\//, '')
        .replace(/\/+/g, '/')
        .replace(/\/$/, '');

      // Parse the path - extract folder and filename
      const lastSlashIndex = normalizedPath.lastIndexOf('/');
      let folderPath: string;
      let fileName: string;

      if (lastSlashIndex >= 0) {
        // Has a folder path
        const relativeFolderPath = normalizedPath.substring(0, lastSlashIndex);
        fileName = normalizedPath.substring(lastSlashIndex + 1);
        folderPath = relativeFolderPath ? `${projectPath}/${relativeFolderPath}` : projectPath;
      } else {
        // No folder path, create in root
        folderPath = projectPath;
        fileName = normalizedPath;
      }

      if (!fileName) {
        setIsCreating(false);
        return;
      }

      // Handle extension based on file type
      if (createFileType === 'void') {
        // For Voiden files, always add .void extension (even if they provided another extension)
        fileName = `${fileName}.void`;
      } else {
        // For any file, user must provide extension - if not, show error
        if (!fileName.includes('.')) {
          console.error('[Create File] No extension provided for generic file');
          setIsCreating(false);
          return;
        }
      }

      const result = createFileType === 'void'
        ? await window.electron?.files.createVoid(folderPath, fileName)
        : await window.electron?.files.create(folderPath, fileName);

      await queryClient.invalidateQueries({ queryKey: ['files:tree'] });

      if (result?.path) {
        // Open the newly created file
        addPanelTab({
          panelId: 'main',
          tab: {
            id: crypto.randomUUID(),
            type: 'document',
            title: result.name,
            source: result.path,
            content: '',
          },
        });
      }

      // Reset and close
      setIsCreatingFile(false);
      setCreateFilePath('');
      setSearchQuery('');
      setIsCreating(false);
      onBlur();
    } catch (error) {
      console.error('[CommandPalette] Error creating file:', error);
      setIsCreating(false);
    }
  };

  // Don't render anything if not focused
  if (!isFocused) {
    return null;
  }

  // Folder creation mode
  if (isCreatingFolder) {
    const handleBackdropClick = () => {
      setIsCreatingFolder(false);
      setCreateFilePath('');
      onBlur();
    };

    return (
      <div className="fixed inset-0 z-[10001] flex items-start justify-center pt-[20vh] bg-black/50" onClick={handleBackdropClick}>
        <div className="w-full max-w-2xl mx-4" onClick={(e) => e.stopPropagation()}>
          {/* Create Folder Form */}
          <div className="bg-editor border border-border rounded-lg shadow-lg">
            <div className="flex items-center gap-3 py-3 px-4 border-b border-border">
              <FolderPlus size={16} className="text-accent flex-shrink-0" />
              <span className="text-sm font-medium text-text">Create New Folder</span>
            </div>

            {/* Single input with autocomplete */}
            <div className="p-4">
              <label className="text-xs text-comment mb-2 block">Folder path (Tab to autocomplete parent folders)</label>
              <div className="relative flex items-center gap-2 bg-bg rounded px-3 py-2 border border-border">
                <Folder size={14} className="text-comment flex-shrink-0" />
                <div className="flex-1 relative">
                  {/* Suggestion overlay */}
                  {currentSuggestion && currentSuggestion.length > createFilePath.length && (
                    <div className="absolute inset-0 pointer-events-none text-sm">
                      <span className="text-transparent">{createFilePath}</span>
                      <span className="text-accent/50">{currentSuggestion.substring(createFilePath.length)}</span>
                    </div>
                  )}

                  {/* Actual input */}
                  <input
                    ref={inputRef}
                    type="text"
                    value={createFilePath}
                    onChange={(e) => setCreateFilePath(e.target.value)}
                    onKeyDown={handleFileCreationKeyDown}
                    placeholder="parentfolder/newfoldername"
                    className="w-full bg-transparent outline-none text-sm text-text relative z-10"
                    autoComplete="off"
                  />
                </div>
              </div>
              <p className="text-xs text-comment mt-2">
                Press <kbd className="px-1 py-0.5 rounded bg-bg border border-border text-xs">Tab</kbd> to autocomplete, <kbd className="px-1 py-0.5 rounded bg-bg border border-border text-xs">Enter</kbd> to create, <kbd className="px-1 py-0.5 rounded bg-bg border border-border text-xs">ESC</kbd> to cancel
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // File creation mode
  if (isCreatingFile) {
    const handleBackdropClick = () => {
      setIsCreatingFile(false);
      setCreateFilePath('');
      onBlur();
    };

    return (
      <div className="fixed inset-0 z-[10001] flex items-start justify-center pt-[20vh] bg-black/50" onClick={handleBackdropClick}>
        <div className="w-full max-w-2xl mx-4" onClick={(e) => e.stopPropagation()}>
          {/* Create File Form */}
          <div className="bg-editor border border-border rounded-lg shadow-lg">
            <div className="flex items-center gap-3 py-3 px-4 border-b border-border">
              {createFileType === 'void' ? (
                <FilePlus size={16} className="text-accent flex-shrink-0" />
              ) : (
                <File size={16} className="text-accent flex-shrink-0" />
              )}
              <span className="text-sm font-medium text-text">
                {createFileType === 'void' ? 'Create New Voiden File' : 'Create New File'}
              </span>
            </div>

            {/* Single input with autocomplete */}
            <div className="p-4">
              <label className="text-xs text-comment mb-2 block">
                File path (Tab to autocomplete folders)
                {createFileType === 'any' && <span className="text-accent ml-1">- Extension required</span>}
              </label>
              <div className="relative flex items-center gap-2 bg-bg rounded px-3 py-2 border border-border">
                <File size={14} className="text-comment flex-shrink-0" />
                <div className="flex-1 relative">
                  {/* Suggestion overlay */}
                  {currentSuggestion && currentSuggestion.length > createFilePath.length && (
                    <div className="absolute inset-0 pointer-events-none text-sm">
                      <span className="text-transparent">{createFilePath}</span>
                      <span className="text-accent/50">{currentSuggestion.substring(createFilePath.length)}</span>
                    </div>
                  )}

                  {/* Actual input */}
                  <input
                    ref={inputRef}
                    type="text"
                    value={createFilePath}
                    onChange={(e) => setCreateFilePath(e.target.value)}
                    onKeyDown={handleFileCreationKeyDown}
                    placeholder={createFileType === 'void' ? 'folder/subfolder/filename' : 'folder/subfolder/filename.ext'}
                    className="w-full bg-transparent outline-none text-sm text-text relative z-10"
                    autoComplete="off"
                  />
                </div>
              </div>
              <p className="text-xs text-comment mt-2">
                {createFileType === 'void' ? (
                  <>Will auto-add <code className="text-accent">.void</code> extension. </>
                ) : (
                  <>Must include file extension. </>
                )}
                Press <kbd className="px-1 py-0.5 rounded bg-bg border border-border text-xs">Tab</kbd> to autocomplete, <kbd className="px-1 py-0.5 rounded bg-bg border border-border text-xs">Enter</kbd> to create, <kbd className="px-1 py-0.5 rounded bg-bg border border-border text-xs">ESC</kbd> to cancel
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[10001] flex items-start justify-center pt-[20vh] bg-black/50" onClick={onBlur}>
      <div className="w-full max-w-2xl mx-4" onClick={(e) => e.stopPropagation()}>
        {/* Search Bar */}
        <div className="flex items-center gap-3 py-3 px-4 bg-editor border border-border rounded-t-lg">
          <Search size={16} className="text-comment flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={onFocus}
            placeholder={mode === 'commands' ? 'Search commands...' : 'Search files...'}
            className="flex-1 bg-transparent outline-none text-sm text-text placeholder:text-comment"
            autoComplete="off"
          />
          <span className="text-xs text-comment">ESC to close</span>
        </div>

        {/* Dropdown Results */}
        <div className="bg-editor border-x border-b border-border rounded-b-lg shadow-lg max-h-[400px] overflow-hidden">
          <div
            ref={listRef}
            className="max-h-[400px] overflow-y-auto overflow-x-hidden"
          >
            {mode === 'commands' ? (
              // Command mode
              filteredCommands.length === 0 ? (
                <div className="px-4 py-4 text-center text-comment text-sm">
                  No commands found
                </div>
              ) : (
                filteredCommands.map((command, index) => (
                  <button
                    key={command.id}
                    className={cn(
                      'flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors w-full text-left',
                      index === selectedIndex
                        ? 'bg-active border-l-2 border-accent'
                        : 'hover:bg-active/50 border-l-2 border-transparent'
                    )}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      command.action();
                    }}
                    onMouseEnter={() => setSelectedIndex(index)}
                  >
                    {command.icon}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-text">{command.label}</div>
                      <div className="text-xs text-comment">{command.description}</div>
                    </div>
                  </button>
                ))
              )
            ) : (
              // File search mode
              <>
                {filteredFiles.length === 0 && !isLoadingFiles && (
                  <div className="px-4 py-4 text-center text-comment text-sm">
                    No files found
                  </div>
                )}
                {filteredFiles.length === 0 && isLoadingFiles && (
                  <div className="flex flex-col gap-2 items-center justify-center py-8">
                    <svg className="animate-spin h-5 w-5 text-accent" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                    </svg>
                    Loading files...
                  </div>
                )}
                {filteredFiles.map((file, index) => (
                  <button
                    key={file.path}
                    className={cn(
                      'flex items-center gap-3 px-4 py-2 cursor-pointer transition-colors w-full text-left',
                      index === selectedIndex
                        ? 'bg-active border-l-2 border-accent'
                        : 'hover:bg-active/50 border-l-2 border-transparent'
                    )}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      openFile(file);
                    }}
                    onMouseEnter={() => setSelectedIndex(index)}
                  >
                    <File size={16} className="text-comment flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-text truncate">{highlightText(file.name, file.filenameFragments)}</div>
                      {(() => {
                        const relDir = file.relativePath.includes('/')
                          ? file.relativePath.slice(0, file.relativePath.lastIndexOf('/'))
                          : '';
                        return relDir ? (
                          <div className="text-xs text-comment truncate flex items-center gap-1">
                            <Folder size={12} className="flex-shrink-0" />
                            {highlightText(relDir, file.pathFragments)}
                          </div>
                        ) : null;
                      })()}
                    </div>
                  </button>
                ))}
                {filteredFiles.length > 0 && isLoadingFiles && (
                  <div className="flex items-center justify-center gap-2 py-2 text-xs text-comment border-t border-border">
                    <svg className="animate-spin h-3 w-3 text-accent" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                    </svg>
                    Searching…
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
