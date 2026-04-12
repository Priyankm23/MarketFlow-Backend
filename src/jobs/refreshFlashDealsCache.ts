import FlashDealsService from "../modules/flashDeals/flashDeals.service.js";

/**
 * Starts a background loop that refreshes the flash-deals cache.
 * Behavior:
 * - Calls `FlashDealsService.refreshCache()` to warm Redis.
 * - Schedules next run at the nearest deal end (TTL) or a fallback interval.
 */
export async function startFlashDealsCacheRefresher() {
  console.log("[FlashDealsRefresher] Starting refresher...");

  const runOnce = async () => {
    try {
      const { nearestEnd, ttlSec } = await (
        FlashDealsService as any
      ).refreshCache();

      // Decide next run time: run slightly before nearest end to ensure update
      const now = Date.now();
      let nextMs = 60 * 1000; // default 30s

      if (nearestEnd) {
        // Schedule ~2 seconds before expiry, but at least 5s from now
        const delta = nearestEnd - now - 2000;
        nextMs = Math.max(5000, Math.min(delta, 60 * 60 * 1000));
      } else if (ttlSec) {
        nextMs = Math.max(5000, Math.min(ttlSec * 1000 - 2000, 60 * 60 * 1000));
      }

      console.log(
        `[FlashDealsRefresher] Warmed cache. Next run in ${Math.round(nextMs / 1000)}s`,
      );

      setTimeout(runOnce, nextMs);
    } catch (err) {
      console.error("[FlashDealsRefresher] Error during refresh:", err);
      // Retry after short delay
      setTimeout(runOnce, 15 * 1000);
    }
  };

  // Kick off
  await runOnce();
}

export default startFlashDealsCacheRefresher;
