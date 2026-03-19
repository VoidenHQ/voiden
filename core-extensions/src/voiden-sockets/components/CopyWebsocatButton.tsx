import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { generateWebsocatFromJson } from '../lib/websocatGenerator';
import { PluginContext } from '@voiden/sdk';


interface CopyWebsocatButtonProps {
    tab?: {
        title?: string;
        content?: string;
        tabId?: string;
        [key: string]: any;
    };
    context: PluginContext
}

export const CopyWebsocatButton: React.FC<CopyWebsocatButtonProps> = ({ tab, context }) => {
    const [copied, setCopied] = useState(false);


    const readActiveEditorJSON = async () => {
        try {
            if (tab?.tabId) {
                // @ts-ignore - resolved at runtime in app context
                const { useEditorStore } = await import(/* @vite-ignore */ '@/core/editors/voiden/VoidenEditor');
                const unsaved = useEditorStore.getState().unsaved[tab.tabId];
                if (unsaved) {
                    return JSON.parse(unsaved);
                }
            }
            const voiden = context.project.getActiveEditor?.("voiden");
            return (voiden && typeof voiden.getJSON === "function" && voiden.getJSON()) || [];
        } catch {
            return [];
        }
    };
    const handleCopyWebsocat = async () => {
        try {
            const jsonContent = await readActiveEditorJSON();

            if (!jsonContent || jsonContent.length === 0) {
                console.warn('No content available to copy');
                return;
            }

            // Generate websocat command
            const rawWebsocatCommand = await generateWebsocatFromJson(jsonContent);

            if (!rawWebsocatCommand) {
                console.warn('Failed to generate websocat command');
                return;
            }

            // Resolve {{VAR}} and {{process.xxx}} placeholders
            const websocatCommand = await (window as any).electron?.env?.replaceVariables(rawWebsocatCommand) ?? rawWebsocatCommand;

            // Copy to clipboard
            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                await navigator.clipboard.writeText(websocatCommand);
            } else {
                // Fallback for older browsers
                const textArea = document.createElement('textarea');
                textArea.value = websocatCommand;
                textArea.style.position = 'fixed';
                textArea.style.left = '-999999px';
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
            }

            // Show feedback
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (error) {
            console.error('Error copying websocat command:', error);
        }
    };

    return (
        <button
            onClick={handleCopyWebsocat}
            className="w-full flex items-center gap-1 px-2 py-1 rounded hover:bg-button-primary text-text transition-colors"
            title="Copy as websocat"
        >
            {copied ? (
                <>
                    <Check className="w-4 h-4" />
                    <span className="text-xs">Copied</span>
                </>
            ) : (
                <>
                    <Copy className="w-4 h-4" />
                    <span className="text-xs">websocat</span>
                </>
            )}
        </button>
    );
};
