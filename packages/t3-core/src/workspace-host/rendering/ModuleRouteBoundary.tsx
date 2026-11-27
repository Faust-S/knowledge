/**
 * ModuleRouteBoundary (PROMPT 20 §1).
 *
 * Host-owned per-route error boundary. Failure inside one module route
 * component is contained: the Domain Shell keeps rendering.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  routeRefId: string;
  moduleId?: string;
  contextIdentity?: object;
  children: ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  error: Error | null;
  routeRefId: string;
  moduleId?: string;
  contextIdentity?: object;
}

export class ModuleRouteBoundary extends Component<Props, State> {
  state: State = {
    error: null, routeRefId: this.props.routeRefId,
    moduleId: this.props.moduleId, contextIdentity: this.props.contextIdentity,
  };

  static getDerivedStateFromError(error: Error): Pick<State, "error"> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): State | null {
    if (props.routeRefId === state.routeRefId && props.moduleId === state.moduleId &&
        props.contextIdentity === state.contextIdentity) return null;
    return { error: null, routeRefId: props.routeRefId,
      moduleId: props.moduleId, contextIdentity: props.contextIdentity };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          role="alert"
          data-testid="module-route-error"
          data-route-ref={this.props.routeRefId}
          data-module-id={this.props.moduleId ?? ""}
          className="p-4 text-sm text-rose-200 border border-rose-800/60 rounded space-y-1"
        >
          <p className="font-medium">Ошибка в модуле</p>
          <p className="text-xs text-rose-300">
            Раздел «{this.props.routeRefId}» не смог отобразиться. Остальная
            часть рабочей области продолжает работать.
          </p>
          <p className="text-xs text-rose-400/80">{this.state.error.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}
