/**
 * Error boundary around a single profile renderer.
 *
 * A crash in one renderer must not take down the whole catalog surface.
 * We deliberately do NOT report the error to any external analytics —
 * payloads can be sensitive and shell code has no schema knowledge to
 * scrub them safely.
 */
import { Component, type ReactNode } from "react";

export interface RendererBoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
}

interface State {
  hasError: boolean;
}

export class RendererBoundary extends Component<RendererBoundaryProps, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(): void {
    // Intentionally silent — see file header.
  }

  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

export function RendererErrorFallback() {
  return (
    <p
      role="status"
      data-testid="renderer-error-fallback"
      className="text-xs text-amber-200 border border-amber-800/60 rounded p-2"
    >
      Не удалось отобразить предпросмотр объекта. Объект можно открыть в
      безопасном техническом режиме.
    </p>
  );
}
