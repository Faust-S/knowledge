export class BrowserInferenceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BrowserInferenceError';
    this.code = code;
  }
}

export function decideLoad({ cachedWeights, networkConsent }) {
  if (networkConsent !== true && !cachedWeights) {
    throw new BrowserInferenceError('MODEL_NOT_CACHED', 'Нет сохранённых весов модели. Разрешите загрузку отдельно.');
  }
  return Object.freeze({ networkAllowed: networkConsent === true });
}

export function requirePrompt(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new BrowserInferenceError('EMPTY_PROMPT', 'Введите текст для обработки.');
  }
  if (value.length > 6000) {
    throw new BrowserInferenceError('CONTEXT_TOO_LARGE', 'Для прототипа допускается до 6000 символов.');
  }
  return value.trim();
}

export function humanError(error) {
  const code = error?.code || '';
  if (code === 'MODEL_NOT_CACHED' || code === 'CANCELLED') return error.message;
  if (code === 'EMPTY_PROMPT' || code === 'CONTEXT_TOO_LARGE') return error.message;
  const msg = typeof error?.message === 'string' ? error.message : String(error);
  if (/GPU|adapter|WebGPU/i.test(msg)) return 'WebGPU недоступен или модель не поместилась в память. Проверьте настройки браузера и GPU.';
  if (/quota|storage/i.test(msg)) return 'Недостаточно места в хранилище браузера.';
  if (/network|fetch|offline/i.test(msg)) return 'Не удалось получить обязательные файлы модели. Повторите после восстановления сети или кеша.';
  return 'Не удалось завершить операцию. Подробности доступны в консоли разработчика.';
}
