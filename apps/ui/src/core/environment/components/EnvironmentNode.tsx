import { useState, useEffect, useRef, useMemo } from "react";
import { ChevronRight, ChevronDown, Plus, Trash2, FolderPlus } from "lucide-react";
import { VariableRow } from "./VariableRow";
import { handleTreeKeyDown } from "./envNavigation";
import { genVarId } from "./envTreeUtils";

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
}

export interface ExpandSignal {
  action: "expand" | "collapse";
  counter: number;
}

interface EnvironmentNodeProps {
  name: string;
  node: EditableEnvNode;
  depth: number;
  initialEditing?: boolean;
  expandSignal?: ExpandSignal | null;
  onUpdate: (node: EditableEnvNode) => void;
  onDelete: () => void;
  onRename: (newName: string) => void;
}

export const EnvironmentNode = ({
  name,
  node,
  depth,
  initialEditing = false,
  expandSignal = null,
  onUpdate,
  onDelete,
  onRename,
}: EnvironmentNodeProps) => {
  const [expanded, setExpanded] = useState(true);
  const [isEditing, setIsEditing] = useState(initialEditing);
  const [editName, setEditName] = useState(initialEditing ? "" : name);
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

  const handleAddChild = () => {
    let childName = "new-environment";
    let counter = 1;
    while (node.children[childName]) {
      childName = `new-environment-${counter++}`;
    }
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
    const entries = Object.entries(node.children);
    const newChildren: Record<string, EditableEnvNode> = {};
    for (const [key, val] of entries) {
      newChildren[key === oldName ? newName : key] = val;
    }
    onUpdate({ ...node, children: newChildren });
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
          <span
            className="text-sm font-medium text-text cursor-pointer hover:underline"
            onDoubleClick={() => {
              setEditName(name);
              setIsEditing(true);
            }}
            title="Double-click to rename"
          >
            {name}
          </span>
        )}

        <span className="text-xs text-comment ml-1">
          {statsLabel}
        </span>

        <div
          className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
          onMouseLeave={() => setConfirmDelete(false)}
        >
          <button
            onClick={handleAddVariable}
            tabIndex={-1}
            className="p-1 rounded hover:bg-active transition-colors"
            title="Add variable"
          >
            <Plus size={13} className="text-comment" />
          </button>
          <button
            onClick={handleAddChild}
            tabIndex={-1}
            className="p-1 rounded hover:bg-active transition-colors"
            title="Add child environment"
          >
            <FolderPlus size={13} className="text-comment" />
          </button>
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
            <button
              onClick={handleDelete}
              tabIndex={-1}
              className="p-1 rounded hover:bg-active transition-colors"
              title="Delete environment"
            >
              <Trash2 size={13} style={{ color: 'var(--icon-error)' }} />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      {expanded && (
        <div className="ml-5 border-l border-border pl-3 space-y-1 pb-2">
          {/* Variables (collapsible) */}
          <div>
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
              <button
                onClick={handleAddVariable}
                tabIndex={-1}
                className="p-0.5 rounded hover:bg-active transition-colors opacity-0 group-hover/vars:opacity-100"
                title="Add variable"
              >
                <Plus size={12} className="text-comment" />
              </button>
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
          </div>

          {/* Children */}
          {Object.entries(node.children).map(([childName, childNode]) => (
            <EnvironmentNode
              key={childName}
              name={childName}
              node={childNode}
              depth={depth + 1}
              initialEditing={childName === newChildName}
              expandSignal={expandSignal}
              onUpdate={(updated) => handleUpdateChild(childName, updated)}
              onDelete={() => { handleDeleteChild(childName); setNewChildName(null); }}
              onRename={(newName) => { handleRenameChild(childName, newName); setNewChildName(null); }}
            />
          ))}
        </div>
      )}
    </div>
  );
};
