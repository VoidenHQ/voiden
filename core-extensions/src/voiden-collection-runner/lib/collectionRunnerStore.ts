import { create } from 'zustand';

/** A resolved .void file reference extracted from the table at run time */
export interface FileEntry {
  /** Stable key — uses the file path so status rows survive re-runs */
  id: string;
  path: string;
  name: string;
}

export interface FileRunState extends FileEntry {
  status: 'pending' | 'running' | 'done' | 'error';
  response: any | null;
  error: string | null;
}

interface CollectionRunnerStore {
  isRunning: boolean;
  runFiles: FileRunState[];
  selectedFileId: string | null;

  /** Begin a new run. Resets all per-file state. */
  startRun: (files: FileEntry[]) => void;
  updateFileStatus: (fileId: string, status: FileRunState['status']) => void;
  setFileResponse: (fileId: string, response: any) => void;
  setFileError: (fileId: string, error: string) => void;
  completeRun: () => void;
  setSelectedFile: (fileId: string | null) => void;
  reset: () => void;
}

export const useCollectionRunnerStore = create<CollectionRunnerStore>((set) => ({
  isRunning: false,
  runFiles: [],
  selectedFileId: null,

  startRun: (files) =>
    set({
      isRunning: true,
      selectedFileId: null,
      runFiles: files.map((f) => ({
        ...f,
        status: 'pending',
        response: null,
        error: null,
      })),
    }),

  updateFileStatus: (fileId, status) =>
    set((state) => ({
      runFiles: state.runFiles.map((f) => (f.id === fileId ? { ...f, status } : f)),
    })),

  setFileResponse: (fileId, response) =>
    set((state) => ({
      runFiles: state.runFiles.map((f) =>
        f.id === fileId ? { ...f, response, status: 'done' } : f
      ),
      // Auto-select the first file that gets a response
      selectedFileId: state.selectedFileId ?? fileId,
    })),

  setFileError: (fileId, error) =>
    set((state) => ({
      runFiles: state.runFiles.map((f) =>
        f.id === fileId ? { ...f, error, status: 'error' } : f
      ),
    })),

  completeRun: () => set({ isRunning: false }),

  setSelectedFile: (fileId) => set({ selectedFileId: fileId }),

  reset: () => set({ isRunning: false, runFiles: [], selectedFileId: null }),
}));
