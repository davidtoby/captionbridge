export const DEFAULT_POSITION = Object.freeze({ x: 0.5, y: 0.84 });
export function normalizePosition(value) {
  return { x: Number.isFinite(value?.x) ? Math.max(0, Math.min(1, value.x)) : DEFAULT_POSITION.x,
    y: Number.isFinite(value?.y) ? Math.max(0, Math.min(1, value.y)) : DEFAULT_POSITION.y };
}
export function clampPosition(value, parent, box, padding = 8) {
  const position = normalizePosition(value);
  if (!(parent.width > 0 && parent.height > 0)) return position;
  const dx = Math.min(0.5, (box.width / 2 + padding) / parent.width);
  const dy = Math.min(0.5, (box.height / 2 + padding) / parent.height);
  return { x: Math.max(dx, Math.min(1 - dx, position.x)), y: Math.max(dy, Math.min(1 - dy, position.y)) };
}

export function attachDraggableOverlay({ host, handle, box, player, getPosition, onSave }) {
  // Non-layout DOMs (unit tests) cannot compute position. The real browser path
  // below is covered by pointer, keyboard, resize, and fullscreen browser checks.
  if (typeof player.getBoundingClientRect !== 'function') return { update() {}, destroy() {} };
  let position = normalizePosition(getPosition()); let drag = null; let destroyed = false;
  const listeners = [];
  function listen(target, name, fn, options) { target.addEventListener(name, fn, options); listeners.push(() => target.removeEventListener(name, fn, options)); }
  function apply(next = position) {
    if (destroyed) return;
    const bounds = player.getBoundingClientRect();
    position = clampPosition(next, bounds, host.getBoundingClientRect());
    host.style.left = `${position.x * 100}%`; host.style.top = `${position.y * 100}%`;
  }
  function finish(event, cancelled = false) {
    if (!drag || (event?.pointerId !== undefined && event.pointerId !== drag.id)) return;
    const id = drag.id; const before = drag.before; drag = null;
    box.classList.remove('dragging');
    try { box.releasePointerCapture(id); } catch { /* Capture may already be gone. */ }
    if (cancelled) apply(before); else onSave({ ...position });
  }
  listen(box, 'pointerdown', event => {
    if (event.button !== 0 || event.isPrimary === false) return;
    event.preventDefault(); event.stopPropagation();
    const rect = host.getBoundingClientRect();
    drag = { id: event.pointerId, before: { ...position }, dx: event.clientX - rect.left - rect.width / 2, dy: event.clientY - rect.top - rect.height / 2 };
    box.classList.add('dragging'); box.setPointerCapture(event.pointerId);
    handle.focus({ preventScroll: true });
  });
  listen(box, 'pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    event.preventDefault(); event.stopPropagation();
    const rect = player.getBoundingClientRect();
    if (rect.width && rect.height) apply({ x: (event.clientX - rect.left - drag.dx) / rect.width, y: (event.clientY - rect.top - drag.dy) / rect.height });
  });
  listen(box, 'pointerup', event => { if (drag) { event.preventDefault(); event.stopPropagation(); finish(event); } });
  listen(box, 'pointercancel', event => finish(event, true));
  listen(box, 'lostpointercapture', event => finish(event));
  // Prevent clicks/double clicks from pausing or toggling fullscreen in YouTube.
  listen(box, 'click', event => { event.preventDefault(); event.stopPropagation(); });
  listen(box, 'dblclick', event => { event.preventDefault(); event.stopPropagation(); });
  listen(handle, 'keydown', event => {
    if (event.key === 'Escape' && drag) { event.preventDefault(); event.stopPropagation(); finish(null, true); return; }
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const step = event.shiftKey ? 0.08 : 0.02;
    const next = event.key === 'Home' ? DEFAULT_POSITION : { ...position };
    if (event.key === 'ArrowUp') next.y -= step;
    if (event.key === 'ArrowDown') next.y += step;
    if (event.key === 'ArrowLeft') next.x -= step;
    if (event.key === 'ArrowRight') next.x += step;
    apply(next); onSave({ ...position });
  });
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => apply(drag ? position : normalizePosition(getPosition()))) : null;
  resize?.observe(player); resize?.observe(host);
  listen(document, 'fullscreenchange', () => { finish(null); apply(normalizePosition(getPosition())); });
  listen(window, 'resize', () => apply(normalizePosition(getPosition())));
  apply();
  return {
    update() { if (!drag) apply(normalizePosition(getPosition())); },
    destroy() { destroyed = true; drag = null; resize?.disconnect(); listeners.forEach(remove => remove()); },
  };
}
