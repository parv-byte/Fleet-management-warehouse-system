/**
 * scenarios/baseScenarioRepository.js
 * Base abstract interface for Scenario Repository.
 */

export class ScenarioRepository {
  /**
   * Retrieve all saved scenarios.
   * @returns {Promise<object[]>}
   */
  async getAll() {
    throw new Error('ScenarioRepository.getAll() must be implemented');
  }

  /**
   * Retrieve a scenario by ID.
   * @param {string} id
   * @returns {Promise<object|null>}
   */
  async getById(id) {
    throw new Error('ScenarioRepository.getById() must be implemented');
  }

  /**
   * Save a scenario (insert or update).
   * @param {object} scenario
   * @returns {Promise<object>}
   */
  async save(scenario) {
    throw new Error('ScenarioRepository.save() must be implemented');
  }

  /**
   * Delete a scenario by ID.
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  async delete(id) {
    throw new Error('ScenarioRepository.delete() must be implemented');
  }
}
