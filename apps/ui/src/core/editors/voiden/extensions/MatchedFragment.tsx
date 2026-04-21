import React from 'react';
import type { MatchedFragment } from '@voiden/fuzzy-search';

export function highlightText(text: string, fragments: MatchedFragment[] | undefined): React.ReactNode {
  if (!fragments || fragments.length === 0) return text;
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const { startOffset, endOffset } of fragments) {
    const s = Math.min(Math.max(startOffset, 0), text.length);
    const e = Math.min(Math.max(endOffset, 0), text.length);
    if (e <= s) continue;
    if (s > last) parts.push(text.slice(last, s));
    parts.push(<mark key={s} className="bg-transparent text-accent font-semibold not-italic">{text.slice(s, e)}</mark>);
    last = e;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <span>{parts}</span>;
}
