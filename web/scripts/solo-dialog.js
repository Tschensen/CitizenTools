/* Keyboard focus and background isolation shared by the setup and layout dialogs. */
window.createSoloDialog = (backdrop, onClose = () => {}, canClose = () => true) => {
  let previous, overflow, background = [];
  const focusable = () => [...backdrop.querySelectorAll('button,input,select,textarea,a[href],[tabindex="0"]')].filter(node => !node.disabled && node.getClientRects().length);
  function close() {
    if (backdrop.hidden || !canClose()) return;
    backdrop.hidden = true;
    background.forEach(([node, inert]) => { node.inert = inert; });
    document.body.style.overflow = overflow;
    onClose(); previous?.focus();
  }
  backdrop.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key !== 'Tab') return;
    const items = focusable(), first = items[0], last = items.at(-1);
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || !backdrop.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  return {close, open() {
    if (!backdrop.hidden) return;
    previous = document.activeElement; overflow = document.body.style.overflow;
    background = [...document.body.children].filter(node => node !== backdrop && !['SCRIPT','STYLE'].includes(node.tagName)).map(node => [node, node.inert]);
    background.forEach(([node]) => { node.inert = true; });
    backdrop.hidden = false; document.body.style.overflow = 'hidden';
    focusable()[0]?.focus();
  }};
};
