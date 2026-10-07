// Transport only: bounded JSON requests and the shared-state wire contract.
(function registerStateApi(root) {
  function create({ fetch, clientVersion, onVersionMismatch = () => {}, timeoutMs = 10000 }) {
    async function requestJson(url, options = {}, timeout = timeoutMs) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        const payload = await response.json();
        if (response.status === 428 && payload.error === 'client_version_mismatch') onVersionMismatch();
        return { response, payload };
      } finally { clearTimeout(timer); }
    }
    function validate(payload) {
      if (!payload || (payload.scope && payload.scope !== 'solo')
        || !Object.hasOwn(payload, 'state') || !Object.hasOwn(payload, 'updatedAt')
        || (payload.state !== null && (typeof payload.state !== 'object' || Array.isArray(payload.state)))
        || (payload.updatedAt !== null && typeof payload.updatedAt !== 'string')) {
        throw new Error('solo_state_invalid');
      }
      return payload;
    }
    async function fetchState() {
      const { response, payload } = await requestJson('./api/state?scope=solo', {cache:'no-store'});
      if (!response.ok) throw new Error('solo_state_unavailable');
      return validate(payload);
    }
    async function saveState(state, revision, importIds) {
      const body = { state, baseUpdatedAt:revision, clientVersion:clientVersion() };
      if (importIds) body.importIds = importIds;
      const result = await requestJson('./api/state?scope=solo', {
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body),
      });
      if (result.response.status === 409) validate(result.payload);
      if (result.response.ok && typeof result.payload?.updatedAt !== 'string') throw new Error('solo_state_invalid');
      return result;
    }
    return Object.freeze({ requestJson, fetchState, saveState });
  }
  const api = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.StateApi = api;
})(globalThis);
