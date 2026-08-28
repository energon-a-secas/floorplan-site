import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  /**
   * Ephemeral Visit-mode presence. One row per open session on a map;
   * rows go stale ~15s after the last heartbeat and are swept lazily.
   * No accounts, no history: `name` is a generated guest tag and `spec`
   * is a neoav1 avatar code (or null for a seeded look).
   */
  presence: defineTable({
    mapKey: v.string(),
    sessionId: v.string(),
    name: v.string(),
    spec: v.union(v.string(), v.null()),
    x: v.number(),
    y: v.number(),
    updatedAt: v.number(),
  })
    .index("by_map", ["mapKey"])
    .index("by_map_session", ["mapKey", "sessionId"]),
});
