/**
 * Top-level React error boundary.
 *
 * On catch:
 *   - classify the throwable into a WorkspaceErrorCode;
 *   - render the corresponding ErrorPage (never a blank screen);
 *   - report a *safe* event to the analytics sink (no user content).
 *
 * There is intentionally no silent fallback: even unrecognised errors go to
 * the explicit `unknown` page which tells the user data status is
 * indeterminate and asks them to export first.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { classifyError } from "./classify";
import { ErrorPage } from "./ErrorPage";
import { reportError } from "./analytics";
import type { WorkspaceErrorCode, ErrorActionId } from "./codes";

interface Props {
  children: ReactNode;
  onAction?: (action: ErrorActionId, code: WorkspaceErrorCode) => void;
}

interface State {
  error: unknown;
  code: WorkspaceErrorCode | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, code: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error, code: classifyError(error) };
  }

  componentDidCatch(error: unknown, _info: ErrorInfo): void {
    const code = classifyError(error);
    reportError(code, error);
  }

  private handleAction = (action: ErrorActionId): void => {
    if (this.state.code) {
      this.props.onAction?.(action, this.state.code);
    }
    if (action === "reload") {
      this.setState({ error: null, code: null });
    }
  };

  render(): ReactNode {
    if (this.state.code) {
      return (
        <ErrorPage
          code={this.state.code}
          error={this.state.error}
          onAction={this.handleAction}
        />
      );
    }
    return this.props.children;
  }
}
