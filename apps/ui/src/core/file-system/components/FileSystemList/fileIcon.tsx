import { Infinity as InfinityIcon, Info } from "lucide-react";
import { VSCodeFileIcon } from "@/core/lib/vscodeFileIcon";

export function getFileIcon(name: string, _path: string): JSX.Element {
  const lower = name.toLowerCase();

  // .void keeps Voiden's own icon — not part of the VS Code icon set.
  if (lower === ".voiden-inherited.void" || lower.endsWith(".void")) {
    return <InfinityIcon size={20} className="text-accent" />;
  }
  if (lower === "readme.md") return <Info size={20} style={{ color: "#519aba" }} />;

  return <VSCodeFileIcon name={name} size={20} />;
}
