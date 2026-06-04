import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useOpenProject, useSetActiveProject } from "@/core/projects/hooks";

export function EmptyState() {
  const [isNewProjectMode, setIsNewProjectMode] = useState(false);

  if (isNewProjectMode) {
    return <NewProjectInput onCancel={() => setIsNewProjectMode(false)} />;
  }

  return <EmptyPlaceholder onCreate={() => setIsNewProjectMode(true)} />;
}

function EmptyPlaceholder({ onCreate }: { onCreate: () => void }) {
  const { mutateAsync: openProject } = useOpenProject();
  return (
    <div className="flex flex-col h-full w-full px-4 py-2 gap-4">
      <div className="text-sm text-text flex flex-col gap-2 mt-4">
        Create a new Voiden project to get started.
        <button
          style={{ maxWidth: "200px" }}
          className="bg-button-primary hover:bg-button-primary-hover rounded transition px-2 py-1"
          onClick={onCreate}
        >
          New Voiden project
        </button>
      </div>
      <div className="text-sm text-text flex flex-col gap-2 mt-4">
        Or open an existing project.
        <button
          style={{ maxWidth: "200px" }}
          className="bg-button-primary hover:bg-button-primary-hover transition px-2 py-1"
          onClick={() => openProject("~/")}
        >
          Open a project
        </button>
      </div>
    </div>
  );
}

function NewProjectInput({ onCancel }: { onCancel: () => void }) {
  const queryClient = useQueryClient();
  const { mutateAsync: setActiveProject } = useSetActiveProject();
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    setError(null);
  }, []);

  const submit = async (value: string) => {
    const trimmed = value.trim();
    if (trimmed === "") {
      onCancel();
      setName("");
      return;
    }
    try {
      const result = await window.electron?.files.createProjectDirectory(trimmed);
      if (!result) {
        throw new Error("Project directory creation failed: Electron API unavailable or unknown error.");
      }
      await setActiveProject(result);
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["app:state"] });
      onCancel();
      setName("");
    } catch (e) {
      setError((e as Error).message || "Error creating project");
      setName(trimmed);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="flex flex-col h-full w-full p-2">
      <div className="flex flex-col">
        <input
          autoFocus
          ref={inputRef}
          type="text"
          className={`px-2 py-1 border rounded h-7 bg-stone-800 text-stone-200 focus:outline-none focus:ring-1 ${error ? "border-red-500 focus:ring-red-500" : "border-stone-700 focus:ring-orange-500"
            }`}
          placeholder="Enter new project name..."
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          onBlur={(e) => {
            if (!error) submit(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              submit(name);
            } else if (e.key === "Escape") {
              onCancel();
              setName("");
              setError(null);
            }
          }}
          onClick={(e) => e.stopPropagation()}
        />
        {error && <span className="text-red-500 text-xs mt-1">{error}</span>}
      </div>
    </div>
  );
}
