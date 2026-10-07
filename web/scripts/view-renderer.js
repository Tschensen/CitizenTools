// Synchronous view invalidation. Hidden views keep their dirty state until shown.
(function registerViewRenderer(root) {
  function create({views, getPage}) {
    const dirty = new Set(views.map(view => view.id));
    const rendering = new Set();
    let previousPage = null;
    const ids = new Set(dirty);
    if (ids.size !== views.length) throw new Error('duplicate_view_id');
    function invalidate(names = ids) {
      for (const name of names) {
        if (!ids.has(name)) throw new Error('unknown_view: ' + name);
        dirty.add(name);
      }
    }
    function render(page = getPage()) {
      const entered = page !== previousPage;
      const previous = previousPage;
      previousPage = page;
      for (const view of views) {
        // Re-entering refreshes time-sensitive information too (e.g. Today).
        // Shared grid previews remain current while moving between cargo pages.
        if (entered && view.pages.includes(page) && !view.pages.includes(previous)) dirty.add(view.id);
        if (!view.pages.includes(page) || !dirty.has(view.id) || rendering.has(view.id)) continue;
        dirty.delete(view.id);
        rendering.add(view.id);
        try { view.render(); }
        catch (error) { dirty.add(view.id); throw error; }
        finally { rendering.delete(view.id); }
      }
    }
    return Object.freeze({invalidate, render});
  }
  const api = {create};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ViewRenderer = api;
})(globalThis);
