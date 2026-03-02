import { useState, useEffect, useRef, useMemo } from "react";
import { ChevronRight, ChevronDown, Plus, Trash2, FolderPlus, EyeOff, Eye, Tag } from "lucide-react";
import { VariableRow } from "./VariableRow";
import { handleTreeKeyDown } from "./envNavigation";
import { genVarId, generateUniqueName, renameKey } from "./envTreeUtils";
import { Tip } from "@/core/components/ui/Tip";

const FOCUS_ITEM_CLASS = "outline-none rounded -mx-1 px-1 focus:bg-active";

export interface EditableVariable {
  id: string;
  key: string;
  value: string;
  isPrivate: boolean;
}

export interface EditableEnvNode {
  variables: EditableVariable[];
  children: Record<string, EditableEnvNode>;
  intermediate?: boolean;
  displayName?: string;
}

export interface ExpandSignal {
  action: "expand" | "collapse";
  counter: number;
}

interface EnvironmentNodeProps {
  name: string;
  node: EditableEnvNode;
  path: string;
  depth: number;
  initialEditing?: boolean;
  expandSignal?: ExpandSignal | null;
  searchTerm?: string;
  highlightTarget?: { varKey: string; envPath: string } | null;
  onUpdate: (node: EditableEnvNode) => void;
  onDelete: () => void;
  onRename: (newName: string) => void;
}

export const EnvironmentNode = ({
  name,
  node,
  path,
  depth,
  initialEditing = false,
  expandSignal = null,
  searchTerm,
  highlightTarget,
  onUpdate,
  onDelete,
  onRename,
}: EnvironmentNodeProps) => {
  const [expanded, setExpanded] = useState(true);
  const [isEditing, setIsEditing] = useState(initialEditing);
  const [editName, setEditName] = useState(initialEditing ? "" : name);
  const [isEditingDisplayName, setIsEditingDisplayName] = useState(false);
  const [editDisplayName, setEditDisplayName] = useState(node.displayName ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newChildName, setNewChildName] = useState<string | null>(null);
  const [varsExpanded, setVarsExpanded] = useState(true);
  const headerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!expandSignal) return;
    const open = expandSignal.action === "expand";
    setExpanded(open);
    setVarsExpanded(open);
  }, [expandSignal]);

  const hasChildren = Object.keys(node.children).length > 0;

  // Auto-expand all sections when a search term is active
  useEffect(() => {
    if (searchTerm) {
      setExpanded(true);
      setVarsExpanded(true);
    }
  }, [searchTerm]);

  // Auto-expand when the highlight target is in this node or its descendants
  useEffect(() => {
    if (!highlightTarget) return;
    const { varKey, envPath } = highlightTarget;
    // Check if this node is the target, or a global (empty) envPath matches any node
    const isTarget = envPath === "" || envPath === path;
    const hasVar = isTarget && node.variables.some((v) => v.key === varKey);
    // Check descendants only when envPath starts with this node's path
    const targetIsDescendant = envPath.startsWith(path + ".");
    if (hasVar || targetIsDescendant) {
      setExpanded(true);
      if (hasVar) setVarsExpanded(true);
    }
  }, [highlightTarget, node, path]);

  // Auto-expand variables when the node is expanded and has no children
  useEffect(() => {
    if (expanded && !hasChildren) {
      setVarsExpanded(true);
    }
  }, [expanded, hasChildren]);

  const handleRename = () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== name) {
      onRename(trimmed);
    } else if (!trimmed && initialEditing) {
      onDelete();
      return;
    } else {
      setEditName(name);
    }
    setIsEditing(false);
  };

  const [focusVarId, setFocusVarId] = useState<string | null>(null);

  const handleAddVariable = () => {
    const newId = genVarId();
    setVarsExpanded(true);
    setFocusVarId(newId);
    onUpdate({
      ...node,
      variables: [...node.variables, { id: newId, key: "", value: "", isPrivate: false }],
    });
  };

  const handleUpdateVariable = (index: number, updates: Partial<EditableVariable>) => {
    const newVars = [...node.variables];
    newVars[index] = { ...newVars[index], ...updates };
    onUpdate({ ...node, variables: newVars });
  };

  const handleDeleteVariable = (index: number) => {
    const newVars = node.variables.filter((_, i) => i !== index);
    onUpdate({ ...node, variables: newVars });
  };

  const handleToggleIntermediate = () => {
    onUpdate({ ...node, intermediate: !node.intermediate });
  };

  const handleCommitDisplayName = () => {
    const trimmed = editDisplayName.trim();
    const newVal = trimmed || undefined;
    if (newVal !== node.displayName) {
      onUpdate({ ...node, displayName: newVal });
    }
    setIsEditingDisplayName(false);
  };

  const handleAddChild = () => {
    const childName = generateUniqueName(node.children);
    setNewChildName(childName);
    setExpanded(true);
    onUpdate({
      ...node,
      children: {
        ...node.children,
        [childName]: { variables: [], children: {} },
      },
    });
  };

  const handleUpdateChild = (childName: string, childNode: EditableEnvNode) => {
    onUpdate({
      ...node,
      children: { ...node.children, [childName]: childNode },
    });
  };

  const handleDeleteChild = (childName: string) => {
    const { [childName]: _, ...rest } = node.children;
    onUpdate({ ...node, children: rest });
  };

  const handleRenameChild = (oldName: string, newName: string) => {
    if (oldName === newName || node.children[newName]) return;
    onUpdate({ ...node, children: renameKey(node.children, oldName, newName) });
  };

  const handleDelete = () => {
    if (hasChildren || node.variables.length > 0) {
      if (!confirmDelete) {
        setConfirmDelete(true);
        return;
      }
    }
    onDelete();
  };

  // Keyboard: env header
  const handleHeaderKeyDown = (e: React.KeyboardEvent) => {
    if (isEditing || !headerRef.current) return;
    if (handleTreeKeyDown(e, headerRef.current, expanded, setExpanded)) return;
    if (e.key === "Enter") {
      e.preventDefault();
      setEditName(name);
      setIsEditing(true);
    }
  };

  // Keyboard: variables sub-header
  const handleVarsHeaderKeyDown = (e: React.KeyboardEvent) => {
    handleTreeKeyDown(e, e.currentTarget as HTMLElement, varsExpanded, setVarsExpanded);
  };

  const statsLabel = useMemo(() => {
    const varCount = node.variables.length;
    const childCount = Object.keys(node.children).length;
    const parts: string[] = [];
    if (varCount > 0) parts.push(`${varCount} var${varCount !== 1 ? "s" : ""}`);
    if (childCount > 0) parts.push(`${childCount} child${childCount !== 1 ? "ren" : ""}`);
    return parts.length > 0 ? `(${parts.join(", ")})` : "";
  }, [node.variables.length, node.children]);

  return (
    <div>
      {/* Header */}
      <div
        ref={headerRef}
        data-env-item
        tabIndex={-1}
        onKeyDown={handleHeaderKeyDown}
        className={`flex items-center gap-1 py-1.5 group ${FOCUS_ITEM_CLASS}`}
      >
        <button
          onClick={() => setExpanded(!expanded)}
          tabIndex={-1}
          className="p-0.5 rounded hover:bg-active transition-colors flex-shrink-0"
        >
          {expanded ? (
            <ChevronDown size={14} className="text-comment" />
          ) : (
            <ChevronRight size={14} className="text-comment" />
          )}
        </button>

        {isEditing ? (
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRename();
              if (e.key === "Escape") {
                setEditName(name);
                setIsEditing(false);
                // Return focus to the header row
                setTimeout(() => headerRef.current?.focus(), 0);
              }
            }}
            className="px-1 py-0.5 text-sm bg-editor border border-border rounded text-text focus:outline-none focus:ring-1"
            style={{ '--tw-ring-color': 'var(--icon-primary)' } as React.CSSProperties}
            autoFocus
          />
        ) : (
          <Tip label="Double-click to rename">
            <span
              className="text-sm font-medium text-text cursor-pointer hover:underline"
              onDoubleClick={() => {
                setEditName(name);
                setIsEditing(true);
              }}
            >
              {name}
            </span>
          </Tip>
        )}

        {isEditingDisplayName ? (
          <input
            type="text"
            value={editDisplayName}
            onChange={(e) => setEditDisplayName(e.target.value)}
            onBlur={handleCommitDisplayName}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCommitDisplayName();
              if (e.key === "Escape") {
                setEditDisplayName(node.displayName ?? "");
                setIsEditingDisplayName(false);
              }
            }}
            placeholder="Display name"
            className="px-1 py-0.5 text-xs bg-editor border border-border rounded text-comment focus:outline-none focus:ring-1 ml-1 w-32"
            style={{ '--tw-ring-color': 'var(--icon-primary)' } as React.CSSProperties}
            autoFocus
          />
        ) : node.displayName ? (
          <Tip label="Double-click to edit display name">
            <span
              className="text-xs text-comment ml-1 cursor-pointer hover:text-text"
              onDoubleClick={() => {
                setEditDisplayName(node.displayName ?? "");
                setIsEditingDisplayName(true);
              }}
            >
              &mdash; {node.displayName}
            </span>
          </Tip>
        ) : null}

        {node.intermediate && (
          <span className="text-xs text-comment ml-1 italic">hidden</span>
        )}
        <span className="text-xs text-comment ml-1">
          {statsLabel}
        </span>

        <div
          className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
          onMouseLeave={() => setConfirmDelete(false)}
        >
          <Tip label="Set display name">
            <button
              onClick={() => {
                setEditDisplayName(node.displayName ?? "");
                setIsEditingDisplayName(true);
              }}
              tabIndex={-1}
              className={`p-1 rounded hover:bg-active transition-colors ${node.displayName ? "opacity-100" : ""}`}
            >
              <Tag size={13} className={node.displayName ? "text-text" : "text-comment"} />
            </button>
          </Tip>
          <Tip label={node.intermediate ? "Show in env selector" : "Hide from env selector"}>
            <button
              onClick={handleToggleIntermediate}
              tabIndex={-1}
              className={`p-1 rounded hover:bg-active transition-colors ${node.intermediate ? "opacity-100" : ""}`}
            >
              {node.intermediate ? (
                <EyeOff size={13} style={{ color: 'var(--icon-warning)' }} />
              ) : (
                <Eye size={13} className="text-comment" />
              )}
            </button>
          </Tip>
          <Tip label="Add variable">
            <button
              onClick={handleAddVariable}
              tabIndex={-1}
              className="p-1 rounded hover:bg-active transition-colors"
            >
              <Plus size={13} className="text-comment" />
            </button>
          </Tip>
          <Tip label="Add child environment">
            <button
              onClick={handleAddChild}
              tabIndex={-1}
              className="p-1 rounded hover:bg-active transition-colors"
            >
              <FolderPlus size={13} className="text-comment" />
            </button>
          </Tip>
          {confirmDelete ? (
            <span className="flex items-center gap-1 text-xs ml-1">
              <button
                onClick={() => { onDelete(); setConfirmDelete(false); }}
                tabIndex={-1}
                className="px-1.5 py-0.5 rounded text-xs"
                style={{ backgroundColor: 'var(--icon-error)', color: 'var(--ui-bg)' }}
              >
                Delete
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                tabIndex={-1}
                className="px-1.5 py-0.5 rounded bg-panel hover:bg-active text-xs"
              >
                Cancel
              </button>
            </span>
          ) : (
            <Tip label="Delete environment">
              <button
                onClick={handleDelete}
                tabIndex={-1}
                className="p-1 rounded hover:bg-active transition-colors"
              >
                <Trash2 size={13} style={{ color: 'var(--icon-error)' }} />
              </button>
            </Tip>
          )}
        </div>
      </div>

      {/* Content */}
      {expanded && (
        <div className="ml-5 flex">
          <button
            onClick={() => setExpanded(false)}
            className="flex-shrink-0 px-1 cursor-pointer group/line"
            aria-label="Collapse"
          >
            <div className="w-px h-full bg-border group-hover/line:bg-text transition-colors" />
          </button>
          <div className="pl-3 space-y-1 pb-2 flex-1 min-w-0">
          {/* Variables (collapsible) — hidden when empty but env has children */}
          {!(node.variables.length === 0 && hasChildren) && <div>
            <div
              data-env-item
              tabIndex={-1}
              onKeyDown={handleVarsHeaderKeyDown}
              className={`flex items-center gap-1 py-1 group/vars ${FOCUS_ITEM_CLASS}`}
            >
              <button
                onClick={() => setVarsExpanded(!varsExpanded)}
                tabIndex={-1}
                className="p-0.5 rounded hover:bg-active transition-colors flex-shrink-0"
              >
                {varsExpanded ? (
                  <ChevronDown size={12} className="text-comment" />
                ) : (
                  <ChevronRight size={12} className="text-comment" />
                )}
              </button>
              <span className="text-xs text-comment font-medium">
                Variables ({node.variables.length})
              </span>
              <Tip label="Add variable">
                <button
                  onClick={handleAddVariable}
                  tabIndex={-1}
                  className="p-0.5 rounded hover:bg-active transition-colors opacity-0 group-hover/vars:opacity-100"
                >
                  <Plus size={12} className="text-comment" />
                </button>
              </Tip>
            </div>
            {varsExpanded && (
              <div className="ml-4 space-y-1">
                {node.variables.map((variable, index) => (
                  <VariableRow
                    key={variable.id}
                    varKey={variable.key}
                    value={variable.value}
                    isPrivate={variable.isPrivate}
                    autoFocusKey={variable.id === focusVarId}
                    highlighted={!!highlightTarget && variable.key === highlightTarget.varKey && (highlightTarget.envPath === "" || highlightTarget.envPath === path)}
                    onChangeKey={(newKey) => handleUpdateVariable(index, { key: newKey })}
                    onChangeValue={(newValue) => handleUpdateVariable(index, { value: newValue })}
                    onTogglePrivate={() => handleUpdateVariable(index, { isPrivate: !variable.isPrivate })}
                    onDelete={() => handleDeleteVariable(index)}
                    onAddNext={handleAddVariable}
                  />
                ))}
                {node.variables.length === 0 && (
                  <div className="text-xs text-comment py-1">
                    No variables.{" "}
                    <button onClick={handleAddVariable} className="underline hover:text-text">
                      Add one
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>}

          {/* Children */}
          {Object.entries(node.children).map(([childName, childNode]) => (
            <EnvironmentNode
              key={childName}
              name={childName}
              node={childNode}
              path={`${path}.${childName}`}
              depth={depth + 1}
              initialEditing={childName === newChildName}
              expandSignal={expandSignal}
              searchTerm={searchTerm}
              highlightTarget={highlightTarget}
              onUpdate={(updated) => handleUpdateChild(childName, updated)}
              onDelete={() => { handleDeleteChild(childName); setNewChildName(null); }}
              onRename={(newName) => { handleRenameChild(childName, newName); setNewChildName(null); }}
            />
          ))}
          </div>
        </div>
      )}
    </div>
  );
};
