/* Import lifecycle cues: transitions only, never repeated queue renders. */
(() => {
  const audio = window.soloSound;
  if (!audio) return;
  const known = new Map();
  const names = {queued:'import-read', processing:'import-processing', completed:'import-success', failed:'import-failure'};
  const startedAt = Date.now();
  let baseline = false, sequence = 0, generation = 0, timer = null, active = null;
  let queue = [];
  function remember(id, status) {
    known.set(id, status);
    while (known.size > 512) known.delete(known.keys().next().value);
  }
  async function pump() {
    if (active || !queue.length) return;
    if (!audio.canImport()) { queue = []; return; }
    const item = active = queue.shift(), run = generation;
    // A throttled background tab must not play a backlog on becoming visible.
    if (Date.now() - item.at > 15000) { active = null; void pump(); return; }
    let duration = 0;
    try { duration = await audio.playImport(item.name); } catch { /* Audio never blocks OCR. */ }
    if (run !== generation) return;
    timer = setTimeout(() => { timer = null; active = null; void pump(); }, Math.max(60, Number(duration || 0) * 1000 + 40));
  }
  function enqueue(id, name) {
    if (!audio.canImport()) return;
    // Coalesce bursts of captures; a short signal describes the phase, not a count.
    if (queue.some(item => item.name === name)) return;
    queue.push({id, name, at:Date.now()});
    if (queue.length > 6) queue.shift();
    void pump();
  }
  function phase(id, status) {
    if (!id || !names[status]) return;
    const previous = known.get(id);
    if (previous === status || ['completed', 'failed', 'cancelled'].includes(previous)) return;
    remember(id, status);
    window.soloEffects?.importPhase(id, status);
    if (['completed', 'failed'].includes(status)) {
      queue = queue.filter(item => item.id !== id);
    } else if (!previous && status === 'processing') {
      enqueue(id, names.queued);
    }
    enqueue(id, names[status]);
  }
  function cancel(id) {
    remember(id, 'cancelled');
    window.soloEffects?.cancelImport(id);
    queue = queue.filter(item => item.id !== id);
    if (active?.id === id) {
      generation += 1; clearTimeout(timer); timer = null; active = null;
      audio.stopImport(); void pump();
    }
  }
  window.soloImportSounds = {
    observe(jobs) {
      for (const job of jobs) {
        if (!job?.id || !names[job.status]) continue;
        if (!baseline || (!known.has(job.id) && Date.parse(job.createdAt) < startedAt)) {
          remember(job.id, job.status);
        } else {
          phase(job.id, job.status);
        }
      }
      baseline = true;
    },
    begin(event) {
      if (!event?.isTrusted) return null;
      audio.unlock();
      const id = `manual-${++sequence}`;
      phase(id, 'queued');
      return {processing:() => phase(id, 'processing'), success:() => phase(id, 'completed'), error:() => phase(id, 'failed'), cancel:() => cancel(id)};
    },
    clear() {
      generation += 1; clearTimeout(timer); timer = null; active = null; queue = [];
      audio.stopImport();
    },
  };
})();
