async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function executeWithRetry(taskFn, options = {}) {
  const maxAttempts = Math.max(1, Number(options.maxAttempts || 5));
  const baseDelayMs = Math.max(100, Number(options.baseDelayMs || 1000));
  const factor = Math.max(1, Number(options.factor || 2));
  const onRetry = typeof options.onRetry === 'function' ? options.onRetry : null;

  let attempt = 0;
  let lastError = null;
  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      const result = await taskFn(attempt);
      return { result, attemptCount: attempt };
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) break;
      const delay = Math.round(baseDelayMs * Math.pow(factor, attempt - 1));
      if (onRetry) onRetry({ attempt, delay, error });
      await sleep(delay);
    }
  }
  throw Object.assign(lastError || new Error('执行失败'), { attemptCount: maxAttempts });
}

module.exports = {
  executeWithRetry,
};

