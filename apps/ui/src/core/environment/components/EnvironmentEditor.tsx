import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Plus, Settings2, ChevronsDownUp, ChevronsUpDown, ChevronDown, Trash2, Check, Search, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useYamlEnvironments, useEnvironments } from "@/core/environment/hooks";
import { useSaveYamlEnvironments } from "@/core/environment/hooks";
import { useProfiles } from "../hooks/useProfiles.ts";
import { useCreateProfile } from "@/core/environment/hooks";
import { useDeleteProfile } from "@/core/environment/hooks";
import { EnvironmentNode, EditableEnvNode, ExpandSignal } from "./EnvironmentNode";
import { Tip } from "@/core/components/ui/Tip";
import { type EditableEnvTree, mergeToEditable, splitFromEditable, generateUniqueName, renameKey, filterTree } from "./envTreeUtils";

const DEBOUNCE_MS = 800;
const PROFILE_NAME_REGEX = /^[a-z0-9][a-z0-9-]*$/;

// Persists the selected profile across tab switches (component mount/unmount cycles)
let rememberedProfile: string | null = null;

const ProfileSelector = ({
  selectedProfile,
  onSelectProfile,
}: {
  selectedProfile: string;
  onSelectProfile: (profile: string) => void;
}) => {
  const { data: profiles } = useProfiles();
  const { mutate: createProfile } = useCreateProfile();
  const { mutate: deleteProfile } = useDeleteProfile();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (creating && inputRef.current) inputRef.current.focus();
  }, [creating]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
        setCreating(false);
        setNewName("");
        setNameError(null);
      }
    };
    if (dropdownOpen) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropdownOpen]);

  const handleCreate = () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    if (!PROFILE_NAME_REGEX.test(trimmed)) {
      setNameError("Lowercase letters, numbers, and hyphens only");
      return;
    }
    if (trimmed === "default" || profiles?.includes(trimmed)) {
      setNameError("Profile already exists");
      return;
    }
    createProfile(trimmed);
    onSelectProfile(trimmed);
    setCreating(false);
    setNewName("");
    setNameError(null);
    setDropdownOpen(false);
  };

  const handleDelete = (profile: string) => {
    deleteProfile(profile);
    if (selectedProfile === profile) onSelectProfile("default");
    setDropdownOpen(false);
  };

  const displayName = selectedProfile === "default" ? "default" : selectedProfile;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setDropdownOpen(!dropdownOpen)}
        className="flex items-center gap-1 text-sm px-2 py-1 rounded hover:bg-active transition-colors text-comment hover:text-text"
      >
        <span>{displayName}</span>
        <ChevronDown size={12} />
      </button>

      {dropdownOpen && (
        <div className="absolute right-0 top-full mt-1 w-56 bg-panel border border-border rounded-lg shadow-lg z-50 overflow-hidden">
          {/* Profile list */}
          <div className="max-h-48 overflow-y-auto py-1">
            {profiles?.map((profile) => (
              <div
                key={profile}
                className="flex items-center px-3 py-1.5 text-sm hover:bg-active cursor-pointer group"
                onClick={() => {
                  onSelectProfile(profile);
                  setDropdownOpen(false);
                }}
              >
                <span className="flex-1 truncate">{profile}</span>
                {profile === selectedProfile && (
                  <Check size={14} className="flex-shrink-0 mr-1" style={{ color: 'var(--icon-success)' }} />
                )}
                {profile !== "default" && (
                  <Tip label={`Delete ${profile}`}>
                  <button
                    className="p-0.5 rounded hover:bg-border opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(profile);
                    }}
                  >
                    <Trash2 size={12} className="text-comment" />
                  </button>
                  </Tip>
                )}
              </div>
            ))}
          </div>

          {/* Create new */}
          <div className="border-t border-border px-3 py-2">
            {creating ? (
              <div>
                <input
                  ref={inputRef}
                  value={newName}
                  onChange={(e) => { setNewName(e.target.value); setNameError(null); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreate();
                    if (e.key === "Escape") { setCreating(false); setNewName(""); setNameError(null); }
                  }}
                  placeholder="profile-name"
                  className="w-full text-sm px-2 py-1 bg-editor border border-border rounded outline-none text-text placeholder:text-comment"
                />
                {nameError && <p className="text-xs mt-1" style={{ color: 'var(--icon-danger)' }}>{nameError}</p>}
              </div>
            ) : (
              <button
                onClick={() => setCreating(true)}
                className="flex items-center gap-1.5 text-sm text-comment hover:text-text transition-colors w-full"
              >
                <Plus size={14} />
                New profile
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

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
  const { data: envData } = useEnvironments();
  const [selectedProfile, setSelectedProfile] = useState<string>(
    rememberedProfile ?? envData?.activeProfile ?? "default"
  );
  const profileParam = selectedProfile === "default" ? undefined : selectedProfile;
  const { data, isLoading } = useYamlEnvironments(profileParam);
  const { mutate: save } = useSaveYamlEnvironments(profileParam);
  const [tree, setTree] = useState<EditableEnvTree>({});
  const [searchTerm, setSearchTerm] = useState("");
  const [newRootName, setNewRootName] = useState<string | null>(null);
  const [expandSignal, setExpandSignal] = useState<ExpandSignal | null>(null);
  const expandCounterRef = useRef(0);
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const treeDataRef = useRef<EditableEnvTree>({});
  const editorRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const isSearching = searchTerm.trim().length > 0;
  const displayTree = useMemo(
    () => (isSearching ? filterTree(tree, searchTerm.trim()) : tree),
    [tree, searchTerm, isSearching]
  );

  // Remember the selected profile so it persists across tab switches
  useEffect(() => {
    rememberedProfile = selectedProfile;
  }, [selectedProfile]);

  // Re-read from filesystem whenever this tab is opened or switched to
  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ["yaml-environments"] });
  }, [queryClient]);

  // Reset dirty flag when switching profiles so data reloads
  useEffect(() => {
    dirtyRef.current = false;
  }, [selectedProfile]);

  // Initialize from fetched data
  useEffect(() => {
    if (data && !dirtyRef.current) {
      const merged = mergeToEditable(data.public, data.private);
      setTree(merged);
      treeDataRef.current = merged;
    }
  }, [data]);

  // Keep a ref to the save function so the unmount cleanup always uses the latest
  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; }, [save]);

  // Flush any pending save on unmount instead of discarding it
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        const { publicTree, privateTree } = splitFromEditable(treeDataRef.current);
        saveRef.current({ publicTree, privateTree });
      }
    };
  }, []);

  // Cmd/Ctrl+F focuses search — works even without prior click into the editor
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "f" || !(e.metaKey || e.ctrlKey)) return;
      const el = editorRef.current;
      if (!el) return;
      // Only activate when the editor is visible and either has focus or nothing else claims it
      if (el.contains(document.activeElement) || document.activeElement === document.body) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Focus first item on arrow key if nothing is focused
  const handleContainerKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const active = document.activeElement;
      const hasItemFocus = active?.closest("[data-env-item]");
      if (!hasItemFocus && containerRef.current) {
        e.preventDefault();
        const first = containerRef.current.querySelector<HTMLElement>("[data-env-item]");
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
      treeDataRef.current = newTree;
      scheduleSave(newTree);
    },
    [scheduleSave]
  );

  const handleAddRoot = () => {
    const envName = generateUniqueName(tree);
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
    handleUpdateTree(renameKey(tree, oldName, newName));
  };

  if (isLoading) {
    return (
      <div className="h-full w-full flex items-center justify-center text-comment">
        <div className="text-sm">Loading environments...</div>
      </div>
    );
  }

  const isEmpty = Object.keys(tree).length === 0;
  const noResults = isSearching && Object.keys(displayTree).length === 0;

  return (
    <div ref={editorRef} className="h-full w-full bg-editor text-text flex flex-col" onKeyDown={handleContainerKeyDown} tabIndex={-1}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <Settings2 size={16} style={{ color: 'var(--icon-primary)' }} />
          <h2 className="text-sm font-semibold">Environments</h2>
        </div>
        <div className="flex items-center gap-2">
          <ProfileSelector selectedProfile={selectedProfile} onSelectProfile={setSelectedProfile} />
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

      {/* Search */}
      {!isEmpty && (
        <div className="px-5 pt-3 flex-shrink-0">
          <div className="relative max-w-sm">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-comment pointer-events-none" />
            <input
              ref={searchRef}
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setSearchTerm("");
                  editorRef.current?.focus();
                }
              }}
              placeholder="Search environments and variables..."
              className="w-full pl-8 pr-8 py-1.5 text-sm bg-panel border border-border rounded-md text-text placeholder:text-comment focus:outline-none focus:ring-1"
              style={{ '--tw-ring-color': 'var(--icon-primary)' } as React.CSSProperties}
            />
            {isSearching && (
              <button
                onClick={() => { setSearchTerm(""); searchRef.current?.focus(); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-active transition-colors"
              >
                <X size={14} className="text-comment" />
              </button>
            )}
          </div>
        </div>
      )}

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
        ) : noResults ? (
          <div className="flex flex-col items-center justify-center h-32 text-comment">
            <Search size={24} className="mb-2 opacity-50" />
            <p className="text-sm">No matches for &ldquo;{searchTerm.trim()}&rdquo;</p>
          </div>
        ) : (
          <div ref={containerRef} className="space-y-1 max-w-4xl" data-env-tree>
            {Object.entries(displayTree).map(([name, node]) => (
              <EnvironmentNode
                key={name}
                name={name}
                node={node}
                depth={0}
                initialEditing={name === newRootName}
                expandSignal={expandSignal}
                searchTerm={isSearching ? searchTerm.trim() : undefined}
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
