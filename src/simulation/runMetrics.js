/**
 * simulation/runMetrics.js
 * Lightweight run-metrics module for the Baseline vs Optimized comparison pipeline.
 *
 * Design principles:
 *   - All metrics are REAL values derived from the simulation; none are hardcoded.
 *   - Metrics that cannot yet be measured reliably are kept at 0 and documented
 *     as "reserved for a later milestone".
 *   - No external dependencies; no classes; pure plain-object / function style.
 *   - This module is independent of Supabase, Phaser, and the Scenario schema.
 *
 * Metric status legend (used in comments below):
 *   [LIVE]    - Populated by real simulation data in this milestone.
 *   [FUTURE]  - Reserved; intentionally left at 0 until a later milestone.
 */

// -----------------------------------------------------------------------------
// 1. FRESH METRICS FACTORY
// -----------------------------------------------------------------------------

/**
 * Create a fresh, zeroed-out metrics object for a new run session.
 *
 * Field notes
 * -----------
 * totalRobots              [LIVE]   Set from robot count when run starts.
 * completedRobots          [LIVE]   Counted from robots whose status === "completed".
 * collisions               [FUTURE] Remains 0 — the simulation uses predictive
 *                                   conflict detection, not physical collision events.
 *                                   Will be populated once a reliable collision
 *                                   event source exists.
 * conflicts                [LIVE]   Counted via edge-triggered conflict detection
 *                                   (new conflict events, not per-frame samples).
 * totalWaitingTimeSec      [FUTURE] Remains 0 — no artificial waiting behaviour
 *                                   implemented yet. Reserved for ML/coordination milestone.
 * totalDistancePx          [LIVE]   Accumulated from actual per-segment tween distances
 *                                   inside robotMovement.js.
 * totalRunTimeSec          [LIVE]   Derived from session.startedAt to session.completedAt.
 * averageCompletionTimeSec [LIVE]   Average of per-robot (completedAt - startedAt) intervals.
 *                                   Requires robot.completedAt runtime field to be set.
 * completionRate           [LIVE]   completedRobots / totalRobots x 100.
 *
 * @returns {{
 *   totalRobots: number,
 *   completedRobots: number,
 *   collisions: number,
 *   conflicts: number,
 *   totalWaitingTimeSec: number,
 *   totalDistancePx: number,
 *   totalRunTimeSec: number,
 *   averageCompletionTimeSec: number,
 *   completionRate: number
 * }}
 */
export function createRunMetrics() {
  return {
    totalRobots:              0,
    completedRobots:          0,
    collisions:               0,  // [FUTURE] - no physical collision detector yet
    conflicts:                0,  // [LIVE]   - edge-triggered from detectFleetConflicts
    totalWaitingTimeSec:      0,  // [FUTURE] - no waiting behaviour implemented yet
    totalDistancePx:          0,  // [LIVE]   - accumulated per robot segment
    totalRunTimeSec:          0,  // [LIVE]   - calculated from session timestamps
    averageCompletionTimeSec: 0,  // [LIVE]   - average of robot completedAt intervals
    completionRate:           0   // [LIVE]   - completedRobots / totalRobots * 100
  };
}

// -----------------------------------------------------------------------------
// 2. FINALISE METRICS ON RUN COMPLETION
// -----------------------------------------------------------------------------

/**
 * Compute derived / summary fields once a run has completed.
 *
 * Call this just before sealing the completed run record.
 * Mutates the metrics object in-place and returns it.
 *
 * @param {object} metrics       - The live metrics object from the run session.
 * @param {object} session       - The completed run session (startedAt, completedAt set).
 * @param {Object.<string, object>} robots - Live robot state map (for completedAt timestamps).
 * @returns {object} The same metrics object, with derived fields updated.
 */
export function finaliseMetrics(metrics, session, robots) {
  if (!metrics || !session) return metrics;

  // -- totalRunTimeSec ---------------------------------------------------------
  if (session.startedAt && session.completedAt) {
    const startMs = new Date(session.startedAt).getTime();
    const endMs   = new Date(session.completedAt).getTime();
    const deltaMs = endMs - startMs;
    metrics.totalRunTimeSec = deltaMs > 0 ? parseFloat((deltaMs / 1000).toFixed(3)) : 0;
  }

  // -- completedRobots + completionRate ----------------------------------------
  const robotList = Object.values(robots || {});
  metrics.completedRobots = robotList.filter((r) => r.status === 'completed').length;
  metrics.completionRate  =
    metrics.totalRobots > 0
      ? parseFloat(((metrics.completedRobots / metrics.totalRobots) * 100).toFixed(2))
      : 0;

  // -- averageCompletionTimeSec ------------------------------------------------
  // Uses the runtime-only robot.completedAt field (ISO string) set by the
  // movement controller when a robot finishes its journey.
  // This field is NOT saved to Supabase / Scenario.
  if (session.startedAt) {
    const sessionStartMs = new Date(session.startedAt).getTime();
    const completionDeltas = robotList
      .filter((r) => r.completedAt && r.status === 'completed')
      .map((r) => {
        const robotEndMs = new Date(r.completedAt).getTime();
        return (robotEndMs - sessionStartMs) / 1000;
      })
      .filter((d) => d > 0);

    if (completionDeltas.length > 0) {
      const sum = completionDeltas.reduce((acc, d) => acc + d, 0);
      metrics.averageCompletionTimeSec = parseFloat((sum / completionDeltas.length).toFixed(3));
    }
  }

  return metrics;
}

// -----------------------------------------------------------------------------
// 3. COMPARISON HELPER
// -----------------------------------------------------------------------------

/**
 * Safe percentage improvement helper.
 * Returns null if the baseline value is 0 (no meaningful denominator).
 * Returns 0 if both values are identical.
 * Positive result means the optimized run is "better".
 *
 * @param {number} baselineVal
 * @param {number} optimizedVal
 * @param {'lower_is_better'|'higher_is_better'} [direction]
 * @returns {number|null}
 */
function safeImprovementPct(baselineVal, optimizedVal, direction) {
  if (direction === undefined) direction = 'lower_is_better';
  if (baselineVal === 0) return null; // cannot divide by zero
  if (baselineVal === optimizedVal) return 0;

  const rawDelta = baselineVal - optimizedVal;
  const pct      = (rawDelta / baselineVal) * 100;

  // For "higher_is_better" metrics flip the sign so positive = improvement
  const signed = direction === 'higher_is_better' ? -pct : pct;
  return parseFloat(signed.toFixed(2));
}

/**
 * Compare a BASELINE run result against an OPTIMIZED run result for the
 * same scenario.
 *
 * Positive improvement percentages indicate the optimized run is "better":
 *   completionTimeImprovementPct > 0  means optimized completed faster
 *   distanceImprovementPct       > 0  means optimized travelled less
 *   waitingTimeImprovementPct    > 0  means optimized waited less
 *   conflictReductionPct         > 0  means optimized had fewer conflicts
 *   collisionReductionPct        > 0  means optimized had fewer collisions
 *
 * Returns null for any field whose denominator is 0 (insufficient data).
 * Returns 0 when baseline and optimized values are identical.
 *
 * NOTE: In this milestone the OPTIMIZED mode still behaves like BASELINE,
 * so all improvement percentages will correctly read as 0% or null.
 *
 * @param {{ metrics: object, scenarioId: string, sessionId: string, mode: string }} baseline
 * @param {{ metrics: object, scenarioId: string, sessionId: string, mode: string }} optimized
 * @returns {{
 *   baseline: object,
 *   optimized: object,
 *   completionTimeImprovementPct: number|null,
 *   distanceImprovementPct:       number|null,
 *   waitingTimeImprovementPct:    number|null,
 *   conflictReductionPct:         number|null,
 *   collisionReductionPct:        number|null
 * }}
 */
export function compareRunMetrics(baseline, optimized) {
  const bm = (baseline  && baseline.metrics)  ? baseline.metrics  : {};
  const om = (optimized && optimized.metrics) ? optimized.metrics : {};

  return {
    baseline,
    optimized,

    // Lower totalRunTimeSec is better
    completionTimeImprovementPct: safeImprovementPct(
      bm.totalRunTimeSec     != null ? bm.totalRunTimeSec     : 0,
      om.totalRunTimeSec     != null ? om.totalRunTimeSec     : 0,
      'lower_is_better'
    ),

    // Lower totalDistancePx is better (shorter total travel)
    distanceImprovementPct: safeImprovementPct(
      bm.totalDistancePx     != null ? bm.totalDistancePx     : 0,
      om.totalDistancePx     != null ? om.totalDistancePx     : 0,
      'lower_is_better'
    ),

    // Lower totalWaitingTimeSec is better ([FUTURE] both will be 0)
    waitingTimeImprovementPct: safeImprovementPct(
      bm.totalWaitingTimeSec != null ? bm.totalWaitingTimeSec : 0,
      om.totalWaitingTimeSec != null ? om.totalWaitingTimeSec : 0,
      'lower_is_better'
    ),

    // Fewer conflicts is better
    conflictReductionPct: safeImprovementPct(
      bm.conflicts           != null ? bm.conflicts           : 0,
      om.conflicts           != null ? om.conflicts           : 0,
      'lower_is_better'
    ),

    // Fewer collisions is better ([FUTURE] both will be 0)
    collisionReductionPct: safeImprovementPct(
      bm.collisions          != null ? bm.collisions          : 0,
      om.collisions          != null ? om.collisions          : 0,
      'lower_is_better'
    )
  };
}
