import { useLayoutEffect, useRef, useState } from "react";
import { NodeApi } from "react-arborist";
import { ExtendedFileTree } from "./types";

interface RenameInputProps {
  node: NodeApi<ExtendedFileTree>;
  error: string | null;
  setError: (msg: string | null) => void;
  onSubmit: (newName: string) => void;
  setIsRenaming: (renaming: boolean) => void;
}

export function RenameInput({ node, error, setError, onSubmit, setIsRenaming }: RenameInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(node.data.name);

  useLayoutEffect(() => {
    setIsRenaming(true);
    setName(node.data.name);
    inputRef.current?.focus();
  }, [node.data.name, setIsRenaming]);

  return (
    <div className="flex flex-col flex-1">
      <input
        autoFocus
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onFocus={(e) => {
          if (node.data.type === "file") {
            const text = name.split(".")[0];
            e.target.setSelectionRange(0, text.length);
          }
          setError(null);
        }}
        onMouseDown={(e) => {
          e.stopPropagation();
        }}
        onBlur={(e) => onSubmit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "Escape") {
            onSubmit(name);
          }
        }}
        onClick={(e) => e.stopPropagation()}
        className={`px-1 py-0 border rounded h-5 bg-stone-800 text-stone-200 focus:outline-none focus:ring-1 ${error ? "border-red-500 focus:ring-red-500" : "border-stone-700 focus:ring-orange-500"
          }`}
      />
      {error && <span className="bg-red-500 text-xs text-white absolute top-7 left-12 p-1 rounded z-10">{error}</span>}
    </div>
  );
}
