import {createElement} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {App} from './App';
import type {T3ReviewHost} from '../../modules/activity-base-anonymizer/t3-review-controller.mjs';
import './styles.css';

export const IWXA_ACTIVITY_HOST_SURFACE_SCHEMA = 'IWXA_ACTIVITY_HOST_SURFACE/0.1';
const mounted = new WeakMap<HTMLElement, Root>();
const keys = ['readSelected', 'subscribeInvalidation'];

function narrowHost(port: unknown): port is T3ReviewHost {
  if (!port || typeof port !== 'object' || Array.isArray(port)) return false;
  return Object.keys(port).sort().join(',') === keys.join(',') &&
    keys.every(key => typeof (port as Record<string, unknown>)[key] === 'function');
}

// Existing trusted T3 owner provides an already-authorized narrow port.
// No issuer, Kernel, selected Workspace records or new runtime enter this view.
export function mountActivityHostSurface({container, t3Host}: {
  container: HTMLElement;
  t3Host: T3ReviewHost;
}) {
  if (!container || container.nodeType !== 1 || typeof container.appendChild !== 'function') {
    throw Error('IWXA_ACTIVITY_HOST_CONTAINER_REQUIRED');
  }
  if (!narrowHost(t3Host)) throw Error('IWXA_ACTIVITY_NARROW_T3_HOST_REQUIRED');
  if (mounted.has(container)) throw Error('IWXA_ACTIVITY_HOST_SURFACE_ALREADY_MOUNTED');
  const root = createRoot(container);
  mounted.set(container, root);
  try {
    root.render(createElement(App, {t3Host, brandSrc: new URL('./brand.svg', import.meta.url).href}));
  } catch (error) {
    mounted.delete(container);
    root.unmount();
    throw error;
  }
  let disposed = false;
  return Object.freeze({
    schema: IWXA_ACTIVITY_HOST_SURFACE_SCHEMA,
    dispose() {
      if (disposed) return;
      disposed = true;
      // App unmount releases both Control/Workspace invalidation listeners.
      root.unmount();
      mounted.delete(container);
    },
  });
}
