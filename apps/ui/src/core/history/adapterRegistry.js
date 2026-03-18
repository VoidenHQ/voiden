/**
 * History Adapter Registry
 *
 * Plugins register a HistoryAdapter to own their request/response data in history.
 * Core only knows about the standardised HistoryEntryMeta (for the card header).
 * Everything else (viewers, export, serialisation) is delegated to the plugin.
 */
// ─── Registry singleton ───────────────────────────────────────────────────────
class HistoryAdapterRegistry {
    constructor() {
        this.adapters = new Map();
    }
    register(adapter) {
        this.adapters.set(adapter.pluginId, adapter);
    }
    unregister(pluginId) {
        this.adapters.delete(pluginId);
    }
    /** Find the first adapter whose canHandle() returns true for this context */
    findForContext(pipelineContext) {
        for (const adapter of this.adapters.values()) {
            try {
                if (adapter.canHandle(pipelineContext))
                    return adapter;
            }
            catch {
                /* never let a bad adapter break history */
            }
        }
        return undefined;
    }
    /** Direct lookup by pluginId — used at render/export time */
    get(pluginId) {
        return this.adapters.get(pluginId);
    }
    /** Called during plugin system reload */
    clear() {
        this.adapters.clear();
    }
}
export const historyAdapterRegistry = new HistoryAdapterRegistry();
