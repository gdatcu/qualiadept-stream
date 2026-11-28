import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { getAppLanguage } from '../i18n';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'An unexpected display error occurred.',
    };
  }

  componentDidCatch(error: Error): void {
    console.error('[QualiadeptStream ErrorBoundary]', error);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      const isRo = getAppLanguage() === 'ro';
      return (
        <div className="flex min-h-screen w-full flex-col items-center justify-center bg-obsidian px-6 text-center text-white">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-surface/90 p-7 shadow-2xl">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500/15 text-red-400">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <h1 className="text-lg font-bold text-white">
              {isRo ? 'A apărut o problemă' : 'Something went wrong'}
            </h1>
            <p className="mt-2 text-xs text-zinc-400 break-words">{this.state.message}</p>
            <button
              onClick={this.handleReload}
              className="mt-5 inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg transition hover:from-violet-500 hover:to-indigo-500"
            >
              <RefreshCw className="h-4 w-4" />
              {isRo ? 'Reîncarcă aplicația' : 'Reload App'}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
