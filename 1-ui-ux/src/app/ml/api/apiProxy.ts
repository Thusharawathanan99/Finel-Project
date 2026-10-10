/**
 * API Proxy — Lightweight wrapper for all cloud API calls.
 * Centralizes error handling, rate limiting, and caching.
 */

interface CacheEntry {
  data: unknown;
  expiry: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Simple rate limiting
const rateLimiter = {
  lastCall: 0,
  minIntervalMs: 1000, // 1 request per second minimum
};

/**
 * Make a rate-limited, cached API call.
 */
export async function apiCall<T>(
  url: string,
  options: RequestInit,
  cacheKey?: string
): Promise<T> {
  // Check cache
  if (cacheKey) {
    const cached = cache.get(cacheKey);
    if (cached && Date.now() < cached.expiry) {
      return cached.data as T;
    }
  }

  // Rate limiting
  const now = Date.now();
  const timeSinceLastCall = now - rateLimiter.lastCall;
  if (timeSinceLastCall < rateLimiter.minIntervalMs) {
    await new Promise(r => setTimeout(r, rateLimiter.minIntervalMs - timeSinceLastCall));
  }
  rateLimiter.lastCall = Date.now();

  // Make the request
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`API error ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    // Cache the result
    if (cacheKey) {
      cache.set(cacheKey, { data, expiry: Date.now() + CACHE_TTL_MS });
    }

    return data as T;
  } catch (error) {
    console.error(`[API Proxy] Request failed:`, error);
    throw error;
  }
}

/**
 * Clear all cached API responses.
 */
export function clearApiCache(): void {
  cache.clear();
}

/**
 * Get the current API configuration status.
 */
export function getApiStatus(): {
  geminiConfigured: boolean;
  cloudNlpConfigured: boolean;
  mealPlanEnabled: boolean;
} {
  return {
    geminiConfigured: import.meta.env.VITE_ENABLE_AI !== 'false',
    cloudNlpConfigured: import.meta.env.VITE_ENABLE_CLOUD_NLP === 'true',
    mealPlanEnabled: import.meta.env.VITE_ENABLE_MEAL_SUGGESTIONS === 'true',
  };
}
