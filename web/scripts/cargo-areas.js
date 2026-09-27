(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CargoAreas = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const colors = ['#58bde8', '#e9b75d', '#a98ce8', '#65cf9b', '#ef899d', '#79c9c0'];
  const position = slot => {
    const match = String(slot).match(/^([A-Z]+)([1-9]\d*)$/);
    if (!match) return null;
    const row = [...match[1]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
    return { row, col: Number(match[2]) - 1 };
  };
  const slotId = (row, col) => {
    let label = '', n = row + 1;
    while (n > 0) { label = String.fromCharCode(65 + (n - 1) % 26) + label; n = Math.floor((n - 1) / 26); }
    return label + (col + 1);
  };
  function normalize(value, heights) {
    const used = new Set(), ids = new Set();
    return (Array.isArray(value) ? value : []).slice(0, 40).flatMap((area, index) => {
      const id = typeof area?.id === 'string' ? area.id.trim().slice(0, 100) : '';
      if (!id || id === '__remaining__' || ids.has(id)) return [];
      ids.add(id);
      const slots = [...new Set(Array.isArray(area.slots) ? area.slots : [])]
        .filter(slot => typeof slot === 'string' && position(slot) && Number(heights[slot]) > 0 && !used.has(slot));
      slots.forEach(slot => used.add(slot));
      return [{ id, name: String(area.name || '').trim().slice(0, 48) || `Bereich ${index + 1}`,
        nameEn: String(area.nameEn || '').trim().slice(0, 48),
        color: /^#[\da-f]{6}$/i.test(area.color) ? area.color : colors[index % colors.length], slots }];
    });
  }
  function defaults(heights, presetId = '') {
    const slots = Object.keys(heights).filter(slot => position(slot) && Number(heights[slot]) > 0)
      .sort((a, b) => position(a).row - position(b).row || position(a).col - position(b).col);
    const named = (id, name, nameEn, selected, index) => ({ id: `hold-${id}`, name, nameEn, color: colors[index], slots: selected });
    let areas;
    if (presetId === 'hermes') areas = [
      named('left', 'Links', 'Left', slots.filter(s => position(s).col < 4), 0),
      named('right', 'Rechts', 'Right', slots.filter(s => position(s).col > 4), 1),
    ];
    else if (presetId === 'origin_315p') areas = [
      named('front', 'Vorne', 'Front', slots.filter(s => position(s).row < 4), 0),
      named('rear', 'Hinten', 'Rear', slots.filter(s => position(s).row >= 6), 1),
    ];
    else if (presetId === 'starlancer_max') areas = [
      named('left', 'Links', 'Left', slots.filter(s => position(s).row < 16 && position(s).col < 2), 0),
      named('right', 'Rechts', 'Right', slots.filter(s => position(s).row < 16 && position(s).col > 2), 1),
      named('rear', 'Heck', 'Rear', slots.filter(s => position(s).row >= 18), 2),
    ];
    if (areas) return areas.filter(area => area.slots.length);
    const remaining = new Set(slots), groups = [];
    while (remaining.size) {
      const first = remaining.values().next().value, group = [first];
      remaining.delete(first);
      for (let i = 0; i < group.length; i++) {
        const { row, col } = position(group[i]);
        for (const [r, c] of [[row-1,col],[row+1,col],[row,col-1],[row,col+1]]) {
          if (r < 0 || c < 0) continue;
          const next = slotId(r,c);
          if (remaining.delete(next)) group.push(next);
        }
      }
      groups.push(group);
    }
    return groups.map((group, i) => named(`grid-${group[0]}`, groups.length === 1 ? 'Laderaum' : `Bereich ${i+1}`,
      groups.length === 1 ? 'Cargo hold' : `Area ${i+1}`, group, i % colors.length));
  }
  function slotOwners(areas) {
    return new Map(areas.flatMap(area => area.slots.map(slot => [slot, area.id])));
  }
  // null denotes a container crossing a boundary; '' is wholly unassigned space.
  function containingArea(footprint, owners) {
    const ids = new Set(footprint.map(cell => owners.get(slotId(cell.row, cell.col)) || ''));
    return ids.size === 1 ? [...ids][0] : null;
  }
  return { colors, normalize, defaults, slotOwners, containingArea, slotId };
});
