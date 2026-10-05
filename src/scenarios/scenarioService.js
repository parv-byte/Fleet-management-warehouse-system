/**
 * scenarios/scenarioService.js
 * Business logic orchestrator for managing, saving, loading, and deleting scenarios.
 */

import { createScenario } from './scenarioModel.js';
import { scenarioRepository } from './scenarioRepository.js';

export class ScenarioService {
  /**
   * @param {import('./scenarioRepository.js').ScenarioRepository} [repository]
   */
  constructor(repository = scenarioRepository) {
    this.repository = repository;
  }

  /**
   * Retrieve all saved scenarios, sorted with newest first.
   *
   * @returns {Promise<object[]>}
   */
  async getScenarios() {
    const list = await this.repository.getAll();
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /**
   * Retrieve a single scenario by its ID.
   *
   * @param {string} id
   * @returns {Promise<object|null>}
   */
  async getScenario(id) {
    if (!id) return null;
    return await this.repository.getById(id);
  }

  /**
   * Save the current configured robot fleet as a new Scenario.
   *
   * @param {string} name - User-provided scenario name
   * @param {Object.<string, object>|object[]} robots - Fleet robots container or array
   * @returns {Promise<object>} Created and saved scenario
   */
  async saveCurrentScenario(name, robots) {
    const trimmed = (name || '').trim();
    if (!trimmed) {
      throw new Error('Scenario name is required');
    }

    const robotsList = Array.isArray(robots) ? robots : Object.values(robots || {});
    const scenario = createScenario({
      name: trimmed,
      robots: robotsList
    });

    return await this.repository.save(scenario);
  }

  /**
   * Update an existing scenario with the current configured robot fleet.
   * Preserves the existing scenario ID and creation timestamp.
   *
   * @param {string} id - Existing scenario ID (UUID)
   * @param {string} name - User-provided scenario name
   * @param {Object.<string, object>|object[]} robots - Fleet robots container or array
   * @returns {Promise<object>} Updated scenario
   */
  async updateScenario(id, name, robots) {
    if (!id) {
      throw new Error('Scenario ID is required to update an existing scenario');
    }

    const trimmed = (name || '').trim();
    if (!trimmed) {
      throw new Error('Scenario name is required');
    }

    const robotsList = Array.isArray(robots) ? robots : Object.values(robots || {});
    const scenario = createScenario({
      id,
      name: trimmed,
      robots: robotsList
    });

    return await this.repository.save(scenario);
  }

  /**
   * Delete a scenario by ID.
   *
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  async deleteScenario(id) {
    if (!id) return false;
    return await this.repository.delete(id);
  }
}

// Default singleton instance using the standard scenarioRepository
export const scenarioService = new ScenarioService(scenarioRepository);
