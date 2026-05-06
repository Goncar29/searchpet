import { Component, type ErrorInfo, type ReactNode } from 'react';
import i18n from '../i18n/index';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return <ErrorFallback />;
    }
    return this.props.children;
  }
}

function ErrorFallback() {
  const errorText = i18n.t('common:error');

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-950 px-4 text-center">
      <p className="text-5xl mb-6">🐾</p>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50 mb-3">
        {errorText}
      </h1>
      <p className="text-gray-500 dark:text-gray-400 mb-8 max-w-sm">
        Something went wrong. / Algo salió mal.
      </p>
      <button
        onClick={() => window.location.reload()}
        className="bg-primary hover:bg-primary-dark text-white font-semibold rounded-lg px-6 py-2 transition-colors"
      >
        Reload / Reintentar
      </button>
    </div>
  );
}
