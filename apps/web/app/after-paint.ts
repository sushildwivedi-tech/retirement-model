/**
 * Run blocking work only after the browser has painted whatever came before it.
 *
 * Two animation frames give React time to commit a "running" state and the browser time
 * to paint it, so the user sees the message before the main thread locks up.
 *
 * The timeout is not belt and braces, it is load bearing: browsers throttle or suspend
 * `requestAnimationFrame` in a hidden or backgrounded tab, so on its own the work would
 * simply never start for anyone who clicked Run and switched away. Whichever fires first
 * wins, and the guard makes sure the work happens exactly once.
 */
export function afterPaint(work: () => void, fallbackMs = 100): void {
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    work();
  };
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => requestAnimationFrame(go));
  }
  setTimeout(go, fallbackMs);
}
