// File delivery only. Original Exchange still owns PackageArtifact, preview,
// validation, user acknowledgement, and confirmExport.
const chunkBytes = 256 * 1024;
const maxBytes = 200 * 1024 * 1024;
const fail = code => { throw Error(code); };
const transferIdPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export function isAndroidPackageFileRuntime(scope = globalThis) {
  const cap = scope.Capacitor;
  return scope.location?.origin === 'https://localhost' && cap?.getPlatform?.() === 'android' && cap?.isNativePlatform?.() === true;
}
export async function saveAndroidPackageFile(bytes, filename, { scope = globalThis, isCurrent = () => true } = {}) {
  const plugin = scope.Capacitor?.Plugins?.IwxaPackageFile;
  if (!isAndroidPackageFileRuntime(scope) || !plugin ||
      ['begin','append','finish','abort'].some(name => typeof plugin[name] !== 'function') ||
      typeof scope.crypto?.randomUUID !== 'function' || typeof scope.btoa !== 'function') fail('IWXA_FILE_BRIDGE_UNAVAILABLE');
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > maxBytes) fail('IWXA_FILE_SIZE_INVALID');
  if (typeof filename !== 'string' || filename.length < 6 || filename.length > 180 ||
      !/\.iwxa$/i.test(filename) || /[\\/\x00-\x1f\x7f]/.test(filename) || filename !== filename.trim()) fail('IWXA_FILE_NAME_INVALID');
  const transferId = scope.crypto.randomUUID();
  if (!transferIdPattern.test(transferId)) fail('IWXA_FILE_TRANSFER_INVALID');
  const current = () => { if (!isCurrent()) fail('IWXA_FILE_SELECTION_CHANGED'); };
  current();
  try {
    const started = await plugin.begin({ transferId, filename, bytes: bytes.byteLength });
    if (started?.transferId !== transferId || started.nextOffset !== 0) fail('IWXA_FILE_RECEIPT_INVALID');
    for (let offset = 0; offset < bytes.byteLength;) {
      current();
      const end = Math.min(offset + chunkBytes, bytes.byteLength);
      let binary = '';
      for (let i = offset; i < end; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + 8192, end)));
      const reply = await plugin.append({ transferId, offset, chunk: scope.btoa(binary) });
      if (reply?.transferId !== transferId || reply.nextOffset !== end) fail('IWXA_FILE_RECEIPT_INVALID');
      offset = end;
    }
    current();
    const saved = await plugin.finish({ transferId });
    if (saved?.transferId !== transferId || saved.bytes !== bytes.byteLength || saved.verified !== true ||
        typeof saved.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(saved.sha256) ||
        typeof saved.filename !== 'string' || !saved.filename.trim() || typeof saved.filenameConfirmed !== 'boolean') fail('IWXA_FILE_RECEIPT_INVALID');
    return Object.freeze({ filename: saved.filename, filenameConfirmed: saved.filenameConfirmed, bytes: saved.bytes, sha256: saved.sha256 });
  } catch (error) {
    // Even a lost begin reply can be cleaned up by its caller-owned ID.
    // Never retry a write or confirm a potentially different file.
    try { await plugin.abort({ transferId }); } catch {}
    throw error;
  }
}
export function androidPackageFileMessage(error) {
  const code = [error?.code, error?.message].find(value => typeof value === 'string' && /^IWXA_FILE_[A-Z_]+$/.test(value));
  return ({
    IWXA_FILE_CANCELLED: 'Сохранение отменено. Резервная копия не подтверждена.',
    IWXA_FILE_BUSY: 'Другая операция сохранения ещё не завершена.',
    IWXA_FILE_BRIDGE_UNAVAILABLE: 'Системное сохранение файла недоступно в этой сборке.',
    IWXA_FILE_PICKER_UNAVAILABLE: 'Не удалось открыть системный выбор файла.',
    IWXA_FILE_STORAGE: 'Не удалось подготовить файл. Проверьте свободное место.',
    IWXA_FILE_SIZE_INVALID: 'Размер архива превышает допустимый объём (200 МиБ) или архив пуст.',
    IWXA_FILE_NAME_INVALID: 'Имя архива недопустимо для сохранения.',
    IWXA_FILE_SELECTION_CHANGED: 'Выбранный архив изменился. Повторите сохранение для текущего выбора.',
    IWXA_FILE_UNCONFIRMED: 'Не удалось подтвердить записанный файл. Возможно, он уже создан. Проверьте его отдельно.',
    IWXA_FILE_RECEIPT_INVALID: 'Подтверждение сохранения не получено. Проверьте файл отдельно.',
  })[code] || 'Сохранение файла не подтверждено. Проверьте выбранное место.';
}
