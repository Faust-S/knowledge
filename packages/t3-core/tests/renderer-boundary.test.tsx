// @vitest-environment jsdom
/**
 * T2-03B — a crashing renderer must not take down the whole catalog.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import {
  RendererBoundary,
  RendererErrorFallback,
} from "../src/modules/base/features/workspace/RendererBoundary";

function Boom(): JSX.Element {
  throw new Error("renderer explosion");
}

describe("RendererBoundary", () => {
  const orig = console.error;
  beforeEach(() => { console.error = () => {}; });
  afterEach(() => { console.error = orig; cleanup(); });

  it("shows the fallback when a child throws", () => {
    render(
      <RendererBoundary fallback={<RendererErrorFallback />}>
        <Boom />
      </RendererBoundary>,
    );
    expect(screen.getByTestId("renderer-error-fallback")).toBeInTheDocument();
    expect(screen.getByText(/Не удалось отобразить/i)).toBeInTheDocument();
  });

  it("renders children as-is when they do not throw", () => {
    render(
      <RendererBoundary fallback={<RendererErrorFallback />}>
        <p data-testid="ok">ok</p>
      </RendererBoundary>,
    );
    expect(screen.getByTestId("ok")).toBeInTheDocument();
  });
});
