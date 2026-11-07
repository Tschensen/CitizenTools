// Replacement decisions use the same atomic shared-state commit as loss review.
function stageFleetLossReplacement(fleetId, lossId, choice, expectedReplacementId = '') {
  const copy = cloneData(state), source = copy.fleet.find(entry => entry.id === fleetId);
  if (!source || source.status !== 'destroyed' || source.logLoss?.id !== lossId
      || source.logLoss.status !== 'confirmed' || !FleetLog.sameIdentity(source.logIdentity, source.logLoss.identity)) return null;
  if (choice.mode === 'new') {
    const profile = copy.shipLibrary.find(entry => entry.id === source.shipId && !entry.archived);
    const date = normalizeDateInput(choice.acquiredOn), registration = String(choice.registration || '').trim();
    if (!profile || !date || date < source.endedOn || expectedReplacementId || FleetLog.replacement(copy, fleetId)
        || (registration && copy.fleet.some(entry => String(entry.registration || '').trim().toLowerCase() === registration.toLowerCase()))) return null;
    const replacement = createFleetReplacementEntry(source, registration, date);
    copy.fleet.unshift(replacement);
  } else if (choice.mode === 'existing' || choice.mode === 'unlink') {
    if (choice.mode === 'existing' && !choice.fleetId) return null;
    if (!FleetLog.linkReplacement(copy, fleetId, choice.mode === 'unlink' ? '' : choice.fleetId, expectedReplacementId)) return null;
  } else return null;
  return {state:soloCleanState(copy), telemetryIds:[]};
}

// Stage against a private copy. Shared state changes only after the atomic server commit.
function stageTelemetryEvent(event, plan, settings) {
  const previous = state;
  const oldPlan = lastUnloadPlan;
  state = cloneData(state);
  try {
    const mission = state.missions.find(item => item.id === plan.missionId);
    if (plan.action === 'ship_create') {
      const profile = FleetLog.profiles(event, state).find(item => item.id === plan.shipId);
      const identity = FleetLog.identity(event);
      if (!profile || !identity || !FleetLog.own(event, event.player)
          || state.fleet.some(entry => FleetLog.sameIdentity(entry.logIdentity, identity))) return null;
      const pilot = getSoloPilotProfile();
      const entry = createFleetEntry({manufacturer:profile.manufacturer, model:getShipEntryDisplayName(profile),
        shipId:profile.id, acquiredOn:formatDateForInput(new Date(event.at)), createdAt:event.at,
        ownerName:event.owner, pilotId:pilot?.id || '', pilotName:pilot?.name || event.player,
        logIdentity:identity});
      state.fleet.unshift(entry);
      plan = {...plan, action:'ship', fleetId:entry.id};
    }
    if (plan.action === 'ship_loss') {
      const entry = state.fleet.find(item => item.id === plan.fleetId);
      if (!entry || entry.status !== 'active' || !FleetLog.identity(event)
          || !FleetLog.own(event, event.player) || entry.logLoss?.id === event.id
          || (FleetLog.identity(entry.logIdentity) && !FleetLog.sameIdentity(entry.logIdentity, event))) return null;
      entry.logIdentity = FleetLog.identity(event);
      entry.logLoss = FleetLog.loss({id:event.id, at:event.at, identity:entry.logIdentity,
        status:'pending', evidence:event.evidence, zone:event.zone});
    } else if (plan.action === 'ship') {
      const entry = state.fleet.find(item => item.id === plan.fleetId);
      if (entry && typeof FleetLog !== 'undefined' && FleetLog.identity(event)) entry.logIdentity = FleetLog.identity(event);
      state.activeFleetEntryId = plan.fleetId;
      // This function executes synchronously unless confirmation is requested.
      syncLayoutToActiveFleetShip({persistChanges:false});
      state.selectedRunRoutePointKey = '';
    } else if (['location','location_unresolved'].includes(plan.action)) {
      state.currentLocation = plan.value;
      state.telemetryLocation = TelemetryDomain.locationObservation({id:event.id,at:event.at,raw:event.value,
        value:plan.value,session:event.session,locationContext:event.locationContext});
      if (!plan.value) state.selectedRunRoutePointKey = '';
      if (settings.logAutoRoute && plan.value) {
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
    } else if (plan.action === 'payment') {
      if (!mission || mission.status !== 'completed' || mission.paidAt || getMissionIncomeEntry(mission)
          || !Number.isSafeInteger(event.amount) || event.amount <= 0 || event.amount > 999999999999) return null;
      markMissionPaid(mission, {paidAt:event.at, amountAuec:event.amount});
      const income = getMissionIncomeEntry(mission);
      if (!income || income.amountAuec !== event.amount) return null;
      income.telemetryEventId = event.id;
      income.notes = cargoText('telemetry.payment.note', 'Auszahlung aus Game.log bestätigt.');
      if (Number(mission.payout) > 0 && event.amount !== Number(mission.payout)) {
        income.notes += ' ' + cargoText('telemetry.payment.expected', 'Ursprünglicher Auftragserlös: {amount} aUEC.',
          {amount:Number(mission.payout).toLocaleString(cargoLocale())});
      }
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
    return {state:soloCleanState(state), telemetryIds:plan.action === 'location_unresolved' ? [] : [event.id]};
  } finally { state = previous; lastUnloadPlan = oldPlan; }
}
