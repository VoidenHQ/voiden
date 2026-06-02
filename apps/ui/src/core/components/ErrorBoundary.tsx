import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RefreshCw, Github, Copy, Check } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  fallbackRender?: (props: { error: Error | null; errorInfo: ErrorInfo | null; reset: () => void }) => ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  level?: 'app' | 'plugin' | 'component';
  resetKey?: string | number;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  copied: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      copied: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidUpdate(prevProps: Props) {
    // Reset error state when resetKey changes (e.g., when tab changes)
    if (this.props.resetKey !== prevProps.resetKey && this.state.hasError) {
      this.setState({
        hasError: false,
        error: null,
        errorInfo: null,
        copied: false,
      });
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const { level = 'component', onError } = this.props;

    // Log error with context
    console.error(`[ErrorBoundary:${level}] Caught error:`, error);
    console.error(`[ErrorBoundary:${level}] Component stack:`, errorInfo.componentStack);

    this.setState({
      error,
      errorInfo,
    });

    // Call custom error handler if provided
    if (onError) {
      onError(error, errorInfo);
    }

    // Log to electron if available
    if (window.electron?.log) {
      window.electron.log.error('React Error Boundary', {
        level,
        message: error.message,
        stack: error.stack,
        componentStack: errorInfo.componentStack,
      });
    }
  }

  handleReload = () => {
    if (window.electron?.isApp) {
      window.electron.app.relaunch();
    } else {
      window.location.reload();
    }
  };

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      copied: false,
    });
  };

  copyErrorDetails = () => {
    const { error, errorInfo } = this.state;
    const errorText = `
# Error Report

**Error Message:** ${error?.message || 'Unknown error'}

**Stack Trace:**
\`\`\`
${error?.stack || 'No stack trace available'}
\`\`\`

**Component Stack:**
\`\`\`
${errorInfo?.componentStack || 'No component stack available'}
\`\`\`

**User Agent:** ${navigator.userAgent}
**Timestamp:** ${new Date().toISOString()}
    `.trim();

    navigator.clipboard.writeText(errorText);
    this.setState({ copied: true });
    setTimeout(() => this.setState({ copied: false }), 2000);
  };

  render() {
    const { hasError, error, errorInfo, copied } = this.state;
    const { children, fallback, fallbackRender, level = 'component' } = this.props;

    if (hasError) {
      // Use custom fallback if provided
      if (fallback) {
        return fallback;
      }

      if (fallbackRender) {
        return fallbackRender({ error, errorInfo, reset: this.handleReset });
      }

      // App-level error (most severe)
      if (level === 'app') {
        return (
          <div className="h-screen w-screen bg-bg flex items-center justify-center p-8">
            <div className="max-w-2xl w-full space-y-6">
              {/* Header */}
              <div className="text-center space-y-3">
                <div className="flex justify-center">
                  <AlertCircle className="w-16 h-16 text-red-500" />
                </div>
                <h1 className="text-3xl font-bold text-text">Application Error</h1>
                <p className="text-comment text-lg">
                  Something went wrong and the application couldn't recover.
                </p>
              </div>

              {/* Error details */}
              <div className="bg-editor border border-border rounded-lg p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <h3 className="font-semibold text-sm mb-2 text-text">Error Details</h3>
                    <p className="text-sm text-red-400 font-mono break-words">
                      {error?.message || 'Unknown error occurred'}
                    </p>
                  </div>
                </div>

                {/* Stack trace (collapsed by default) */}
                <details className="text-xs">
                  <summary className="cursor-pointer text-comment hover:text-text">
                    View stack trace
                  </summary>
                  <pre className="mt-2 p-3 bg-bg rounded text-xs text-comment overflow-auto max-h-48 font-mono">
                    {error?.stack || 'No stack trace available'}
                  </pre>
                </details>
              </div>

              {/* Actions */}
              <div className="space-y-3">
                <div className="flex gap-3">
                  <button
                    onClick={this.handleReload}
                    className="flex-1 flex items-center justify-center gap-2 bg-accent text-bg px-4 py-3 rounded-lg hover:bg-accent/90 transition-colors font-medium"
                  >
                    <RefreshCw size={18} />
                    Reload Application
                  </button>
                  <button
                    onClick={this.copyErrorDetails}
                    className="flex items-center justify-center gap-2 bg-editor border border-border text-text px-4 py-3 rounded-lg hover:bg-active transition-colors"
                  >
                    {copied ? <Check size={18} /> : <Copy size={18} />}
                    {copied ? 'Copied!' : 'Copy Error'}
                  </button>
                </div>

                {/* Report issue */}
                <div className="bg-editor border border-border rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <Github className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <h3 className="font-semibold text-sm mb-2 text-text">Report This Issue</h3>
                      <p className="text-sm text-comment mb-3">
                        Help us improve by reporting this error on GitHub. Click "Copy Error" above,
                        then create a new issue with the error details.
                      </p>
                      <a
                        href="https://github.com/voiden/voiden/issues/new"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 text-sm text-accent hover:underline"
                      >
                        Report Issue
                        <span className="text-xs">↗</span>
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      }

      // Plugin-level error
      if (level === 'plugin') {
        return (
          <div className="h-full w-full flex items-center justify-center p-4 bg-bg">
            <div className="max-w-md w-full bg-editor border border-border rounded-lg p-6 space-y-4">
              <div className="flex items-center gap-3">
                <AlertCircle className="w-8 h-8 text-orange-500 flex-shrink-0" />
                <div>
                  <h3 className="font-semibold text-text">Plugin Error</h3>
                  <p className="text-sm text-comment">A plugin caused an error</p>
                </div>
              </div>

              <p className="text-sm text-red-400 font-mono bg-bg p-3 rounded border border-border break-words">
                {error?.message || 'Unknown plugin error'}
              </p>

              <div className="flex gap-2">
                <button
                  onClick={this.handleReset}
                  className="flex-1 bg-accent text-bg px-3 py-2 rounded text-sm hover:bg-accent/90 transition-colors"
                >
                  Try Again
                </button>
                <button
                  onClick={this.copyErrorDetails}
                  className="bg-editor border border-border text-text px-3 py-2 rounded text-sm hover:bg-active transition-colors"
                >
                  {copied ? 'Copied!' : 'Copy Error'}
                </button>
              </div>

              <p className="text-xs text-comment">
                Try disabling recently installed plugins in Settings → Extensions
              </p>
            </div>
          </div>
        );
      }

      // Component-level error (least severe)
      return (
        <div className="border border-border rounded bg-editor p-4 m-2">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1 space-y-2">
              <div>
                <h4 className="font-semibold text-sm text-text">Component Error</h4>
                <p className="text-xs text-comment mt-1">This component failed to render</p>
              </div>
              <p className="text-xs text-red-400 font-mono bg-bg p-2 rounded break-words">
                {error?.message || 'Unknown error'}
              </p>
              <button
                onClick={this.handleReset}
                className="text-xs text-accent hover:underline"
              >
                Try again
              </button>
            </div>
          </div>
        </div>
      );
    }

    return children;
  }
}

// Convenience wrapper for app-level error boundary
export const AppErrorBoundary: React.FC<{ children: ReactNode }> = ({ children }) => {
  return <ErrorBoundary level="app">{children}</ErrorBoundary>;
};

// Convenience wrapper for plugin-level error boundary
export const PluginErrorBoundary: React.FC<{ children: ReactNode }> = ({ children }) => {
  return <ErrorBoundary level="plugin">{children}</ErrorBoundary>;
};
