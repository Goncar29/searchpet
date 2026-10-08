/**
 * What a lazy route shows while its chunk downloads. It is empty on purpose:
 * the wait is usually a few hundred milliseconds, and a spinner that flashes
 * for that long reads as a glitch. It reserves height so the footer does not
 * jump up under the navbar and then back down (layout shift).
 */
export function RouteFallback() {
  return <div className="min-h-[60vh]" aria-busy="true" />;
}
