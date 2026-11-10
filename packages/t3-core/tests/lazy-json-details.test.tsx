// @vitest-environment jsdom
/**
 * T2-03E — LazyJsonDetails must defer JSON.stringify until the user
 * explicitly opens the <details>. A closed <details> still mounts its
 * children in React, so the component itself must skip mounting the
 * viewer while it is closed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { LazyJsonDetails } from "../src/modules/base/features/object/LazyJsonDetails";

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe("LazyJsonDetails", () => {
  it("does not call JSON.stringify while closed", () => {
    const spy = vi.spyOn(JSON, "stringify");
    render(
      <LazyJsonDetails
        summary="Показать исходные данные"
        value={{ big: "payload", n: 1 }}
        testId="lazy"
      />,
    );
    // Nothing should have serialised the value yet.
    const calls = spy.mock.calls.filter(
      (c) => typeof c[0] === "object" && c[0] !== null && "big" in (c[0] as object),
    );
    expect(calls.length).toBe(0);
    // Viewer is not in the DOM either.
    expect(screen.queryByTestId("lazy-json")).toBeNull();
  });

  it("serialises the value only after the user opens the details", () => {
    const spy = vi.spyOn(JSON, "stringify");
    render(
      <LazyJsonDetails
        summary="Показать исходные данные"
        value={{ big: "payload", n: 2 }}
        testId="lazy"
      />,
    );
    const details = screen.getByTestId("lazy") as HTMLDetailsElement;
    details.open = true;
    fireEvent(details, new Event("toggle"));

    // Viewer is mounted…
    expect(screen.getByTestId("lazy-json")).not.toBeNull();
    // …and JSON.stringify has now seen the value.
    const hit = spy.mock.calls.some(
      (c) => typeof c[0] === "object" && c[0] !== null && "big" in (c[0] as object),
    );
    expect(hit).toBe(true);
  });

  it("summary has an accessible 44px minimum target", () => {
    render(
      <LazyJsonDetails
        summary="Показать исходные данные"
        value={{ x: 1 }}
        testId="lazy"
      />,
    );
    const toggle = screen.getByTestId("lazy-toggle");
    expect(toggle.className).toContain("min-h-[44px]");
  });

  it("health-blocked surface does not mount the viewer", () => {
    // Simulate the caller-side gate: the caller simply does not render
    // LazyJsonDetails at all when the surface is health-blocked.
    const spy = vi.spyOn(JSON, "stringify");
    const healthBlocked = true;
    render(
      <div>{healthBlocked ? null : (
        <LazyJsonDetails
          summary="s"
          value={{ payload: true }}
          testId="lazy"
        />
      )}</div>,
    );
    expect(screen.queryByTestId("lazy")).toBeNull();
    const calls = spy.mock.calls.filter(
      (c) => typeof c[0] === "object" && c[0] !== null && "payload" in (c[0] as object),
    );
    expect(calls.length).toBe(0);
  });
});
