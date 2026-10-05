/**
 * lib/supabaseClient.js
 * Supabase client initialization using Vite environment variables.
 *
 * Uses only VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.
 * Secret / service_role keys are never used or exposed.
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl =
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SUPABASE_URL) ||
  (typeof process !== 'undefined' && process.env && process.env.VITE_SUPABASE_URL);

const supabasePublishableKey =
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) ||
  (typeof process !== 'undefined' && process.env && process.env.VITE_SUPABASE_PUBLISHABLE_KEY);

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error(
    'Missing Supabase configuration: VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be defined in .env'
  );
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey);
