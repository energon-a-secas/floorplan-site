import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/** A row older than this is invisible to `others`. */
const FRESH_MS = 15_000;
/** A row older than this is deleted by the lazy sweep in `heartbeat`. */
const SWEEP_MS = FRESH_MS * 4;

/** Upsert this session's presence row. Also lazily sweeps long-dead rows on the same map. */
export const heartbeat = mutation({
  args: {
    mapKey: v.string(),
    sessionId: v.string(),
    name: v.string(),
    spec: v.union(v.string(), v.null()),
    x: v.number(),
    y: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("presence")
      .withIndex("by_map_session", (q) =>
        q.eq("mapKey", args.mapKey).eq("sessionId", args.sessionId)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.name,
        spec: args.spec,
        x: args.x,
        y: args.y,
        updatedAt: now,
      });
      return;
    }

    await ctx.db.insert("presence", { ...args, updatedAt: now });

    // Lazy cleanup: only on a first insert (rare), only this map's rows.
    const rows = await ctx.db
      .query("presence")
      .withIndex("by_map", (q) => q.eq("mapKey", args.mapKey))
      .collect();
    for (const row of rows) {
      if (now - row.updatedAt > SWEEP_MS) await ctx.db.delete(row._id);
    }
  },
});

/** Remove this session's row (called on Visit exit; TTL covers a dropped tab). */
export const leave = mutation({
  args: { mapKey: v.string(), sessionId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("presence")
      .withIndex("by_map_session", (q) =>
        q.eq("mapKey", args.mapKey).eq("sessionId", args.sessionId)
      )
      .first();
    if (existing) await ctx.db.delete(existing._id);
  },
});

/** Everyone else on this map with a heartbeat fresher than FRESH_MS. */
export const others = query({
  args: { mapKey: v.string(), sessionId: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("presence")
      .withIndex("by_map", (q) => q.eq("mapKey", args.mapKey))
      .collect();
    const cutoff = Date.now() - FRESH_MS;
    return rows
      .filter((r) => r.sessionId !== args.sessionId && r.updatedAt >= cutoff)
      .map((r) => ({
        sessionId: r.sessionId,
        name: r.name,
        spec: r.spec,
        x: r.x,
        y: r.y,
        updatedAt: r.updatedAt,
      }));
  },
});
