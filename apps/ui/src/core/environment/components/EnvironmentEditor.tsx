import { useState, useEffect, useRef, useCallback } from "react";
import { Plus, Settings2, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useYamlEnvironments } from "../hooks/useYamlEnvironments.ts";
import { useSaveYamlEnvironments } from "../hooks/useSaveYamlEnvironments.ts";
import { EnvironmentNode, EditableEnvNode, ExpandSignal } from "./EnvironmentNode";
import { type EditableEnvTree, mergeToEditable, splitFromEditable } from "./envTreeUtils";

const DEBOUNCE_MS = 800;

const AddEnvironmentButton = ({ onClick }: { onClick: () => void }) => (
  <button
    onClick={onClick}
    className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md transition-colors hover:opacity-90"
    style={{ backgroundColor: 'var(--icon-primary)', color: 'var(--ui-bg)' }}
  >
    <Plus size={14} />
    Add Environment
  </button>
);

export const EnvironmentEditor = () => {
  const queryClient = useQueryClient();
  const { data, isLoading } = useYamlEnvironments();
  const { mutate: save } = useSaveYamlEnvironments();
  const [tree, setTree] = useState<EditableEnvTree>({});
  const [newRootName, setNewRootName] = useState<string | null>(null);
  const [expandSignal, setExpandSignal] = useState<ExpandSignal | null>(null);
  const expandCounterRef = useRef(0);
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);

  // Re-read from filesystem whenever this tab is opened or switched to
  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ["yaml-environments"] });
  }, [queryClient]);

  // Initialize from fetched data
  useEffect(() => {
    if (data && !dirtyRef.current) {
      const merged = mergeToEditable(data.public, data.private);
      setTree(merged);
    }
  }, [data]);

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Focus first item on arrow key if nothing is focused
  const handleContainerKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const active = document.activeElement;
      const hasItemFocus = active?.closest("[data-env-item]");
      if (!hasItemFocus && treeRef.current) {
        e.preventDefault();
        const first = treeRef.current.querySelector<HTMLElement>("[data-env-item]");
        first?.focus();
      }
    }
  }, []);

  // Debounced auto-save
  const scheduleSave = useCallback(
    (newTree: EditableEnvTree) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const { publicTree, privateTree } = splitFromEditable(newTree);
        save({ publicTree, privateTree });
      }, DEBOUNCE_MS);
    },
    [save]
  );

  const handleUpdateTree = useCallback(
    (newTree: EditableEnvTree) => {
      dirtyRef.current = true;
      setTree(newTree);
      scheduleSave(newTree);
    },
    [scheduleSave]
  );

  const handleAddRoot = () => {
    let envName = "new-environment";
    let counter = 1;
    while (tree[envName]) {
      envName = `new-environment-${counter++}`;
    }
    setNewRootName(envName);
    handleUpdateTree({
      ...tree,
      [envName]: { variables: [], children: {} },
    });
  };

  const handleUpdateNode = (name: string, node: EditableEnvNode) => {
    handleUpdateTree({ ...tree, [name]: node });
  };

  const handleDeleteNode = (name: string) => {
    const { [name]: _, ...rest } = tree;
    handleUpdateTree(rest);
  };

  const handleRenameNode = (oldName: string, newName: string) => {
    if (oldName === newName || tree[newName]) return;
    const entries = Object.entries(tree);
    const newTree: EditableEnvTree = {};
    for (const [key, val] of entries) {
      newTree[key === oldName ? newName : key] = val;
    }
    handleUpdateTree(newTree);
  };

  if (isLoading) {
    return (
      <div className="h-full w-full flex items-center justify-center text-comment">
        <div className="text-sm">Loading environments...</div>
      </div>
    );
  }

  const isEmpty = Object.keys(tree).length === 0;

  return (
    <div className="h-full w-full bg-editor text-text flex flex-col" onKeyDown={handleContainerKeyDown} tabIndex={-1}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <Settings2 size={16} style={{ color: 'var(--icon-primary)' }} />
          <h2 className="text-sm font-semibold">Environments</h2>
        </div>
        <div className="flex items-center gap-2">
          {!isEmpty && (
            <>
              <button
                onClick={() => setExpandSignal({ action: "expand", counter: ++expandCounterRef.current })}
                className="p-1.5 rounded hover:bg-active transition-colors text-comment hover:text-text"
                title="Expand all"
              >
                <ChevronsUpDown size={14} />
              </button>
              <button
                onClick={() => setExpandSignal({ action: "collapse", counter: ++expandCounterRef.current })}
                className="p-1.5 rounded hover:bg-active transition-colors text-comment hover:text-text"
                title="Collapse all"
              >
                <ChevronsDownUp size={14} />
              </button>
            </>
          )}
          <AddEnvironmentButton onClick={handleAddRoot} />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full text-comment">
            <Settings2 size={32} className="mb-3 opacity-50" />
            <p className="text-sm mb-1">No environments configured</p>
            <p className="text-xs mb-4">
              Environments let you define variables like API keys and base URLs.
            </p>
            <AddEnvironmentButton onClick={handleAddRoot} />
          </div>
        ) : (
          <div ref={treeRef} className="space-y-1 max-w-4xl" data-env-tree>
            {Object.entries(tree).map(([name, node]) => (
              <EnvironmentNode
                key={name}
                name={name}
                node={node}
                depth={0}
                initialEditing={name === newRootName}
                expandSignal={expandSignal}
                onUpdate={(updated) => handleUpdateNode(name, updated)}
                onDelete={() => { handleDeleteNode(name); setNewRootName(null); }}
                onRename={(newName) => { handleRenameNode(name, newName); setNewRootName(null); }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
