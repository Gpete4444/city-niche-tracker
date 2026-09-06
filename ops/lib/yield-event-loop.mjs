/** Let queued HTTP / SSE handlers run between long Accept / copy bursts. */
export function yieldEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}
