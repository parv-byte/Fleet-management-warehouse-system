/**
 * scenarios/scenarioRepository.js
 * Persistence abstraction for AMR simulation scenarios.
 *
 * Provides a clean repository interface returning Promises so it can be swapped
 * for a Supabase-backed repository in the future with zero changes to caller code.
 */

import { ScenarioRepository } from './baseScenarioRepository.js';
import { supabaseScenarioRepository } from './supabaseScenarioRepository.js';

export { ScenarioRepository };

const STORAGE_KEY = 'amr_simulation_scenarios';

/**
 * LocalStorage implementation of ScenarioRepository.
 */
export class LocalStorageScenarioRepository extends ScenarioRepository {
  constructor(storageKey = STORAGE_KEY) {
    super();
    this.storageKey = storageKey;
    this.memoryFallback = new Map();
  }

  _hasLocalStorage() {
    try {
      return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
    } catch {
      return false;
    }
  }

  async getAll() {
    if (!this._hasLocalStorage()) {
      return Array.from(this.memoryFallback.values());
    }

    try {
      const raw = window.localStorage.getItem(this.storageKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.warn('[LocalStorageScenarioRepository] Failed to read from localStorage:', err);
      return Array.from(this.memoryFallback.values());
    }
  }

  async getById(id) {
    const all = await this.getAll();
    return all.find((s) => s.id === id) || null;
  }

  async save(scenario) {
    if (!scenario || !scenario.id) {
      throw new Error('Cannot save invalid scenario object without an ID');
    }

    const all = await this.getAll();
    const existingIndex = all.findIndex((s) => s.id === scenario.id);

    if (existingIndex >= 0) {
      const existing = all[existingIndex];
      const preservedCreatedAt = existing.createdAt || existing.created_at || scenario.createdAt;
      all[existingIndex] = {
        ...scenario,
        createdAt: preservedCreatedAt,
        updatedAt: new Date().toISOString()
      };
    } else {
      all.push(scenario);
    }

    if (this._hasLocalStorage()) {
      try {
        window.localStorage.setItem(this.storageKey, JSON.stringify(all));
      } catch (err) {
        console.warn('[LocalStorageScenarioRepository] Failed to write to localStorage:', err);
      }
    }

    this.memoryFallback.set(scenario.id, scenario);
    return scenario;
  }

  async delete(id) {
    if (!id) return false;

    const all = await this.getAll();
    const filtered = all.filter((s) => s.id !== id);

    if (this._hasLocalStorage()) {
      try {
        window.localStorage.setItem(this.storageKey, JSON.stringify(filtered));
      } catch (err) {
        console.warn('[LocalStorageScenarioRepository] Failed to delete from localStorage:', err);
      }
    }

    this.memoryFallback.delete(id);
    return true;
  }
}

// Default export singleton instance wired to Supabase persistence
export const scenarioRepository = supabaseScenarioRepository;
export { supabaseScenarioRepository };
