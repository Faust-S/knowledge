export function describeStorage(storage?: StorageManager): Promise<{
  available: boolean;
  persistent: boolean;
  usage: number | null;
  quota: number | null;
}>;
export function requestPersistence(storage?: StorageManager): Promise<boolean>;
export function formatBytes(bytes: number | null): string;
