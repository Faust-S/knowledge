// Setup file executed for every test file. jest-dom matchers only
// register when a DOM is present (jsdom environment). Under the
// default node environment this file is a no-op.
if (typeof window !== "undefined" && typeof document !== "undefined") {
  await import("@testing-library/jest-dom/vitest");
  const { cleanup } = await import("@testing-library/react");
  const { afterEach } = await import("vitest");
  afterEach(() => {
    cleanup();
  });
}
