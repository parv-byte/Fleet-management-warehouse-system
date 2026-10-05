/**
 * scenarios/supabaseScenarioRepository.js
 * Supabase-backed persistence implementation for AMR simulation scenarios.
 *
 * Implements the ScenarioRepository async contract:
 *   - save(scenario)
 *   - getAll()
 *   - getById(id)
 *   - delete(id)
 *
 * Uses:
 *   - public.scenarios
 *   - public.scenario_robots (foreign key ON DELETE CASCADE)
 */

import { supabase } from '../lib/supabaseClient.js';
import { ScenarioRepository } from './baseScenarioRepository.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Ensure a scenario ID is a valid RFC 4122 v4 UUID compatible with PostgreSQL uuid type.
 * @param {string} [id]
 * @returns {string}
 */
export function ensureValidScenarioUuid(id) {
  if (id && UUID_REGEX.test(id)) {
    return id;
  }
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
 * Map a frontend RobotSnapshot to a Supabase scenario_robots row.
 * @param {string} scenarioId
 * @param {object} robot
 * @returns {object}
 */
export function mapRobotSnapshotToRow(scenarioId, robot) {
  const start = robot.start || {};
  const dest = robot.destination;

  return {
    scenario_id: scenarioId,
    robot_id: robot.robotId,
    x: start.x ?? 0,
    y: start.y ?? 0,
    start_x: start.x ?? 0,
    start_y: start.y ?? 0,
    start_tile_x: start.tileX ?? 0,
    start_tile_y: start.tileY ?? 0,
    start_nav_x: start.navX !== undefined ? start.navX : (start.tileX ?? 0),
    start_nav_y: start.navY !== undefined ? start.navY : (start.tileY ?? 0),
    destination_x: dest ? dest.x : null,
    destination_y: dest ? dest.y : null,
    destination_tile_x: dest ? dest.tileX : null,
    destination_tile_y: dest ? dest.tileY : null,
    destination_nav_x: dest ? (dest.navX !== undefined ? dest.navX : dest.tileX) : null,
    destination_nav_y: dest ? (dest.navY !== undefined ? dest.navY : dest.tileY) : null,
    speed: typeof robot.speed === 'number' ? robot.speed : 100,
    priority: typeof robot.priority === 'number' ? robot.priority : 1,
    battery: typeof robot.battery === 'number' ? robot.battery : 100,
    task: robot.task || 'General Transport',
    color: robot.color,
    color_hex: robot.colorHex,
    frame: robot.frame !== undefined ? robot.frame : 0
  };
}

/**
 * Map a Supabase scenario_robots row to a frontend RobotSnapshot.
 * @param {object} row
 * @returns {object}
 */
export function mapRowToRobotSnapshot(row) {
  const hasDestination =
    row.destination_x !== null &&
    row.destination_x !== undefined &&
    row.destination_tile_x !== null &&
    row.destination_tile_x !== undefined;

  let destination = null;
  if (hasDestination) {
    destination = {
      x: row.destination_x,
      y: row.destination_y,
      tileX: row.destination_tile_x,
      tileY: row.destination_tile_y,
      navX:
        row.destination_nav_x !== null && row.destination_nav_x !== undefined
          ? row.destination_nav_x
          : row.destination_tile_x,
      navY:
        row.destination_nav_y !== null && row.destination_nav_y !== undefined
          ? row.destination_nav_y
          : row.destination_tile_y
    };
  }

  return {
    robotId: row.robot_id,
    start: {
      x: row.start_x !== null && row.start_x !== undefined ? row.start_x : row.x,
      y: row.start_y !== null && row.start_y !== undefined ? row.start_y : row.y,
      tileX: row.start_tile_x ?? 0,
      tileY: row.start_tile_y ?? 0,
      navX:
        row.start_nav_x !== null && row.start_nav_x !== undefined
          ? row.start_nav_x
          : (row.start_tile_x ?? 0),
      navY:
        row.start_nav_y !== null && row.start_nav_y !== undefined
          ? row.start_nav_y
          : (row.start_tile_y ?? 0)
    },
    destination,
    speed: typeof row.speed === 'number' ? row.speed : 100,
    priority: typeof row.priority === 'number' ? row.priority : 1,
    battery: typeof row.battery === 'number' ? row.battery : 100,
    task: row.task || 'General Transport',
    color: row.color,
    colorHex: row.color_hex,
    frame: row.frame !== undefined ? row.frame : 0
  };
}

/**
 * Reconstruct a full Scenario object from scenario and scenario_robots rows.
 * @param {object} scenarioRow
 * @param {object[]} [robotRows=[]]
 * @returns {object}
 */
export function mapRowsToScenario(scenarioRow, robotRows = []) {
  return {
    id: scenarioRow.id,
    name: scenarioRow.name,
    createdAt: scenarioRow.created_at,
    updatedAt: scenarioRow.updated_at,
    robots: (robotRows || []).map(mapRowToRobotSnapshot)
  };
}

/**
 * Supabase implementation of ScenarioRepository.
 */
export class SupabaseScenarioRepository extends ScenarioRepository {
  /**
   * Retrieve all saved scenarios from Supabase.
   * @returns {Promise<object[]>}
   */
  async getAll() {
    // Attempt nested relation query
    const { data: nestedData, error: nestedError } = await supabase
      .from('scenarios')
      .select('*, scenario_robots(*)')
      .order('created_at', { ascending: false });

    if (nestedError) {
      // If the nested relation query is not recognized by the generated API schema,
      // fetch scenarios and scenario_robots separately and reconstruct in JavaScript.
      const { data: scenariosOnly, error: scenariosError } = await supabase
        .from('scenarios')
        .select('*')
        .order('created_at', { ascending: false });

      if (scenariosError) {
        throw new Error(`load scenarios failed: ${scenariosError.message}`);
      }

      const { data: robotsOnly, error: robotsError } = await supabase
        .from('scenario_robots')
        .select('*');

      if (robotsError) {
        throw new Error(`load scenarios failed (fetching robots): ${robotsError.message}`);
      }

      const robotsByScenario = new Map();
      (robotsOnly || []).forEach((row) => {
        if (!robotsByScenario.has(row.scenario_id)) {
          robotsByScenario.set(row.scenario_id, []);
        }
        robotsByScenario.get(row.scenario_id).push(row);
      });

      return (scenariosOnly || []).map((sRow) =>
        mapRowsToScenario(sRow, robotsByScenario.get(sRow.id) || [])
      );
    }

    return (nestedData || []).map((sRow) =>
      mapRowsToScenario(sRow, sRow.scenario_robots || [])
    );
  }

  /**
   * Retrieve a single scenario by ID from Supabase.
   * @param {string} id
   * @returns {Promise<object|null>}
   */
  async getById(id) {
    if (!id) return null;

    // Attempt nested relation query
    const { data: nestedData, error: nestedError } = await supabase
      .from('scenarios')
      .select('*, scenario_robots(*)')
      .eq('id', id)
      .maybeSingle();

    if (nestedError) {
      // Fallback to separate queries
      const { data: scenarioRow, error: sErr } = await supabase
        .from('scenarios')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (sErr) {
        throw new Error(`load scenario failed: ${sErr.message}`);
      }
      if (!scenarioRow) return null;

      const { data: robotRows, error: rErr } = await supabase
        .from('scenario_robots')
        .select('*')
        .eq('scenario_id', id);

      if (rErr) {
        throw new Error(`load scenario failed (fetching robots): ${rErr.message}`);
      }

      return mapRowsToScenario(scenarioRow, robotRows || []);
    }

    if (!nestedData) return null;
    return mapRowsToScenario(nestedData, nestedData.scenario_robots || []);
  }

  /**
   * Save a scenario (insert or update) in Supabase.
   * Preserves existing ID on update or assigns a valid UUID on creation.
   * Preserves created_at on update and refreshes updated_at.
   *
   * @param {object} scenario
   * @returns {Promise<object>} Persisted scenario with final UUID
   */
  async save(scenario) {
    if (!scenario || typeof scenario !== 'object') {
      throw new Error('save scenario failed: invalid scenario payload');
    }

    const trimmedName = (scenario.name || '').trim();
    if (!trimmedName) {
      throw new Error('save scenario failed: scenario name is required');
    }

    const scenarioId = ensureValidScenarioUuid(scenario.id);
    const now = new Date().toISOString();

    // Check if scenario already exists to preserve created_at
    let createdAt = scenario.createdAt || now;
    let updatedAt = now;

    const { data: existing, error: checkError } = await supabase
      .from('scenarios')
      .select('id, created_at')
      .eq('id', scenarioId)
      .maybeSingle();

    if (checkError) {
      throw new Error(`save scenario failed (checking existing): ${checkError.message}`);
    }

    if (existing && existing.created_at) {
      createdAt = existing.created_at;
    }

    // 1. Upsert the scenario record
    const { data: savedRow, error: scenarioError } = await supabase
      .from('scenarios')
      .upsert({
        id: scenarioId,
        name: trimmedName,
        created_at: createdAt,
        updated_at: updatedAt
      })
      .select('created_at, updated_at')
      .maybeSingle();

    if (scenarioError) {
      throw new Error(`save scenario failed: ${scenarioError.message}`);
    }

    const finalCreatedAt = (savedRow && savedRow.created_at) || createdAt;
    const finalUpdatedAt = (savedRow && savedRow.updated_at) || updatedAt;

    // 2. Clean up any existing robot snapshots for this scenario ID to avoid duplicates
    const { error: deleteRobotsError } = await supabase
      .from('scenario_robots')
      .delete()
      .eq('scenario_id', scenarioId);

    if (deleteRobotsError) {
      throw new Error(`save scenario failed (cleaning existing robots): ${deleteRobotsError.message}`);
    }

    // 3. Insert robot snapshot rows if any robots exist
    const robotList = Array.isArray(scenario.robots) ? scenario.robots : [];
    if (robotList.length > 0) {
      const robotRows = robotList.map((r) => mapRobotSnapshotToRow(scenarioId, r));
      const { error: robotsError } = await supabase
        .from('scenario_robots')
        .insert(robotRows);

      if (robotsError) {
        throw new Error(`save scenario failed (saving robots): ${robotsError.message}`);
      }
    }

    // Return the updated canonical Scenario object containing the persisted Supabase UUID
    return {
      id: scenarioId,
      name: trimmedName,
      createdAt: finalCreatedAt,
      updatedAt: finalUpdatedAt,
      robots: robotList.map((r) => ({ ...r }))
    };
  }

  /**
   * Delete a scenario by ID from Supabase.
   * ON DELETE CASCADE removes associated scenario_robots rows automatically.
   *
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  async delete(id) {
    if (!id) return false;

    const { error } = await supabase
      .from('scenarios')
      .delete()
      .eq('id', id);

    if (error) {
      throw new Error(`delete scenario failed: ${error.message}`);
    }

    return true;
  }
}

export const supabaseScenarioRepository = new SupabaseScenarioRepository();
