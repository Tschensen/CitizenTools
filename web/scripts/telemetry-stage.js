// Stage against a private copy. Shared state changes only after the atomic server commit.
function stageTelemetryEvent(event, plan, settings) {
  const previous = state;
  const oldPlan = lastUnloadPlan;
  state = cloneData(state);
  try {
    const mission = state.missions.find(item => item.id === plan.missionId);
    if (plan.action === 'ship') {
      state.activeFleetEntryId = plan.fleetId;
      // This function executes synchronously unless confirmation is requested.
      syncLayoutToActiveFleetShip({persistChanges:false});
      state.selectedRunRoutePointKey = '';
    } else if (plan.action === 'location') {
      state.currentLocation = plan.value;
      if (settings.logAutoRoute) {
        consumeRunRoutePriority(plan.value);
        const route = buildRunRouteState();
        const point = route.openPoints.find(item => TelemetryDomain.key(item.dropoff) === TelemetryDomain.key(plan.value));
        if (point) {
          state.selectedRunRoutePointKey = point.key;
          if (point.hasCargo || point.hasService) selectStopByDropoff(point.dropoff);
        }
      }
    } else if (plan.action === 'complete') {
      unloadMissionLoadsForCompletion(mission, event.at);
      markMissionCompleted(mission, {completedAt:event.at, bookIncome:false});
      for (const item of mission.serviceDetails?.packages || []) { item.pickedUpAt ||= event.at; item.deliveredAt ||= event.at; }
      state.selectedRunRoutePointKey = '';
    } else if (plan.action === 'package') {
      const item = mission.serviceDetails.packages.find(item => item.id === plan.targetId);
      item.pickedUpAt ||= event.at;
      if (plan.kind === 'dropoff') item.deliveredAt ||= event.at;
      state.selectedRunRoutePointKey = '';
    } else if (plan.action === 'cargo') {
      const segment = mission.segments.find(item => item.id === plan.targetId);
      const loads = mission.loads.filter(load => load.segmentId === segment.id && !isLoadDelivered(load));
      if (plan.kind === 'pickup') {
        if (mission.assignedFleetEntryId !== state.activeFleetEntryId || segment.quantityPending || !loads.length) return null;
        autoLoadEntries(loads.filter(load => !load.placement).map(load => ({mission, load})), {persistAfter:false, renderAfter:false, recordUndo:false, settings:getAutoloadSettings()});
        if (!loads.every(load => isLoadPlacementInCurrentLayout(load, mission))) return null;
        state.runCompletedRoutePoints = [...new Set([...(state.runCompletedRoutePoints || []), getRunPickupTaskCompletionKey(mission, segment)])];
      } else {
        const snapshot = captureDeliveryUndo(loads.map(load => ({mission, load})));
        for (const load of loads) { load.deliveredByFleetEntryId = getLoadPlacementFleetEntryId(load, mission); load.placement = null; load.deliveredAt = event.at; }
        if (loads.length) state.stopHistory.unshift({id:event.id, dropoff:segment.dropoff, pickups:[segment.pickup], missionIds:[mission.id], missionTitles:[mission.title], loadCount:loads.length,
          scu:loads.reduce((sum, load) => sum + Number(load.scu || 0), 0), completedAt:event.at, note:'Game.log', order:state.stopHistory.length,
          deliveryUndo:finishDeliveryUndo(snapshot)});
      }
      state.selectedRunRoutePointKey = '';
    } else if (plan.action === 'balance') {
      state.telemetryBalance = TelemetryDomain.balance(event);
    }
    return {state:soloCleanState(state), telemetryIds:[event.id]};
  } finally { state = previous; lastUnloadPlan = oldPlan; }
}
