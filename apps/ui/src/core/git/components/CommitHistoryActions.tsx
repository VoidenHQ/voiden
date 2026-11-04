import type { ReactNode } from "react";
import { ArrowDown, CloudDownload, CloudUpload, LocateFixed, RefreshCw } from "lucide-react";
import { Tip } from "@/core/components/ui/Tip";
import { cn } from "@/core/lib/utils";

interface ActionButtonProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}

const ActionButton = ({ label, onClick, disabled, children }: ActionButtonProps) => (
  <Tip label={label} side="bottom" align="center">
    {/* Disabled buttons get no pointer events, so the wrapper carries the hover and the tooltip still shows. */}
    <span className="flex">
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        onClick={(e) => {
          // The header toggles the section on click; the buttons must not.
          e.stopPropagation();
          onClick();
        }}
        className="p-0.5 rounded text-comment hover:text-text hover:bg-active/50 disabled:opacity-40 disabled:pointer-events-none"
      >
        {children}
      </button>
    </span>
  </Tip>
);

interface CommitHistoryActionsProps {
  hasRemote: boolean;
  isFetching: boolean;
  isPulling: boolean;
  isPushing: boolean;
  isRefreshing: boolean;
  onGoToCurrent: () => void;
  onFetch: () => void;
  onPull: () => void;
  onPush: () => void;
  onRefresh: () => void;
}

/** Icon actions on the Commit History header, like the toolbar on VS Code's Graph view. */
export const CommitHistoryActions = ({
  hasRemote,
  isFetching,
  isPulling,
  isPushing,
  isRefreshing,
  onGoToCurrent,
  onFetch,
  onPull,
  onPush,
  onRefresh,
}: CommitHistoryActionsProps) => {
  const remoteLabel = (name: string, busy: boolean, busyLabel: string) =>
    hasRemote ? (busy ? busyLabel : name) : `${name} (no remote configured)`;
  return (
    <div className="ml-auto flex items-center gap-0.5 flex-shrink-0">
      <ActionButton label="Go to current commit" onClick={onGoToCurrent}>
        <LocateFixed size={12} />
      </ActionButton>
      <ActionButton label={remoteLabel("Fetch", isFetching, "Fetching…")} onClick={onFetch} disabled={!hasRemote || isFetching}>
        <CloudDownload size={12} className={cn(isFetching && "animate-pulse")} />
      </ActionButton>
      <ActionButton label={remoteLabel("Pull", isPulling, "Pulling…")} onClick={onPull} disabled={!hasRemote || isPulling}>
        <ArrowDown size={12} className={cn(isPulling && "animate-pulse")} />
      </ActionButton>
      <ActionButton label={remoteLabel("Push", isPushing, "Pushing…")} onClick={onPush} disabled={!hasRemote || isPushing}>
        <CloudUpload size={12} className={cn(isPushing && "animate-pulse")} />
      </ActionButton>
      <ActionButton label={isRefreshing ? "Refreshing…" : "Refresh"} onClick={onRefresh} disabled={isRefreshing}>
        <RefreshCw size={12} className={cn(isRefreshing && "animate-spin")} />
      </ActionButton>
    </div>
  );
};
