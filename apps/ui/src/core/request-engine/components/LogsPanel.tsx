import { useState, useEffect } from 'react';
import { Download, Trash2 } from 'lucide-react';
import { Tip } from '@/core/components/ui/Tip';

interface TrackedProcess {
  id: string;
  channel: string;
  category: string;
  startTime: number;
  status: 'active' | 'done' | 'error';
  duration?: number;
  error?: string;
}

export function LogsPanel() {
  const [processes, setProcesses] = useState<TrackedProcess[]>([]);
  const [filter, setFilter] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  useEffect(() => {
    const fetch = async () => {
      const data = await window.electron?.processMonitor?.getActive?.() ?? [];
      setProcesses(data);
    };
    fetch();

    const unsubscribe = window.electron?.processMonitor?.subscribe?.((data: TrackedProcess[]) => {
      setProcesses(data);
    });
    return unsubscribe;
  }, []);

  const filtered = processes.filter((p) => {
    const matchesSearch =
      p.channel.toLowerCase().includes(filter.toLowerCase()) ||
      (p.error && p.error.toLowerCase().includes(filter.toLowerCase()));
    const matchesCategory = !selectedCategory || p.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const handleClear = async () => {
    await window.electron?.processMonitor?.clearHistory?.();
  };

  const handleExport = () => {
    const json = JSON.stringify(processes, null, 2);
    const el = document.createElement('a');
    el.setAttribute('href', `data:text/plain;charset=utf-8,${encodeURIComponent(json)}`);
    el.setAttribute('download', `voiden-log-${Date.now()}.json`);
    el.style.display = 'none';
    document.body.appendChild(el);
    el.click();
    document.body.removeChild(el);
  };

  const formatTime = (ts: number) =>
    new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <div className="h-full flex flex-col bg-bg text-text">
      <div className="flex-shrink-0 border-b border-border px-3 py-2 bg-bg">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-text">Process Log</span>
          <div className="flex items-center gap-1">
            <Tip label="Export" side="bottom">
              <button
                onClick={handleExport}
                className="p-1.5 rounded text-comment hover:text-text hover:bg-active transition-colors"
              >
                <Download size={13} />
              </button>
            </Tip>
            <Tip label="Clear" side="bottom">
              <button
                onClick={handleClear}
                className="p-1.5 rounded text-comment hover:text-text hover:bg-active transition-colors"
              >
                <Trash2 size={13} />
              </button>
            </Tip>
          </div>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Filter..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="flex-1 h-7 text-xs px-2 bg-editor border border-border rounded font-mono outline-none text-text placeholder:text-comment"
          />
          <select
            value={selectedCategory ?? ''}
            onChange={(e) => setSelectedCategory(e.target.value || null)}
            className="h-7 px-2 bg-editor border border-border rounded text-xs text-text"
          >
            <option value="">All</option>
            <option value="git">Git</option>
            <option value="filesystem">Files</option>
            <option value="state">State</option>
            <option value="plugin">Plugin</option>
            <option value="ipc">IPC</option>
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-editor font-mono text-xs">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full text-comment">
            No records
          </div>
        ) : (
          filtered.map((p) => (
            <div key={p.id} className="border-b border-border px-3 py-1.5">
              <div className="flex items-baseline gap-2 min-w-0">
                <span className="text-comment shrink-0">{formatTime(p.startTime)}</span>
                <span className="text-comment shrink-0 w-[4.5rem]">{p.category}</span>
                <span className={`flex-1 truncate ${p.status === 'error' ? 'text-text' : 'text-text'}`}>
                  {p.channel}
                </span>
                {p.status === 'active' && (
                  <span className="text-comment shrink-0">…</span>
                )}
                {p.duration !== undefined && (
                  <span className="text-comment shrink-0">{p.duration}ms</span>
                )}
                {p.status === 'error' && (
                  <span className="text-comment shrink-0">ERR</span>
                )}
              </div>
              {p.error && (
                <div className="mt-0.5 text-comment pl-[calc(4.5rem+1rem)] whitespace-pre-wrap break-all">
                  {p.error}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
