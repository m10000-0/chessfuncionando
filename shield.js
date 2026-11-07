let triggered = false;

export function maybeFireShield() {
  if (triggered) return false;
  triggered = true;
  window.parent.postMessage({ type: 'lc-shield' }, '*');
  return true;
}
