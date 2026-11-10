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
    if (mission?.logFailure?.status === 'blocked' && ['complete','payment','package','cargo'].includes(plan.action)) return null;
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
    } else if (plan.action === 'failed') {
      if (!mission || TelemetryDomain.links(state.telemetryLinks).missions[event.missionId] !== mission.id
          || mission.logFailure?.id === event.id) return null;
      mission.logFailure = normalizeMissionLogFailure({...event, status:'blocked'});
      if (!mission.logFailure) return null;
      state.selectedRunRoutePointKey = '';
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
      const snapshot = TelemetryDomain.balance(event);
      if (!snapshot) return null;
      state.balanceReconciliation = BalanceReconciliation.begin(state, snapshot);
      state.telemetryBalance = snapshot;
    }
    return {state:soloCleanState(state), telemetryIds:plan.action === 'location_unresolved' ? [] : [event.id]};
  } finally { state = previous; lastUnloadPlan = oldPlan; }
}

// Every decision is staged with the same compare-and-swap commit as imports.
function stageBalanceDecision(expected, choice) {
  const R = BalanceReconciliation, current = R.view(state);
  if (current.status !== 'pending' || current.key !== expected.key || current.ledgerStamp !== expected.ledgerStamp) return null;
  const previous = state, oldPlan = lastUnloadPlan;
  state = cloneData(state);
  try {
    const now = new Date().toISOString();
    if (choice.mode === 'dismiss') {
      state.balanceReconciliation = {...state.balanceReconciliation,status:'dismissed',reviewedAt:now};
    } else {
      const amount = Number(choice.amount), flow = current.difference > 0 ? 'income' : 'expense';
      if (!Number.isSafeInteger(amount) || amount <= 0 || amount > R.limit) return null;
      const note = cargoText('finance.reconcile.note','Bestätigter Kontostandsabgleich aus einem Screenshot.');
      let entry;
      if (choice.mode === 'mission') {
        const mission = state.missions.find(item => item.id === choice.missionId);
        if (flow !== 'income' || !R.canMatch(state,mission) || R.missionStamp(mission) !== choice.missionStamp
            || isMissionIncomplete(mission) || isMissionPaid(mission) || isMissionPayoutSplitRequired(mission)
            || !isOrganizationMissionReadyForCompletion(mission)) return null;
        unloadMissionLoadsForCompletion(mission, current.at);
        for (const item of mission.serviceDetails?.packages || []) { item.pickedUpAt ||= current.at; item.deliveredAt ||= current.at; }
        markMissionPaid(mission,{paidAt:current.at,amountAuec:amount});
        entry = getMissionIncomeEntry(mission);
        if (!entry || entry.amountAuec !== amount) return null;
        entry.notes = note;
        state.selectedRunRoutePointKey = '';
      } else if (choice.mode === 'booking') {
        const category = R.categories(flow).find(item => item.category === choice.category);
        const fleet = choice.fleetId ? state.fleet.find(item => item.id === choice.fleetId && item.status === 'active') : null;
        if (!category || (choice.fleetId && !fleet)) return null;
        entry = createLedgerEntry({...category,flow,amountAuec:amount,
          bookedOn:formatDateForInput(new Date(current.at)),createdAt:now,
          reference:String(choice.reference || category.category).trim().slice(0,200),notes:note,
          fleetEntryId:fleet?.id || '',shipId:fleet?.shipId || ''});
        state.ledgerEntries.unshift(entry);
      } else return null;
      entry.balanceObservationId = current.key;
      state.balanceReconciliation = {...state.balanceReconciliation,ledgerStamp:R.ledgerStamp(state.ledgerEntries),
        status:R.total(state.ledgerEntries) === current.amount ? 'resolved' : 'pending',reviewedAt:now};
    }
    return {state:soloCleanState(state),telemetryIds:[]};
  } finally {state = previous; lastUnloadPlan = oldPlan;}
}
