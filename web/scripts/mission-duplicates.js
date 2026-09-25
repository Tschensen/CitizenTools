(function initMissionDuplicateDetector(globalScope) {
  const RECENT_CLOSED_WINDOW_MS = 24 * 60 * 60 * 1000;
  const PLACEHOLDER_PATTERN = /^(?:\d+\s+(?:ziele|starts)|ziel offen|einsatzort offen|location open|target open)$/i;
  const TITLE_NOISE = new Set([
    "auftrag",
    "auftraege",
    "contract",
    "contracts",
    "mission",
    "missions",
    "cargo",
    "delivery",
    "lieferung",
    "transport",
  ]);

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/&/g, " und ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  }

  function textTokens(value, { title = false } = {}) {
    return normalizeText(value)
      .split(" ")
      .filter((token) => token.length > 1 && (!title || !TITLE_NOISE.has(token)));
  }

  function diceCoefficient(leftValues, rightValues) {
    const left = new Set(leftValues);
    const right = new Set(rightValues);
    if (left.size === 0 || right.size === 0) return 0;
    let overlap = 0;
    left.forEach((value) => {
      if (right.has(value)) overlap += 1;
    });
    return (2 * overlap) / (left.size + right.size);
  }

  function bigrams(value) {
    const normalized = normalizeText(value).replace(/\s+/g, "");
    if (normalized.length < 2) return normalized ? [normalized] : [];
    const result = [];
    for (let index = 0; index < normalized.length - 1; index += 1) {
      result.push(normalized.slice(index, index + 2));
    }
    return result;
  }

  function textSimilarity(left, right, options = {}) {
    const normalizedLeft = normalizeText(left);
    const normalizedRight = normalizeText(right);
    if (!normalizedLeft || !normalizedRight) return null;
    if (normalizedLeft === normalizedRight) return 1;
    return Math.max(
      diceCoefficient(textTokens(left, options), textTokens(right, options)),
      diceCoefficient(bigrams(left), bigrams(right)),
    );
  }

  function normalizeLocation(value) {
    const location = String(value || "").trim();
    if (!location || PLACEHOLDER_PATTERN.test(location)) return "";
    return location;
  }

  function addLocation(target, value) {
    const location = normalizeLocation(value);
    if (location) target.push(location);
  }

  function uniqueTextValues(values) {
    const byKey = new Map();
    values.forEach((value) => {
      const key = normalizeText(value);
      if (key && !byKey.has(key)) byKey.set(key, String(value).trim());
    });
    return [...byKey.values()];
  }

  function extractRoute(mission) {
    const pickups = [];
    const dropoffs = [];
    addLocation(pickups, mission?.pickup);
    addLocation(dropoffs, mission?.dropoff);

    (Array.isArray(mission?.segments) ? mission.segments : []).forEach((segment) => {
      addLocation(pickups, segment?.pickup);
      addLocation(dropoffs, segment?.dropoff);
    });

    const details = mission?.serviceDetails && typeof mission.serviceDetails === "object"
      ? mission.serviceDetails
      : {};
    addLocation(dropoffs, details.location);
    addLocation(dropoffs, details.searchArea);
    (Array.isArray(details.packages) ? details.packages : []).forEach((entry) => {
      addLocation(pickups, entry?.pickup);
      addLocation(dropoffs, entry?.destination);
    });
    (Array.isArray(details.items) ? details.items : []).forEach((entry) => {
      addLocation(dropoffs, entry?.destination);
    });

    return {
      pickups: uniqueTextValues(pickups),
      dropoffs: uniqueTextValues(dropoffs),
    };
  }

  function collectionSimilarity(leftValues, rightValues) {
    if (leftValues.length === 0 || rightValues.length === 0) return null;
    const directionalScore = (source, target) => source.reduce((sum, value) => {
      const best = target.reduce((score, candidate) => (
        Math.max(score, textSimilarity(value, candidate) || 0)
      ), 0);
      return sum + best;
    }, 0) / source.length;
    return (directionalScore(leftValues, rightValues) + directionalScore(rightValues, leftValues)) / 2;
  }

  function routeSimilarity(left, right) {
    const leftRoute = extractRoute(left);
    const rightRoute = extractRoute(right);
    const scores = [
      collectionSimilarity(leftRoute.pickups, rightRoute.pickups),
      collectionSimilarity(leftRoute.dropoffs, rightRoute.dropoffs),
    ].filter((score) => score !== null);
    if (scores.length === 0) return null;
    return scores.reduce((sum, score) => sum + score, 0) / scores.length;
  }

  function missionAmount(mission) {
    const segments = Array.isArray(mission?.segments) ? mission.segments : [];
    if (segments.length > 0) {
      const routeAmounts = new Map();
      segments.forEach((segment, index) => {
        const hasCargoRoute = segment?.cargoIndex !== undefined || segment?.cargoRouteIndex !== undefined;
        const routeKey = hasCargoRoute
          ? `${segment?.cargoIndex ?? 0}:${segment?.cargoRouteIndex ?? index}`
          : String(segment?.id ?? index);
        const routeAmount = Number(segment?.routeTargetScu);
        const segmentAmount = Number(segment?.totalScu);
        if (Number.isFinite(routeAmount) && routeAmount > 0) {
          routeAmounts.set(routeKey, Math.max(routeAmounts.get(routeKey) || 0, routeAmount));
        } else if (Number.isFinite(segmentAmount) && segmentAmount > 0) {
          routeAmounts.set(routeKey, (routeAmounts.get(routeKey) || 0) + segmentAmount);
        }
      });
      const total = [...routeAmounts.values()].reduce((sum, value) => sum + value, 0);
      if (total > 0) return total;
    }

    const packages = Array.isArray(mission?.serviceDetails?.packages)
      ? mission.serviceDetails.packages
      : [];
    const packageTotal = packages.reduce((sum, entry) => sum + (Number(entry?.quantity) || 0), 0);
    return packageTotal > 0 ? packageTotal : null;
  }

  function numericSimilarity(leftValue, rightValue) {
    const left = Number(leftValue);
    const right = Number(rightValue);
    if (!Number.isFinite(left) || !Number.isFinite(right) || left <= 0 || right <= 0) return null;
    if (left === right) return 1;
    const relativeDifference = Math.abs(left - right) / Math.max(left, right);
    if (relativeDifference <= 0.01) return 0.98;
    if (relativeDifference <= 0.05) return 0.75;
    if (relativeDifference <= 0.1) return 0.45;
    return 0;
  }

  function missionTimestamp(mission) {
    const rawValue = mission?.paidAt || mission?.completedAt || mission?.createdAt;
    const value = new Date(rawValue || 0).getTime();
    return Number.isFinite(value) ? value : 0;
  }

  function isRelevantExistingMission(mission, now = Date.now()) {
    const status = String(mission?.status || "active").toLowerCase();
    if (["active", "open", "incomplete"].includes(status)) return true;
    const timestamp = missionTimestamp(mission);
    return timestamp > 0 && now - timestamp <= RECENT_CLOSED_WINDOW_MS;
  }

  function compareMissions(candidate, existing) {
    const candidateType = normalizeText(candidate?.type || "cargo");
    const existingType = normalizeText(existing?.type || "cargo");
    if (!candidateType || candidateType !== existingType) return null;

    const fields = [
      {
        key: "title",
        weight: 0.34,
        score: textSimilarity(candidate?.title, existing?.title, { title: true }),
        signalAt: 0.84,
      },
      {
        key: "customer",
        weight: 0.17,
        score: textSimilarity(candidate?.serviceDetails?.customer, existing?.serviceDetails?.customer),
        signalAt: 0.88,
      },
      {
        key: "route",
        weight: 0.3,
        score: routeSimilarity(candidate, existing),
        signalAt: 0.82,
      },
      {
        key: "payout",
        weight: 0.12,
        score: numericSimilarity(candidate?.payout, existing?.payout),
        signalAt: 0.98,
      },
      {
        key: "amount",
        weight: 0.07,
        score: numericSimilarity(missionAmount(candidate), missionAmount(existing)),
        signalAt: 0.98,
      },
    ].filter((field) => field.score !== null);

    if (fields.length < 2) return null;
    const totalWeight = fields.reduce((sum, field) => sum + field.weight, 0);
    const score = fields.reduce((sum, field) => sum + field.score * field.weight, 0) / totalWeight;
    const reasons = fields.filter((field) => field.score >= field.signalAt).map((field) => field.key);
    const hasIdentitySignal = reasons.includes("title") || reasons.includes("route");
    const enoughSignals = reasons.length >= 3 || (reasons.length >= 2 && hasIdentitySignal && score >= 0.82);
    if (score < 0.78 || !enoughSignals) return null;

    return {
      mission: existing,
      missionId: String(existing?.id || ""),
      title: String(existing?.title || "Unbenannter Auftrag"),
      score: Math.round(score * 100),
      reasons,
    };
  }

  function findPotentialDuplicates(candidate, missions, { now = Date.now(), limit = 3 } = {}) {
    return (Array.isArray(missions) ? missions : [])
      .filter((mission) => mission && mission !== candidate && String(mission.id || "") !== String(candidate?.id || ""))
      .filter((mission) => isRelevantExistingMission(mission, now))
      .map((mission) => compareMissions(candidate, mission))
      .filter(Boolean)
      .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title, "de"))
      .slice(0, Math.max(1, Number(limit) || 1));
  }

  const api = {
    compareMissions,
    findPotentialDuplicates,
    normalizeText,
  };

  globalScope.MissionDuplicateDetector = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
}(typeof window !== "undefined" ? window : globalThis));
