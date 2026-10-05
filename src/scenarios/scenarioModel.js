/**
 * scenarios/scenarioModel.js
 * Defines data structures and snapshot factories for scenario persistence.
 *
 * A Scenario represents the INITIAL CONFIGURATION only.
 * Runtime-only values (active tweens, movement timers, temporary animation/prediction
 * state, UI selection) are strictly excluded.
 */

/**
 * Capture a clean snapshot of a single robot's configured initial state.
 *
 * @param {object} robot - Live robot state object
 * @returns {object} Canonical robot snapshot
 */
export function createRobotSnapshot(robot) {
  if (!robot) return null;

  // The robot's current configured position is saved as its canonical start position
  const start = {
    x: robot.start ? robot.start.x : robot.x,
    y: robot.start ? robot.start.y : robot.y,
    tileX: robot.start ? robot.start.tileX : 0,
    tileY: robot.start ? robot.start.tileY : 0,
    navX: robot.start && robot.start.navX !== undefined ? robot.start.navX : (robot.start ? robot.start.tileX : 0),
    navY: robot.start && robot.start.navY !== undefined ? robot.start.navY : (robot.start ? robot.start.tileY : 0)
  };

  let destination = null;
  if (robot.destination) {
    destination = {
      x: robot.destination.x,
      y: robot.destination.y,
      tileX: robot.destination.tileX,
      tileY: robot.destination.tileY,
      navX: robot.destination.navX !== undefined ? robot.destination.navX : robot.destination.tileX,
      navY: robot.destination.navY !== undefined ? robot.destination.navY : robot.destination.tileY
    };
  }

  return {
    robotId: robot.id,
    start: start,
    destination: destination,
    speed: typeof robot.speed === 'number' ? robot.speed : 100,
    priority: typeof robot.priority === 'number' ? robot.priority : 1,
    battery: typeof robot.battery === 'number' ? robot.battery : 100,
    task: robot.task || 'General Transport',
    color: robot.color,
    colorHex: robot.colorHex,
    frame: robot.frame !== undefined ? robot.frame : 0
  };
}

/**
 * Generate a unique ID for a scenario.
 *
 * @returns {string}
 */
export function generateScenarioId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Create a new Scenario data object representing the configured initial state of the fleet.
 *
 * @param {{
 *   id?: string,
 *   name: string,
 *   robots?: object[],
 *   createdAt?: string,
 *   updatedAt?: string
 * }} params
 * @returns {object} Scenario object
 */
export function createScenario({ id, name, robots = [], createdAt, updatedAt }) {
  const trimmedName = (name || '').trim();
  if (!trimmedName) {
    throw new Error('Scenario name is required and cannot be empty');
  }

  const now = new Date().toISOString();

  // Snapshot robots, ensuring initial configuration purity
  const robotSnapshots = robots.map((r) => {
    // If it's already a snapshot (has robotId and start), return a clean copy
    if (r.robotId && r.start) {
      return {
        robotId: r.robotId,
        start: { ...r.start },
        destination: r.destination ? { ...r.destination } : null,
        speed: r.speed,
        priority: r.priority,
        battery: r.battery,
        task: r.task,
        color: r.color,
        colorHex: r.colorHex,
        frame: r.frame !== undefined ? r.frame : 0
      };
    }
    return createRobotSnapshot(r);
  }).filter(Boolean);

  return {
    id: id || generateScenarioId(),
    name: trimmedName,
    createdAt: createdAt || now,
    updatedAt: updatedAt || now,
    robots: robotSnapshots
  };
}
