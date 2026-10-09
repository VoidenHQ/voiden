import { useState, useEffect } from 'react';
import {
  generateJwt,
  decodeJwt,
  getClaimTimestamp,
} from '../utils/jwtUtils';
import type { JwtAlgorithm, JwtTemplate } from '../utils/types';
import { Copy, Check, Sparkles, RefreshCw, X } from 'lucide-react';

interface JwtFakerModalProps {
  isOpen: boolean;
  onClose: () => void;
  showToast?: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

const DEFAULT_HEADER = JSON.stringify({ alg: 'HS256', typ: 'JWT' }, null, 2);
const DEFAULT_PAYLOAD = JSON.stringify(
  {
    sub: '123456789',
    name: 'John Doe',
    email: 'john@example.com',
    role: 'admin',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  },
  null,
  2
);

export const JwtFakerModal = ({ isOpen, onClose, showToast }: JwtFakerModalProps) => {
  const [algorithm, setAlgorithm] = useState<JwtAlgorithm>('HS256');
  const [secret, setSecret] = useState('your-256-bit-secret');
  const [headerJson, setHeaderJson] = useState(DEFAULT_HEADER);
  const [payloadJson, setPayloadJson] = useState(DEFAULT_PAYLOAD);
  const [generatedJwt, setGeneratedJwt] = useState('');
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'editor' | 'decoder' | 'templates'>('editor');
  const [inputTokenToDecode, setInputTokenToDecode] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);

  // Saved templates
  const [templates, setTemplates] = useState<JwtTemplate[]>(() => {
    try {
      const saved = localStorage.getItem('__voiden_jwt_templates__');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [templateName, setTemplateName] = useState('');

  useEffect(() => {
    try {
      localStorage.setItem('__voiden_jwt_templates__', JSON.stringify(templates));
    } catch {
      // Ignore storage errors
    }
  }, [templates]);

  // Re-generate JWT whenever inputs change
  useEffect(() => {
    let isSubscribed = true;
    const generate = async () => {
      try {
        setParseError(null);
        let headerObj = {};
        let payloadObj = {};

        try {
          headerObj = JSON.parse(headerJson);
        } catch {
          setParseError('Invalid JSON in Header');
          return;
        }

        try {
          payloadObj = JSON.parse(payloadJson);
        } catch {
          setParseError('Invalid JSON in Payload');
          return;
        }

        const token = await generateJwt(headerObj, payloadObj, secret, algorithm);
        if (isSubscribed) {
          setGeneratedJwt(token);
        }
      } catch (err) {
        if (isSubscribed) {
          const msg = err instanceof Error ? err.message : String(err);
          setParseError(msg);
        }
      }
    };

    generate();
    return () => {
      isSubscribed = false;
    };
  }, [algorithm, secret, headerJson, payloadJson]);

  if (!isOpen) return null;

  const handleCopy = () => {
    if (!generatedJwt) return;
    navigator.clipboard.writeText(generatedJwt);
    setCopied(true);
    showToast?.('JWT copied to clipboard!', 'success');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAddClaim = (claimName: string, value: any) => {
    try {
      const current = JSON.parse(payloadJson || '{}');
      current[claimName] = value;
      setPayloadJson(JSON.stringify(current, null, 2));
    } catch {
      // Ignore parse error
    }
  };

  const handleSaveTemplate = () => {
    if (!templateName.trim()) return;
    const newTemplate: JwtTemplate = {
      id: Date.now().toString(),
      name: templateName.trim(),
      algorithm,
      secret,
      header: headerJson,
      payload: payloadJson,
    };
    setTemplates([...templates, newTemplate]);
    setTemplateName('');
    showToast?.(`Saved template "${newTemplate.name}"`, 'success');
  };

  const handleLoadTemplate = (tpl: JwtTemplate) => {
    setAlgorithm(tpl.algorithm);
    setSecret(tpl.secret);
    setHeaderJson(tpl.header);
    setPayloadJson(tpl.payload);
    setActiveTab('editor');
    showToast?.(`Loaded template "${tpl.name}"`, 'info');
  };

  const handleDeleteTemplate = (id: string) => {
    setTemplates(templates.filter((t) => t.id !== id));
  };

  const decoded = decodeJwt(activeTab === 'decoder' ? inputTokenToDecode || generatedJwt : generatedJwt);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-panel border border-border rounded-lg shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col text-foreground overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/20">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-yellow-500" />
            <h2 className="text-base font-semibold">JWT Faker & Generator</h2>
          </div>

          <div className="flex items-center gap-2">
            {/* Tabs */}
            <div className="flex bg-muted/40 rounded p-0.5 text-xs">
              <button
                className={`px-3 py-1 rounded transition-colors ${
                  activeTab === 'editor' ? 'bg-primary text-primary-foreground font-medium' : 'text-muted hover:text-foreground'
                }`}
                onClick={() => setActiveTab('editor')}
              >
                Generator
              </button>
              <button
                className={`px-3 py-1 rounded transition-colors ${
                  activeTab === 'decoder' ? 'bg-primary text-primary-foreground font-medium' : 'text-muted hover:text-foreground'
                }`}
                onClick={() => {
                  setActiveTab('decoder');
                  if (!inputTokenToDecode) setInputTokenToDecode(generatedJwt);
                }}
              >
                Decoder
              </button>
              <button
                className={`px-3 py-1 rounded transition-colors ${
                  activeTab === 'templates' ? 'bg-primary text-primary-foreground font-medium' : 'text-muted hover:text-foreground'
                }`}
                onClick={() => setActiveTab('templates')}
              >
                Templates ({templates.length})
              </button>
            </div>

            <button onClick={onClose} className="p-1 text-muted hover:text-foreground rounded">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {activeTab === 'editor' && (
            <>
              {/* Algorithm & Secret */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">Algorithm</label>
                  <select
                    value={algorithm}
                    onChange={(e) => setAlgorithm(e.target.value as JwtAlgorithm)}
                    className="w-full bg-input border border-border rounded px-2.5 py-1.5 text-sm focus:ring-1 focus:ring-primary"
                  >
                    <option value="HS256">HS256 (HMAC SHA-256)</option>
                    <option value="HS384">HS384 (HMAC SHA-384)</option>
                    <option value="HS512">HS512 (HMAC SHA-512)</option>
                    <option value="none">none (Unsigned Token)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-muted mb-1">
                    Secret Key {algorithm === 'none' && '(Not required for unsigned)'}
                  </label>
                  <input
                    type="text"
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    disabled={algorithm === 'none'}
                    placeholder="Enter signing secret"
                    className="w-full bg-input border border-border rounded px-2.5 py-1.5 text-sm disabled:opacity-50 focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>

              {/* Payload Claim Quick Buttons */}
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted font-medium">Quick Claims:</span>
                <button
                  onClick={() => handleAddClaim('exp', getClaimTimestamp(3600))}
                  className="px-2 py-1 bg-muted/40 hover:bg-muted/70 rounded text-foreground transition-colors"
                >
                  +1h Exp
                </button>
                <button
                  onClick={() => handleAddClaim('exp', getClaimTimestamp(86400))}
                  className="px-2 py-1 bg-muted/40 hover:bg-muted/70 rounded text-foreground transition-colors"
                >
                  +1d Exp
                </button>
                <button
                  onClick={() => handleAddClaim('iat', getClaimTimestamp(0))}
                  className="px-2 py-1 bg-muted/40 hover:bg-muted/70 rounded text-foreground transition-colors"
                >
                  Set iat Now
                </button>
                <button
                  onClick={() => handleAddClaim('nbf', getClaimTimestamp(0))}
                  className="px-2 py-1 bg-muted/40 hover:bg-muted/70 rounded text-foreground transition-colors"
                >
                  Set nbf Now
                </button>
              </div>

              {/* JSON Editors */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-muted">Header (JSON)</label>
                  </div>
                  <textarea
                    rows={6}
                    value={headerJson}
                    onChange={(e) => setHeaderJson(e.target.value)}
                    className="w-full font-mono text-xs bg-input border border-border rounded p-2 focus:ring-1 focus:ring-primary"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-muted">Payload (JSON)</label>
                  </div>
                  <textarea
                    rows={6}
                    value={payloadJson}
                    onChange={(e) => setPayloadJson(e.target.value)}
                    className="w-full font-mono text-xs bg-input border border-border rounded p-2 focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>

              {/* Parse Error */}
              {parseError && (
                <div className="text-xs text-red-500 bg-red-500/10 border border-red-500/30 rounded px-2.5 py-1.5">
                  {parseError}
                </div>
              )}

              {/* Encoded Token Result */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-foreground">Generated Encoded JWT</label>
                  <button
                    onClick={handleCopy}
                    disabled={!generatedJwt}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded transition-colors"
                  >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    {copied ? 'Copied!' : 'Copy JWT'}
                  </button>
                </div>
                <textarea
                  readOnly
                  rows={3}
                  value={generatedJwt}
                  className="w-full font-mono text-xs bg-muted/20 border border-border rounded p-2 text-yellow-500 select-all"
                />
              </div>

              {/* Save Template Bar */}
              <div className="flex items-center gap-2 pt-2 border-t border-border">
                <input
                  type="text"
                  placeholder="Template name (e.g. Admin Token)"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  className="flex-1 bg-input border border-border rounded px-2.5 py-1 text-xs"
                />
                <button
                  onClick={handleSaveTemplate}
                  disabled={!templateName.trim()}
                  className="px-3 py-1 bg-muted hover:bg-muted/80 text-xs font-medium rounded transition-colors disabled:opacity-50"
                >
                  Save as Template
                </button>
              </div>
            </>
          )}

          {activeTab === 'decoder' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-muted mb-1">JWT Token to Decode</label>
                <textarea
                  rows={3}
                  value={inputTokenToDecode}
                  onChange={(e) => setInputTokenToDecode(e.target.value)}
                  placeholder="Paste JWT token here..."
                  className="w-full font-mono text-xs bg-input border border-border rounded p-2"
                />
              </div>

              {decoded.isValid ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <span className="block text-xs font-semibold text-red-400 mb-1">Decoded Header</span>
                    <pre className="font-mono text-xs bg-muted/20 border border-border rounded p-2 overflow-x-auto text-red-400">
                      {JSON.stringify(decoded.header, null, 2)}
                    </pre>
                  </div>

                  <div>
                    <span className="block text-xs font-semibold text-purple-400 mb-1">Decoded Payload</span>
                    <pre className="font-mono text-xs bg-muted/20 border border-border rounded p-2 overflow-x-auto text-purple-400">
                      {JSON.stringify(decoded.payload, null, 2)}
                    </pre>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-red-500 bg-red-500/10 border border-red-500/30 rounded p-2">
                  {decoded.error || 'Invalid token structure'}
                </div>
              )}
            </div>
          )}

          {activeTab === 'templates' && (
            <div className="space-y-3">
              {templates.length === 0 ? (
                <div className="text-xs text-muted text-center py-6">
                  No saved templates yet. Customize claims in the Generator and click "Save as Template".
                </div>
              ) : (
                templates.map((tpl) => (
                  <div
                    key={tpl.id}
                    className="flex items-center justify-between p-2.5 border border-border rounded bg-muted/10 hover:bg-muted/20"
                  >
                    <div>
                      <div className="text-xs font-semibold text-foreground">{tpl.name}</div>
                      <div className="text-[11px] text-muted">
                        Alg: {tpl.algorithm} | Key: {tpl.secret || '(none)'}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleLoadTemplate(tpl)}
                        className="px-2.5 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90"
                      >
                        Load
                      </button>
                      <button
                        onClick={() => handleDeleteTemplate(tpl.id)}
                        className="p-1 text-muted hover:text-red-500"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
