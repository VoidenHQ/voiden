import React from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/core/components/ui/alert-dialog';
import { AttachmentChange } from '../historyManager';

interface Props {
  changes: AttachmentChange[];
  onContinue: () => void;
  onCancel: () => void;
}

export const AttachmentWarningDialog: React.FC<Props> = ({ changes, onContinue, onCancel }) => (
  <AlertDialog open>
    <AlertDialogContent className="max-w-sm">
      <AlertDialogHeader>
        <AlertDialogTitle className="flex items-center gap-2 text-base">
          <AlertTriangle size={15} className="text-yellow-400 shrink-0" />
          Attachment files changed
        </AlertDialogTitle>
      </AlertDialogHeader>

      <div className="text-sm text-comment mb-1">
        These files have changed since the request was recorded:
      </div>

      <ul className="space-y-1 mb-3">
        {changes.map((c) => (
          <li key={c.key} className="flex items-center gap-2 text-xs">
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${
                c.status === 'missing'
                  ? 'bg-red-500/20 text-red-400'
                  : 'bg-yellow-500/20 text-yellow-400'
              }`}
            >
              {c.status}
            </span>
            <span className="font-mono text-text/80 truncate" title={c.name}>{c.name}</span>
          </li>
        ))}
      </ul>

      <AlertDialogFooter>
        <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
        <AlertDialogAction onClick={onContinue}>Continue anyway</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);
