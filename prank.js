// Pegadinha: envia mensagem ao content script para rodar na página principal (tela inteira)
let triggered = false;

export function maybeFirePrank() {
  if (triggered) return false;
  triggered = true;
  window.parent.postMessage({ type: 'lc-prank' }, '*');
  return true;
}
