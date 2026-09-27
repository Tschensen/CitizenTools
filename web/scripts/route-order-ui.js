// Shared manual flight plan; pointer handles work with mouse, pen and touch.
function renderRunRouteOrderControls(points, index) {
  const button = (direction, path) => {
    const label = t(`run.route.move.${direction < 0 ? 'up' : 'down'}`, { location: points[index].dropoff });
    const boundary = index + direction < 0 || index + direction >= points.length;
    const disabled = !RouteOptimizer.moveRouteStop(points, index, index + direction);
    return `<button type="button" class="secondary-button icon-only-button route-order-arrow" data-route-move="${direction}" aria-label="${escapeHtml(label)}" title="${escapeHtml(disabled && !boundary ? t('run.route.order.constraint') : label)}" ${disabled ? 'disabled' : ''}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg></button>`;
  };
  return `<div class="route-order-controls"><button type="button" class="secondary-button icon-only-button route-order-handle" aria-label="${escapeHtml(t('run.route.move.drag', { location: points[index].dropoff }))}" title="${escapeHtml(t('run.route.move.drag', { location: points[index].dropoff }))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h1m6 0h1M8 12h1m6 0h1M8 19h1m6 0h1"/></svg></button><div>${button(-1, 'm6 15 6-6 6 6')}${button(1, 'm6 9 6 6 6-6')}</div></div>`;
}

function moveRunRouteStop(from, to) {
  const points = buildRunRouteState().openPoints;
  const reordered = RouteOptimizer.moveRouteStop(points, from, to);
  if (!reordered || from === to) {
    if (!reordered) document.getElementById('runRouteOrderStatus').textContent = t('run.route.order.constraint');
    return false;
  }
  state.runRouteOrder ||= {};
  state.runRouteOrder[state.activeFleetEntryId] = reordered.flatMap(point => point.routeTaskIds);
  state.runPriorityRouteLocation = '';
  state.selectedRunRoutePointKey = '';
  persist();
  render();
  document.getElementById('runRouteOrderStatus').textContent = t('run.route.order.saved');
  const firstTask = points[from].routeTaskIds[0];
  const newIndex = buildRunRouteState().openPoints.findIndex(point => point.routeTaskIds.includes(firstTask));
  runRouteList.querySelector(`[data-route-order-index="${newIndex}"] .route-order-handle`)?.focus({ preventScroll: true });
  return true;
}

function bindRunRouteOrdering(runState) {
  const reset = document.getElementById('runRouteOrderReset');
  reset.disabled = !state.runRouteOrder?.[state.activeFleetEntryId]?.length && !state.runPriorityRouteLocation;
  reset.onclick = () => {
    if (state.runRouteOrder) delete state.runRouteOrder[state.activeFleetEntryId];
    state.runPriorityRouteLocation = '';
    state.selectedRunRoutePointKey = '';
    persist(); render();
  };
  document.getElementById('runRouteOrderStatus').textContent = '';
  runRouteList.querySelectorAll('[data-route-order-index]').forEach(row => {
    const from = Number(row.dataset.routeOrderIndex);
    row.querySelectorAll('[data-route-move]').forEach(button => {
      button.onclick = () => moveRunRouteStop(from, from + Number(button.dataset.routeMove));
    });
    const handle = row.querySelector('.route-order-handle');
    handle.onkeydown = event => {
      if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      moveRunRouteStop(from, from + (event.key === 'ArrowUp' ? -1 : 1));
    };
    let drag = null;
    const clear = () => runRouteList.querySelectorAll('.is-dragging,.is-drop-before,.is-drop-after').forEach(item => item.classList.remove('is-dragging', 'is-drop-before', 'is-drop-after'));
    handle.onpointerdown = event => {
      if (event.button !== 0 || runState.openPoints.length < 2) return;
      event.preventDefault();
      drag = { y: event.clientY, to: from, active: false };
      row.classList.add('is-dragging');
      handle.setPointerCapture(event.pointerId);
    };
    handle.onpointermove = event => {
      if (!drag || (!drag.active && Math.abs(event.clientY - drag.y) < 8)) return;
      drag.active = true;
      clear();
      row.classList.add('is-dragging');
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-route-order-index]');
      drag.to = from;
      if (target && runRouteList.contains(target)) {
        const index = Number(target.dataset.routeOrderIndex);
        const bounds = target.getBoundingClientRect();
        const after = event.clientY > bounds.top + bounds.height / 2;
        const insertion = index + (after ? 1 : 0);
        drag.to = Math.max(0, Math.min(runState.openPoints.length - 1, insertion - (from < insertion ? 1 : 0)));
        target.classList.add(after ? 'is-drop-after' : 'is-drop-before');
      }
      if (event.clientY > innerHeight - 55) window.scrollBy(0, 15);
      else if (event.clientY < 55) window.scrollBy(0, -15);
    };
    handle.onpointerup = event => {
      const previous = drag;
      drag = null; clear();
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      if (previous?.active) moveRunRouteStop(from, previous.to);
    };
    handle.onpointercancel = handle.onlostpointercapture = () => { drag = null; clear(); };
  });
}
