import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * A fault in one screen should cost that screen, not the whole application.
 * Without this, a single undefined value blanks the page and the manager loses
 * the navigation as well as the content.
 */
interface Props {
  children: ReactNode;
  /** Changing this resets the boundary — used to recover on navigation. */
  resetKey?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidUpdate(previous: Props): void {
    if (previous.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    /* In production this is where the error reporter would be called. It must
       never carry the response body, which may hold care-home data. */
    console.error('Screen failed to render', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="error-state" role="alert">
        <h3>This screen could not be displayed</h3>
        <p>
          Something in this view failed to render. The rest of the application is unaffected — try another
          screen, or reload to start again.
        </p>
        <p className="tiny muted">{this.state.error.message}</p>
        <div className="row gap-8">
          <button type="button" className="btn btn-sm" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
