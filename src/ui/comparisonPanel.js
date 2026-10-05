/**
 * ui/comparisonPanel.js
 * Manages the Run Comparison panel in the dashboard.
 *
 * Compares the latest completed BASELINE and latest completed OPTIMIZED runs
 * for the currently loaded scenario using `compareRunMetrics` from `simulation/runMetrics.js`.
 *
 * Data source: window.completedRuns (or an array passed in)
 */

import { compareRunMetrics } from '../simulation/runMetrics.js';

/**
 * Format helpers as required:
 * - time: seconds, 1 decimal (e.g. "12.4s")
 * - distance: pixels, whole number (e.g. "412 px")
 * - conflicts: integer
 * - collisions: integer
 * - completion rate: percentage (e.g. "100%")
 * - improvement: percentage with 1 decimal (e.g. "25.0%")
 * - unavailable: "—"
 */
function formatTime(val) {
  if (val == null || isNaN(val) || val === '') return '—';
  return `${Number(val).toFixed(1)}s`;
}

function formatDistance(val) {
  if (val == null || isNaN(val) || val === '') return '—';
  return `${Math.round(Number(val))} px`;
}

function formatInteger(val) {
  if (val == null || isNaN(val) || val === '') return '—';
  return `${Math.round(Number(val))}`;
}

function formatRate(val) {
  if (val == null || isNaN(val) || val === '') return '—';
  return `${Math.round(Number(val))}%`;
}

function formatImprovement(pct, isImprovement = true) {
  if (pct == null || isNaN(pct)) return '—';
  const num = Number(pct);
  const formatted = `${num >= 0 ? '' : ''}${num.toFixed(1)}%`;
  return formatted;
}

/**
 * Find the latest completed run for a given scenario and mode.
 *
 * @param {Array<object>} completedRuns
 * @param {string} scenarioId
 * @param {'BASELINE'|'OPTIMIZED'} mode
 * @returns {object|null}
 */
export function getLatestRunForScenario(completedRuns, scenarioId, mode) {
  if (!Array.isArray(completedRuns) || !scenarioId || !mode) return null;
  // Iterate backwards to get the most recent run
  for (let i = completedRuns.length - 1; i >= 0; i--) {
    const run = completedRuns[i];
    if (run.scenarioId === scenarioId && run.mode === mode) {
      return run;
    }
  }
  return null;
}

/**
 * Create the Comparison Panel controller.
 *
 * @param {object} options
 * @param {() => Array<object>} options.getCompletedRuns - getter for completed runs array
 * @param {() => string|null} options.getCurrentScenarioId - getter for currently loaded scenario id
 * @returns {{ update: () => void }}
 */
export function createComparisonPanel({ getCompletedRuns, getCurrentScenarioId }) {
  const container = document.getElementById('comparison-section');
  const messageEl = document.getElementById('comparison-message');
  const contentEl = document.getElementById('comparison-content');

  // Value display elements
  const timeBaselineEl = document.getElementById('cmp-time-baseline');
  const timeOptimizedEl = document.getElementById('cmp-time-optimized');

  const distBaselineEl = document.getElementById('cmp-dist-baseline');
  const distOptimizedEl = document.getElementById('cmp-dist-optimized');

  const confBaselineEl = document.getElementById('cmp-conf-baseline');
  const confOptimizedEl = document.getElementById('cmp-conf-optimized');

  const collBaselineEl = document.getElementById('cmp-coll-baseline');
  const collOptimizedEl = document.getElementById('cmp-coll-optimized');

  const rateBaselineEl = document.getElementById('cmp-rate-baseline');
  const rateOptimizedEl = document.getElementById('cmp-rate-optimized');

  // Summary improvement elements
  const impTimeEl = document.getElementById('cmp-imp-time');
  const impDistEl = document.getElementById('cmp-imp-dist');
  const impConfEl = document.getElementById('cmp-imp-conf');

  const update = () => {
    if (!container) return;

    const currentScenarioId = getCurrentScenarioId ? getCurrentScenarioId() : null;
    const completedRuns = (getCompletedRuns ? getCompletedRuns() : null) || window.completedRuns || [];

    // If no scenario loaded, show default state
    if (!currentScenarioId) {
      if (contentEl) contentEl.style.display = 'none';
      if (messageEl) {
        messageEl.style.display = 'block';
        messageEl.textContent = 'Run both modes to compare results.';
      }
      return;
    }

    const baselineRun = getLatestRunForScenario(completedRuns, currentScenarioId, 'BASELINE');
    const optimizedRun = getLatestRunForScenario(completedRuns, currentScenarioId, 'OPTIMIZED');

    // Case 1: Neither run completed yet for this scenario
    if (!baselineRun && !optimizedRun) {
      if (contentEl) contentEl.style.display = 'none';
      if (messageEl) {
        messageEl.style.display = 'block';
        messageEl.textContent = 'Run both modes to compare results.';
      }
      return;
    }

    // Case 2: BASELINE completed, but OPTIMIZED not yet
    if (baselineRun && !optimizedRun) {
      if (contentEl) contentEl.style.display = 'none';
      if (messageEl) {
        messageEl.style.display = 'block';
        messageEl.textContent = 'Baseline recorded. Run OPTIMIZED to compare.';
      }
      return;
    }

    // Case 3: OPTIMIZED completed, but BASELINE not yet
    if (!baselineRun && optimizedRun) {
      if (contentEl) contentEl.style.display = 'none';
      if (messageEl) {
        messageEl.style.display = 'block';
        messageEl.textContent = 'Optimized recorded. Run BASELINE to compare.';
      }
      return;
    }

    // Case 4: Both runs exist for this scenario!
    const bm = baselineRun.metrics || {};
    const om = optimizedRun.metrics || {};
    const comparison = compareRunMetrics(baselineRun, optimizedRun);

    // Populate table values
    if (timeBaselineEl) timeBaselineEl.textContent = formatTime(bm.totalRunTimeSec);
    if (timeOptimizedEl) timeOptimizedEl.textContent = formatTime(om.totalRunTimeSec);

    if (distBaselineEl) distBaselineEl.textContent = formatDistance(bm.totalDistancePx);
    if (distOptimizedEl) distOptimizedEl.textContent = formatDistance(om.totalDistancePx);

    if (confBaselineEl) confBaselineEl.textContent = formatInteger(bm.conflicts);
    if (confOptimizedEl) confOptimizedEl.textContent = formatInteger(om.conflicts);

    if (collBaselineEl) collBaselineEl.textContent = formatInteger(bm.collisions);
    if (collOptimizedEl) collOptimizedEl.textContent = formatInteger(om.collisions);

    if (rateBaselineEl) rateBaselineEl.textContent = formatRate(bm.completionRate);
    if (rateOptimizedEl) rateOptimizedEl.textContent = formatRate(om.completionRate);

    // Populate improvement summaries
    if (impTimeEl) {
      const val = comparison.completionTimeImprovementPct;
      impTimeEl.textContent = formatImprovement(val);
      impTimeEl.className = 'cmp-summary-val' + (val > 0 ? ' is-positive' : val < 0 ? ' is-negative' : '');
    }

    if (impDistEl) {
      const val = comparison.distanceImprovementPct;
      impDistEl.textContent = formatImprovement(val);
      impDistEl.className = 'cmp-summary-val' + (val > 0 ? ' is-positive' : val < 0 ? ' is-negative' : '');
    }

    if (impConfEl) {
      const val = comparison.conflictReductionPct;
      impConfEl.textContent = formatImprovement(val);
      impConfEl.className = 'cmp-summary-val' + (val > 0 ? ' is-positive' : val < 0 ? ' is-negative' : '');
    }

    // Reveal comparison content
    if (messageEl) messageEl.style.display = 'none';
    if (contentEl) contentEl.style.display = 'flex';
  };

  // Initial update
  update();

  return { update };
}
