/**
 * Drain network handles before process.exit on Windows.
 * Node + undici can abort with UV_HANDLE_CLOSING in src/win/async.c if exit
 * races keep-alive worker teardown (nodejs/node#56645).
 */

const WIN_DRAIN_MS = 100;

export async function exitAfterNetwork(code = 0) {
  try {
    const undici = await import('undici');
    const dispatcher = undici.getGlobalDispatcher?.();
    if (dispatcher && typeof dispatcher.close === 'function') {
      await dispatcher.close();
    }
  } catch {
    /* undici unused or already closed */
  }
  if (process.platform === 'win32') {
    await new Promise((resolve) => setTimeout(resolve, WIN_DRAIN_MS));
  }
  process.exit(code);
}
