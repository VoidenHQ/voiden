import { memo } from "react";

const statuses: Record<string, { label: string; className: string }> = {
  M: { label: "Modified", className: "text-vcs-modified" },
  U: { label: "Untracked", className: "text-vcs-added" },
  A: { label: "Added", className: "text-vcs-added" },
  D: { label: "Deleted", className: "text-vcs-removed" },
  R: { label: "Renamed", className: "text-vcs-modified" },
  C: { label: "Copied", className: "text-vcs-added" },
  T: { label: "Type changed", className: "text-vcs-modified" },
};

export const GitFileStatusBadge = memo(({ code }: { code?: string }) => {
  const status = code ? statuses[code] : undefined;
  if (!status) return null;
  return (
    <span
      className={`w-3 text-center font-mono text-[11px] font-semibold flex-shrink-0 ${status.className}`}
      title={status.label}
      aria-label={status.label}
    >
      {code}
    </span>
  );
});
