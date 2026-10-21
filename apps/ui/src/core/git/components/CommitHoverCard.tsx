import { ReactNode, useEffect, useState } from "react";
import * as HoverCardPrimitive from "@radix-ui/react-hover-card";
import { Check, Clock, Copy, ExternalLink, GitCommitVertical, Github, Gitlab, UserRound } from "lucide-react";
import { useGetCommitDetails, useGetCommitFiles, useGetGitRemote } from "@/core/git/hooks";
import {
  formatAbsoluteDate,
  formatRelativeTime,
  getInitials,
  parseCoAuthors,
  reflowCommitMessage,
  toCommitWebLink,
} from "@/core/git/utils/commitInfo";

/** The commit fields the hover card needs (one entry of the commit history log). */
export interface HoverCardCommit {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
}

const HOVER_OPEN_DELAY_MS = 600;

const Separator = () => <div className="h-px bg-border my-2" />;

const ProviderIcon = ({ provider }: { provider: string }) => {
  if (provider === "GitHub") return <Github size={12} />;
  if (provider === "GitLab") return <Gitlab size={12} />;
  return <ExternalLink size={12} />;
};

const CopyHashButton = ({ hash }: { hash: string }) => {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard.writeText(hash).then(() => setCopied(true));
      }}
      className="p-0.5 rounded text-comment hover:text-text hover:bg-hover"
      title={copied ? "Copied" : "Copy Commit ID"}
      aria-label="Copy Commit ID"
    >
      {copied ? <Check size={12} className="text-vcs-added" /> : <Copy size={12} />}
    </button>
  );
};

/** Card body; only mounted while open, so details and files load on demand. */
const CommitHoverCardBody = ({ commit, color }: { commit: HoverCardCommit; color: string }) => {
  const { data: details } = useGetCommitDetails(commit.hash);
  const { data: files } = useGetCommitFiles(commit.hash);
  const { data: remoteUrl } = useGetGitRemote();

  const author = details?.authorName ?? commit.author;
  const date = details?.authorDate ?? commit.date;
  const message = details ? reflowCommitMessage([details.subject, details.body].filter(Boolean).join("\n\n")) : commit.message;
  const coAuthors = parseCoAuthors(details?.body);
  const webLink = toCommitWebLink(remoteUrl, commit.hash);

  const insertions = files?.reduce((sum, f) => sum + f.insertions, 0) ?? 0;
  const deletions = files?.reduce((sum, f) => sum + f.deletions, 0) ?? 0;

  return (
    <div className="flex flex-col text-xs text-text">
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className="w-5 h-5 rounded flex items-center justify-center text-[9px] font-semibold text-bg flex-shrink-0"
          style={{ background: color }}
          aria-hidden
        >
          {getInitials(author)}
        </span>
        <span className="font-semibold text-accent" title={details?.authorEmail}>{author}</span>
        <span className="flex items-center gap-1 text-comment">
          <Clock size={11} />
          {formatRelativeTime(date)} ({formatAbsoluteDate(date)})
        </span>
      </div>

      {coAuthors.map((co) => (
        <div key={co.email} className="flex items-center gap-2 mt-1.5" title={co.email}>
          <UserRound size={14} className="text-comment flex-shrink-0" />
          <span className="font-semibold text-accent">{co.name}</span>
          <span className="italic text-comment">(Co-author)</span>
        </div>
      ))}

      <p className="mt-2 whitespace-pre-wrap break-words leading-relaxed max-h-48 overflow-auto">{message}</p>

      <Separator />
      {files ? (
        <p className="text-comment">
          {files.length} file{files.length !== 1 ? "s" : ""} changed
          {insertions > 0 && <>, <span className="text-vcs-added">{insertions} insertion{insertions !== 1 ? "s" : ""}(+)</span></>}
          {deletions > 0 && <>, <span className="text-vcs-removed">{deletions} deletion{deletions !== 1 ? "s" : ""}(-)</span></>}
        </p>
      ) : (
        <div className="h-2.5 w-1/2 rounded bg-active animate-pulse" aria-busy="true" />
      )}

      <Separator />
      <div className="flex items-center gap-1.5 text-accent">
        <GitCommitVertical size={12} />
        <span className="font-mono" title={commit.hash}>{commit.shortHash}</span>
        <CopyHashButton hash={commit.hash} />
        {webLink && (
          <>
            <span className="text-comment">|</span>
            <button
              onClick={(e) => { e.stopPropagation(); window.electron?.openExternal(webLink.url); }}
              className="flex items-center gap-1 hover:underline"
            >
              <ProviderIcon provider={webLink.provider} />
              Open on {webLink.provider}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

/** VS Code style commit hover: author, dates, co-authors, full message, stats, hash and remote link. */
export const CommitHoverCard = ({ commit, color, children }: { commit: HoverCardCommit; color: string; children: ReactNode }) => (
  <HoverCardPrimitive.Root openDelay={HOVER_OPEN_DELAY_MS} closeDelay={150}>
    <HoverCardPrimitive.Trigger asChild>{children}</HoverCardPrimitive.Trigger>
    <HoverCardPrimitive.Portal>
      <HoverCardPrimitive.Content
        side="right"
        align="start"
        sideOffset={6}
        collisionPadding={8}
        className="z-50 w-[380px] max-w-[calc(100vw-16px)] rounded-md border border-border bg-panel p-3 shadow-lg outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
      >
        <CommitHoverCardBody commit={commit} color={color} />
      </HoverCardPrimitive.Content>
    </HoverCardPrimitive.Portal>
  </HoverCardPrimitive.Root>
);
