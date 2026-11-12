export async function describeStorage(storage = navigator.storage) {
  if (!storage) return { available: false, persistent: false, usage: null, quota: null };
  const estimate = typeof storage.estimate === 'function' ? await storage.estimate() : {};
  const persistent = typeof storage.persisted === 'function' ? await storage.persisted() : false;
  return {
    available: true,
    persistent: persistent === true,
    usage: Number.isFinite(estimate.usage) ? estimate.usage : null,
    quota: Number.isFinite(estimate.quota) ? estimate.quota : null,
  };
}
export async function requestPersistence(storage = navigator.storage) {
  if (!storage?.persist) return false;
  return (await storage.persist()) === true;
}
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return 'неизвестно';
  return `${(bytes / (1024 * 1024)).toFixed(0)} МБ`;
}
