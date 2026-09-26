import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/** A row older than this is invisible to `others`. */
const FRESH_MS = 15_000;
/** A row older than this is deleted by the lazy sweep in `heartbeat`. */
const SWEEP_MS = FRESH_MS * 4;

// The mutations are public and anonymous, and `others` hands a row to every
// visitor on the same map, so a heartbeat is checked against what the client
// actually sends (js/presence-core.js) before it is stored: mapKeyFor() is
// "m" plus base36, the session is a crypto.randomUUID(), guestName() is
// "guest-" plus four characters, specToCode() is "neoav1:" plus base64url,
// and positions are grid cells. The client escapes the name too; this keeps
// markup out of the table if that ever regresses.
const MAP_KEY = /^m[0-9a-z]{1,13}$/;
const SESSION_ID = /^[A-Za-z0-9-]{8,64}$/;
const GUEST_NAME = /^guest-[a-z0-9]{0,8}$/;
const SPEC_CODE = /^neoav1:[A-Za-z0-9_-]{0,1024}$/;
const MAX_CELL = 100_000;

function checkHeartbeat(args: {
  mapKey: string;
  sessionId: string;
  name: string;
  spec: string | null;
  x: number;
  y: number;
}) {
  if (!MAP_KEY.test(args.mapKey)) throw new Error("presence: bad mapKey");
  if (!SESSION_ID.test(args.sessionId)) throw new Error("presence: bad sessionId");
  if (!GUEST_NAME.test(args.name)) throw new Error("presence: bad name");
  if (args.spec !== null && !SPEC_CODE.test(args.spec)) throw new Error("presence: bad spec");
  for (const n of [args.x, args.y]) {
    if (!Number.isFinite(n) || n < 0 || n > MAX_CELL) throw new Error("presence: bad position");
  }
}

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
    checkHeartbeat(args);
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
