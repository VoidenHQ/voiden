import React from 'react';
import { GitCommitHorizontal } from 'lucide-react';
import { Tip } from '@/core/components/ui/Tip';
import { shortCommitHash } from '../fileCommit';
import type { HistoryEntryCommit } from '../types';

/** The commit a history entry's .void file was at when the request ran. `*` marks uncommitted changes. */
export const HistoryCommitBadge: React.FC<{ commit: HistoryEntryCommit }> = ({ commit }) => {
  const shortHash = shortCommitHash(commit.hash);
  return (
    <Tip
      side="top"
      label={
        <span className="flex flex-col gap-0.5 max-w-[280px]">
          <span>{commit.dirty ? `Ran with uncommitted changes on top of ${shortHash}` : `Ran at commit ${shortHash}`}</span>
          {commit.subject && <span className="text-text truncate">{commit.subject}</span>}
        </span>
      }
    >
      <span className="flex items-center gap-0.5 shrink-0 text-[10px] font-mono text-comment cursor-default">
        <GitCommitHorizontal size={10} className="shrink-0" />
        {shortHash}
        {commit.dirty && <span className="text-vcs-modified">*</span>}
      </span>
    </Tip>
  );
};
