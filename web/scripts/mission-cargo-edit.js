// Cargo draft rules with explicit dependencies; no DOM, persistence or global state.
(function registerMissionCargoEdit(root) {
  function create({ getMissionSegments, createLoad }) {
    function createLoadsFromConsignments(consignments) {
      return consignments
        .filter((consignment) => consignment.isPlaceable)
        .flatMap((consignment) =>
          Array.from({ length: consignment.quantity }, (_, index) =>
            createLoad({
              label: consignment.quantity > 1 ? `${consignment.title} #${index + 1}` : consignment.title,
              width: consignment.width,
              depth: consignment.depth,
              height: consignment.height,
              pickup: consignment.pickup,
              dropoff: consignment.dropoff,
              segmentId: consignment.id,
              cargoTitle: consignment.title,
            }),
          ),
        );
    }

    function getCargoRouteIdentity(segment, fallbackIndex = 0) {
      const cargoIndex = Number(segment?.cargoIndex);
      const routeIndex = Number(segment?.cargoRouteIndex);
      if (Number.isInteger(cargoIndex) && Number.isInteger(routeIndex)) {
        return `indexed:${cargoIndex}:${routeIndex}`;
      }

      const normalizePart = (value) => String(value || "").trim().toLocaleLowerCase("de-DE");
      return [
        "legacy",
        normalizePart(segment?.title),
        normalizePart(segment?.pickup),
        normalizePart(segment?.dropoff),
        fallbackIndex,
      ].join(":");
    }

    function groupCargoSegmentsByRoute(segments) {
      const routes = new Map();
      (Array.isArray(segments) ? segments : []).forEach((segment, index) => {
        const key = getCargoRouteIdentity(segment, index);
        if (!routes.has(key)) {
          routes.set(key, {
            key,
            order: Number.isInteger(segment.order) ? segment.order : index,
            segments: [],
          });
        }
        routes.get(key).segments.push(segment);
      });
      return routes;
    }

    function getCargoRouteSignature(route) {
      return JSON.stringify(
        [...route.segments]
          .sort((left, right) =>
            (Number(left.cargoGroupIndex) || 0) - (Number(right.cargoGroupIndex) || 0),
          )
          .map((segment) => ({
            title: String(segment.title || "").trim(),
            pickup: String(segment.pickup || "").trim(),
            dropoff: String(segment.dropoff || "").trim(),
            quantity: Number(segment.quantity) || 0,
            containerSize: String(segment.containerSize || ""),
            width: Number(segment.width) || 0,
            depth: Number(segment.depth) || 0,
            height: Number(segment.height) || 0,
            isHandheld: Boolean(segment.isHandheld),
            isPlaceable: Boolean(segment.isPlaceable),
            routeTargetScu: Number(segment.routeTargetScu) || 0,
            quantityPending: Boolean(segment.quantityPending),
          })),
      );
    }

    function getCargoRouteStructureSignature(route) {
      return JSON.stringify(
        [...route.segments]
          .sort((left, right) =>
            (Number(left.cargoGroupIndex) || 0) - (Number(right.cargoGroupIndex) || 0),
          )
          .map((segment) => ({
            quantity: Number(segment.quantity) || 0,
            containerSize: String(segment.containerSize || ""),
            width: Number(segment.width) || 0,
            depth: Number(segment.depth) || 0,
            height: Number(segment.height) || 0,
            isHandheld: Boolean(segment.isHandheld),
            isPlaceable: Boolean(segment.isPlaceable),
            routeTargetScu: Number(segment.routeTargetScu) || 0,
            quantityPending: Boolean(segment.quantityPending),
          })),
      );
    }

    function mergeCargoMissionDraft(existingMission, draftSegments, { allowProgressRouteCorrection = false } = {}) {
      const existingSegments = getMissionSegments(existingMission);
      const existingLoads = Array.isArray(existingMission?.loads) ? existingMission.loads : [];
      const existingRoutes = groupCargoSegmentsByRoute(existingSegments);
      const draftRoutes = groupCargoSegmentsByRoute(draftSegments);
      const existingRouteBySegmentId = new Map();
      const handledExistingRouteKeys = new Set();
      const handledLoadIds = new Set();
      const segments = [];
      const loads = [];
      const newLoadIds = [];
      let blockedRouteCount = 0;

      existingRoutes.forEach((route) => {
        route.segments.forEach((segment) => existingRouteBySegmentId.set(String(segment.id), route.key));
      });

      const appendExistingRoute = (route, draftRoute = null, { applyRouteMetadata = false } = {}) => {
        const nextExpectedCargoScu = Number(draftRoute?.segments?.[0]?.expectedCargoScu);
        const draftSegmentsByGroup = new Map((draftRoute?.segments || []).map((segment, index) => {
          const groupIndex = Number(segment.cargoGroupIndex);
          return [Number.isInteger(groupIndex) ? groupIndex : index, segment];
        }));
        const mergedRouteSegments = route.segments.map((segment, index) => {
          const groupIndex = Number(segment.cargoGroupIndex);
          const draftSegment = draftSegmentsByGroup.get(Number.isInteger(groupIndex) ? groupIndex : index) || draftRoute?.segments?.[index] || null;
          return {
            ...segment,
            ...(Number.isFinite(nextExpectedCargoScu) ? { expectedCargoScu: nextExpectedCargoScu } : {}),
            ...(applyRouteMetadata && draftSegment
              ? {
                  title: draftSegment.title,
                  pickup: draftSegment.pickup,
                  dropoff: draftSegment.dropoff,
                }
              : {}),
          };
        });
        segments.push(...mergedRouteSegments);
        const mergedSegmentById = new Map(mergedRouteSegments.map((segment) => [String(segment.id), segment]));
        const segmentIds = new Set(route.segments.map((segment) => String(segment.id)));
        existingLoads.forEach((load) => {
          if (!segmentIds.has(String(load.segmentId)) || handledLoadIds.has(load.id)) return;
          const mergedSegment = mergedSegmentById.get(String(load.segmentId));
          loads.push(applyRouteMetadata && mergedSegment
            ? {
                ...load,
                pickup: mergedSegment.pickup,
                dropoff: mergedSegment.dropoff,
                cargoTitle: mergedSegment.title,
              }
            : load);
          handledLoadIds.add(load.id);
        });
      };

      const appendDraftRoute = (route) => {
        segments.push(...route.segments);
        const routeLoads = createLoadsFromConsignments(route.segments);
        loads.push(...routeLoads);
        newLoadIds.push(...routeLoads.map((load) => load.id));
      };

      const routeHasProgress = (route) => {
        const segmentIds = new Set(route.segments.map((segment) => String(segment.id)));
        return existingLoads.some((load) =>
          segmentIds.has(String(load.segmentId)) && (Boolean(load.placement) || Boolean(load.deliveredAt)),
        );
      };

      draftRoutes.forEach((draftRoute, key) => {
        const existingRoute = existingRoutes.get(key);
        if (!existingRoute) {
          appendDraftRoute(draftRoute);
          return;
        }

        handledExistingRouteKeys.add(key);
        const structureUnchanged = getCargoRouteSignature(existingRoute) === getCargoRouteSignature(draftRoute);
        if (structureUnchanged) {
          appendExistingRoute(existingRoute, draftRoute);
          return;
        }

        if (routeHasProgress(existingRoute)) {
          const structureUnchangedDespiteRouteEdit =
            getCargoRouteStructureSignature(existingRoute) === getCargoRouteStructureSignature(draftRoute);
          appendExistingRoute(existingRoute, draftRoute, { applyRouteMetadata: allowProgressRouteCorrection });
          if (!allowProgressRouteCorrection || !structureUnchangedDespiteRouteEdit) blockedRouteCount += 1;
          return;
        }

        appendDraftRoute(draftRoute);
      });

      existingRoutes.forEach((existingRoute, key) => {
        if (handledExistingRouteKeys.has(key)) return;
        if (!routeHasProgress(existingRoute)) return;
        appendExistingRoute(existingRoute);
        blockedRouteCount += 1;
      });

      // Keep legacy loads that cannot be mapped to a segment. Losing them would be worse
      // than retaining an old, incomplete data link during an edit.
      existingLoads.forEach((load) => {
        if (handledLoadIds.has(load.id) || existingRouteBySegmentId.has(String(load.segmentId))) return;
        loads.push(load);
        handledLoadIds.add(load.id);
      });

      segments.sort((left, right) => (Number(left.order) || 0) - (Number(right.order) || 0));

      return {
        segments,
        loads,
        newLoadIds,
        blockedRouteCount,
      };
    }

    return Object.freeze({ createLoads: createLoadsFromConsignments, mergeDraft: mergeCargoMissionDraft });
  }
  const api = { create };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MissionCargoEdit = api;
})(globalThis);
