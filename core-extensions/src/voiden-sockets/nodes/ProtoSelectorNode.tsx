import { mergeAttributes, Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import React, { useCallback, useEffect } from "react";
import { ExternalLink } from "lucide-react";

// Type definitions
interface ProtoMethod {
    name: string;
    request: string;
    response: string;
    callType: GrpcCallType;
}

interface ProtoService {
    name: string;
    methods: ProtoMethod[];
}

type GrpcCallType = 'unary' | 'server_streaming' | 'client_streaming' | 'bidirectional_streaming';

/**
 * Resolves a proto filePath (relative or absolute) to an absolute path.
 * Relative paths are joined against the active project directory.
 */
async function resolveProtoPath(filePath: string | null): Promise<string | null> {
    if (!filePath) return null;
    if (filePath.startsWith('/')) return filePath;
    try {
        const projectDir = await (window as any).electron?.directories?.getActive();
        if (!projectDir) return filePath;
        const sep = projectDir.endsWith('/') ? '' : '/';
        return `${projectDir}${sep}${filePath}`;
    } catch {
        return filePath;
    }
}

/**
 * Proto File Node
 * Handles proto file upload and parsing for gRPC services
 */
export const createProtoFileNode = (NodeViewWrapper: any) => {
    const ProtoFileComponent = ({ node, updateAttributes }: any) => {
        const fileInputRef = React.useRef<HTMLInputElement>(null);
        const [fileHandle, setFileHandle] = React.useState<File | null>(null);

        const determineCallType = (methodSignature: string): GrpcCallType => {
            const hasStreamRequest = /stream\s+\w+/.test(methodSignature.split('returns')[0]);
            const hasStreamResponse = /stream\s+\w+/.test(methodSignature.split('returns')[1] || '');

            if (hasStreamRequest && hasStreamResponse) return 'bidirectional_streaming';
            if (hasStreamRequest) return 'client_streaming';
            if (hasStreamResponse) return 'server_streaming';
            return 'unary';
        };

        const parseProtoFile = (content: string): { packageName: string | null; services: ProtoService[] } => {
            let packageName: string | null = null;

            const packageMatch = content.match(/package\s+([\w\.]+)\s*;/);
            if (packageMatch) packageName = packageMatch[1];

            const services: ProtoService[] = [];
            const serviceRegex = /service\s+(\w+)\s*{([^}]*)}/g;
            let serviceMatch;

            while ((serviceMatch = serviceRegex.exec(content)) !== null) {
                const serviceName = serviceMatch[1];
                const serviceBody = serviceMatch[2];

                const methods: ProtoMethod[] = [];
                const methodRegex = /rpc\s+(\w+)\s*\(([^)]+)\)\s*returns\s*\(([^)]+)\)/g;
                let methodMatch;

                while ((methodMatch = methodRegex.exec(serviceBody)) !== null) {
                    const fullMethodSignature = methodMatch[0];
                    const callType = determineCallType(fullMethodSignature);

                    methods.push({
                        name: methodMatch[1],
                        request: methodMatch[2].trim().replace('stream ', ''),
                        response: methodMatch[3].trim().replace('stream ', ''),
                        callType,
                    });
                }

                services.push({
                    name: serviceName,
                    methods,
                });
            }

            return { packageName, services };
        };

        // Auto-load proto services from filePath when services are missing and no in-memory file handle
        useEffect(() => {
            if (!node.attrs.fileName || node.attrs.services.length > 0 || fileHandle) return;
            (async () => {
                try {
                    const resolvedPath = await resolveProtoPath(node.attrs.filePath);
                    if (!resolvedPath) return;
                    const content = await (window as any).electron?.files?.read(resolvedPath);
                    if (!content) return;
                    const { packageName, services } = parseProtoFile(content);

                    // Relativize filePath if the proto is inside the active project directory
                    let storedPath = node.attrs.filePath as string | null;
                    try {
                        const projectDir = await (window as any).electron?.directories?.getActive();
                        if (projectDir && storedPath && storedPath.startsWith(projectDir)) {
                            const withSep = projectDir.endsWith('/') ? projectDir : projectDir + '/';
                            storedPath = storedPath.slice(withSep.length);
                        }
                    } catch { /* keep as-is */ }

                    // Resolve selectedService / selectedMethod / callType from loaded data
                    let selectedService = node.attrs.selectedService as string | null;
                    let selectedMethod = node.attrs.selectedMethod as string | null;
                    let callType = node.attrs.callType as string | null;

                    if (!selectedService && services.length > 0) {
                        selectedService = services[0].name;
                    }
                    if (selectedService) {
                        const svc = services.find((s: ProtoService) => s.name === selectedService);
                        if (svc) {
                            if (!selectedMethod && svc.methods.length > 0) {
                                selectedMethod = svc.methods[0].name;
                            }
                            if (selectedMethod) {
                                const meth = svc.methods.find((m: ProtoMethod) => m.name === selectedMethod);
                                callType = meth?.callType ?? callType;
                            }
                        }
                    }

                    updateAttributes({
                        packageName,
                        services,
                        filePath: storedPath,
                        selectedService,
                        selectedMethod,
                        callType,
                    });
                } catch (err) {
                    console.error('[ProtoSelectorNode] Auto-load failed:', err);
                }
            })();
        }, [node.attrs.fileName, node.attrs.services.length, fileHandle]);

        useEffect(() => {
            if (node.attrs.fileName && node.attrs.services.length === 0 && fileHandle) {
                loadFileContent(fileHandle);
            }
        }, [node.attrs.fileName, node.attrs.services.length, fileHandle]);

        const loadFileContent = async (file: File) => {
            try {
                const content = await file.text();
                const { packageName, services } = parseProtoFile(content);

                updateAttributes({
                    packageName,
                    services,
                    selectedService: services.length > 0 ? services[0].name : null,
                    selectedMethod: services.length > 0 && services[0].methods.length > 0 ? services[0].methods[0].name : null,
                    callType: services.length > 0 && services[0].methods.length > 0 ? services[0].methods[0].callType : null,
                });
            } catch (error) {
                console.error('Error reading proto file:', error);
                alert('Failed to read proto file');
            }
        };

        const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0];
            if (!file) return;

            if (!file.name.endsWith('.proto')) {
                alert('Please upload a .proto file');
                return;
            }

            setFileHandle(file);

            try {
                const content = await file.text();
                const { packageName, services } = parseProtoFile(content);
                const electronFile = file as File & { path?: string };
                let storedPath = electronFile.path || electronFile.webkitRelativePath || file.name;
                // Store relative path if the file is inside the active project directory
                try {
                    const projectDir = await (window as any).electron?.directories?.getActive();
                    if (projectDir && storedPath.startsWith(projectDir)) {
                        const withSep = projectDir.endsWith('/') ? projectDir : projectDir + '/';
                        storedPath = storedPath.slice(withSep.length);
                    }
                } catch { /* keep absolute */ }
                updateAttributes({
                    fileName: file.name,
                    filePath: storedPath,
                    packageName,
                    services,
                    selectedService: services.length > 0 ? services[0].name : null,
                    selectedMethod: services.length > 0 && services[0].methods.length > 0 ? services[0].methods[0].name : null,
                    callType: services.length > 0 && services[0].methods.length > 0 ? services[0].methods[0].callType : null,
                });
            } catch (error) {
                console.error('Error reading proto file:', error);
                alert('Failed to read proto file');
            }
        }, [updateAttributes]);

        const handleServiceChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
            const newService = e.target.value;
            const serviceData = node.attrs.services.find((s: ProtoService) => s.name === newService);

            updateAttributes({
                selectedService: newService,
                selectedMethod: serviceData && serviceData.methods.length > 0 ? serviceData.methods[0].name : null,
                callType: serviceData && serviceData.methods.length > 0 ? serviceData.methods[0].callType : null,
            });
        }, [updateAttributes, node.attrs.services]);

        const handleMethodChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
            const newMethod = e.target.value;
            const selectedServiceData = node.attrs.services?.find((s: ProtoService) => s.name === node.attrs.selectedService);
            const methodData = selectedServiceData?.methods.find((m: ProtoMethod) => m.name === newMethod);

            updateAttributes({
                selectedMethod: newMethod,
                callType: methodData?.callType || null,
            });
        }, [updateAttributes, node.attrs.services, node.attrs.selectedService]);

        const selectedServiceData = node.attrs.services?.find((s: ProtoService) => s.name === node.attrs.selectedService);
        const selectedMethodData = selectedServiceData?.methods.find((m: ProtoMethod) => m.name === node.attrs.selectedMethod);

        const getCallTypeDisplay = (callType: GrpcCallType) => {
            const displays = {
                'unary': 'Unary',
                'server_streaming': 'Server Streaming',
                'client_streaming': 'Client Streaming',
                'bidirectional_streaming': 'Bidirectional Streaming',
            };
            return displays[callType];
        };

        const getCallTypeIcon = (callType: GrpcCallType) => {
            const icons = {
                'unary': '→',
                'server_streaming': '→→',
                'client_streaming': '←←',
                'bidirectional_streaming': '⇄',
            };
            return icons[callType];
        };

        return (
            <NodeViewWrapper contentEditable={false}>
                <div className="border border-stone-700/80 rounded bg-bg p-3 my-2 select-none">
                    {!node.attrs.fileName ? (
                        <div className="py-2">
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".proto"
                                onChange={handleFileSelect}
                                className="hidden"
                                id="proto-file-input"
                            />
                            <button
                                type="button"
                                className="text-sm text-accent hover:text-accent/80 underline decoration-accent/50 hover:decoration-accent transition-colors cursor-pointer"
                                onClick={() => fileInputRef.current?.click()}
                            >
                                Import proto file
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm text-comment">📄</span>
                                    <span className="text-sm font-medium text-text">{node.attrs.fileName}</span>
                                    {node.attrs.packageName && (
                                        <span className="text-xs text-accent ml-2 font-mono">({node.attrs.packageName})</span>
                                    )}
                                    {node.attrs.filePath?.startsWith('/') && (
                                        <span
                                            title="Proto file is outside the project directory"
                                            className="flex items-center gap-1 text-xs text-yellow-500 cursor-default"
                                        >
                                            <ExternalLink size={11} />
                                            out of project
                                        </span>
                                    )}
                                </div>
                                <button
                                    className="text-xs px-2 py-1 text-red-400 hover:text-red-300 hover:bg-stone-700 rounded transition-colors"
                                    onClick={() => {
                                        updateAttributes({
                                            fileName: null,
                                            filePath: null,
                                            packageName: null,
                                            services: [],
                                            selectedService: null,
                                            selectedMethod: null,
                                            callType: null,
                                        });
                                        setFileHandle(null);
                                        if (fileInputRef.current) fileInputRef.current.value = '';
                                    }}
                                >
                                    Remove
                                </button>
                            </div>

                            {node.attrs.services && node.attrs.services.length > 0 ? (
                                <div className="space-y-2">
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <label className="block text-xs text-comment mb-1">Service</label>
                                            <select
                                                value={node.attrs.selectedService || ''}
                                                onChange={handleServiceChange}
                                                className="w-full text-sm bg-bg text-text border border-stone-700/80 rounded px-2 py-1 focus:outline-none focus:border-stone-500"
                                            >
                                                <option value="">Select service</option>
                                                {node.attrs.services.map((service: ProtoService) => (
                                                    <option key={service.name} value={service.name}>
                                                        {service.name}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>

                                        {selectedServiceData && (
                                            <div>
                                                <label className="block text-xs text-comment mb-1">Method</label>
                                                <select
                                                    value={node.attrs.selectedMethod || ''}
                                                    onChange={handleMethodChange}
                                                    className="w-full text-sm bg-bg text-text border border-stone-700/80 rounded px-2 py-1 focus:outline-none focus:border-stone-500"
                                                >
                                                    <option value="">Select method</option>
                                                    {selectedServiceData.methods.map((method: ProtoMethod) => (
                                                        <option key={method.name} value={method.name}>
                                                            {method.name}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}
                                    </div>

                                    {selectedMethodData && (
                                        <div className="border border-stone-700/50 rounded p-2 bg-stone-900/30">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-xs font-medium text-comment">Call Type:</span>
                                                <span className="text-xs px-2 py-0.5 rounded bg-stone-700 text-text font-mono">
                                                    {getCallTypeIcon(selectedMethodData.callType)} {getCallTypeDisplay(selectedMethodData.callType)}
                                                </span>
                                            </div>
                                            <div className="text-xs text-comment font-mono">
                                                {selectedMethodData.request} → {selectedMethodData.response}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="text-xs text-red-400 bg-red-950/20 border border-red-900/50 rounded px-2 py-1">
                                    ⚠️ No services found in proto file
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </NodeViewWrapper>
        );
    };

    return Node.create({
        name: "proto",
        group: "block",
        draggable: false, // Prevents dragging
        addAttributes() {
            return {
                fileName: { default: null },
                filePath: { default: null },
                packageName: { default: null },
                services: { default: [] },
                selectedService: { default: null },
                selectedMethod: { default: null },
                callType: { default: null },
            };
        },

        parseHTML() {
            return [{ tag: "proto" }];
        },

        renderHTML({ HTMLAttributes }) {
            return ["proto", mergeAttributes(HTMLAttributes, {
                contenteditable: "false",
                class: "proto-node-wrapper"
            }), 0];
        },

        addNodeView() {
            return ReactNodeViewRenderer(ProtoFileComponent);
        },

        addKeyboardShortcuts() {
            return {
                // Navigate up from proto to surl
                ArrowUp: () => {
                    const { state } = this.editor;
                    const { $head } = state.selection;

                    // Check if we're right after proto node
                    const nodeBefore = $head.nodeBefore;
                    if (nodeBefore?.type.name === "proto") {
                        const urlNode = this.editor.$node("surl");
                        if (urlNode) {
                            this.editor.commands.focus(urlNode.to - 1);
                            return true;
                        }
                    }
                    return false;
                },

                // Navigate down from above proto - skip proto
                ArrowDown: () => {
                    const { state } = this.editor;
                    const { $head } = state.selection;

                    const nodeAfter = $head.nodeAfter;
                    if (nodeAfter?.type.name === "proto") {
                        const protoNode = this.editor.$node("proto");
                        if (protoNode) {
                            // Jump to after proto
                            const afterProto = protoNode.to;
                            const { doc } = state;
                            const $afterProto = doc.resolve(afterProto);

                            if ($afterProto.nodeAfter) {
                                this.editor.commands.focus(afterProto);
                            } else {
                                // Create new paragraph after proto if nothing exists
                                this.editor
                                    .chain()
                                    .focus(afterProto)
                                    .insertContent({ type: "paragraph" })
                                    .run();
                            }
                            return true;
                        }
                    }
                    return false;
                },

            };
        },
    });
};