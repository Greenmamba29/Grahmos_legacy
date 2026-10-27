import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  name: string;
  /** Changing this key remounts the pane — recovery without reloading the console. */
  recoveryKey?: string | number;
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * Pane-level fault containment: a failed module must never blank the emergency console. The
 * boundary renders the failure honestly and offers a local reset.
 */
export class PaneBoundary extends Component<Props, State> {
  override state: State = { error: null };
  static getDerivedStateFromError(error: Error): State {
    return { error };
  }
  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[pane:${this.props.name}]`, error, info.componentStack);
  }
  override componentDidUpdate(prev: Props): void {
    if (prev.recoveryKey !== this.props.recoveryKey && this.state.error)
      this.setState({ error: null });
  }
  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="pane pane-failed" role="alert">
          <h3>{this.props.name} unavailable</h3>
          <p className="muted">{this.state.error.message}</p>
          <button onClick={() => this.setState({ error: null })}>Reset pane</button>
        </div>
      );
    }
    return this.props.children;
  }
}
