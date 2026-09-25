// Rebase independent edits onto the shared state. A record is atomic: two
// different edits to the same mission must never silently combine its cargo,
// completion and payment data. Unchanged records and deletions are preserved.
function soloEqual(left, right) {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length
    && keys.every(key => Object.hasOwn(right, key) && soloEqual(left[key], right[key]));
}

function soloMergeStates(base, local, remote) {
  const collections = new Set(["missions", "fleet", "pilots", "ledgerEntries", "shipLibrary", "contacts", "stopHistory"]);
  function choose(before, ours, theirs) {
    if (soloEqual(ours, before)) return theirs;
    if (soloEqual(theirs, before) || soloEqual(ours, theirs)) return ours;
    throw new Error("overlapping_edit");
  }
  function records(before, ours, theirs) {
    const index = items => {
      const entries = new Map();
      for (const item of items) {
        if (!item?.id || entries.has(item.id)) throw new Error("ambiguous_record");
        entries.set(item.id, item);
      }
      return entries;
    };
    const b = index(before), l = index(ours), r = index(theirs), merged = new Map();
    for (const id of new Set([...b.keys(), ...l.keys(), ...r.keys()])) {
      const item = choose(b.get(id), l.get(id), r.get(id));
      if (item !== undefined) merged.set(id, item);
    }
    // Preserve intentional reordering, while including additions from both.
    const common = [...b.keys()].filter(id => l.has(id) && r.has(id));
    const commonOrder = items => items.map(item => item.id).filter(id => common.includes(id));
    const order = choose(common, commonOrder(ours), commonOrder(theirs));
    const primary = soloEqual(order, commonOrder(ours)) && !soloEqual(order, common) ? ours : theirs;
    return [...new Set([...primary, ...ours, ...theirs].map(item => item.id))]
      .filter(id => merged.has(id)).map(id => merged.get(id));
  }
  function progress(before, ours, theirs) {
    return [...new Set([...theirs.filter(id => !before.includes(id) || ours.includes(id)),
      ...ours.filter(id => !before.includes(id))])];
  }
  try {
    const value = {};
    for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
      const b = base[key], l = local[key], r = remote[key];
      let item;
      if (soloEqual(l, b) || soloEqual(r, b) || soloEqual(l, r)) item = choose(b, l, r);
      else if (collections.has(key) && [b, l, r].every(Array.isArray)) item = records(b, l, r);
      else if (key === "runCompletedRoutePoints" && [b, l, r].every(Array.isArray)) item = progress(b, l, r);
      else if (key === "runRouteProgress" && b && l && r) {
        item = Object.fromEntries([...new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])]
          .map(id => [id, progress(b[id] || [], l[id] || [], r[id] || [])]));
      } else item = choose(b, l, r);
      if (item !== undefined) value[key] = item;
    }
    return { ok: true, state: cloneData(value) };
  } catch { return { ok: false }; }
}
