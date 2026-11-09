#!/usr/bin/env node
/* Records the app's default picks into site/picks_log.json (one snapshot per price date).
 *
 *   node tools/snapshot_picks.mjs [siteDir=site]
 *
 * The daily job runs this after refreshing the data and commits the log, so git history shows when each list was
 * recorded, before anyone could know how it turned out. Nothing is backfilled: the Scoreboard only judges lists
 * that were recorded in advance. If the log is missing a new one is started; if it is damaged the run stops rather than overwrite it. Running twice for the same price date does nothing.
 */
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const site = process.argv[2] || "site";
const { buildLists } = require(join(process.cwd(), site, "picks.js"));

const read = async (f, fallback) => { try { return JSON.parse(await readFile(join(site, f), "utf8")); } catch { return fallback; } };

// The log is the valuable part: a missing file starts a new one, but a damaged file must stop the run (never overwrite history).
async function readLog() {
  let text;
  try { text = await readFile(join(site, "picks_log.json"), "utf8"); } catch (e) { if (e.code === "ENOENT") return null; throw e; }
  let log;
  try { log = JSON.parse(text); } catch { throw new Error("site/picks_log.json is damaged; refusing to overwrite the history. Restore it from git."); }
  if (!log || !Array.isArray(log.snapshots)) throw new Error("site/picks_log.json has an unexpected shape; refusing to overwrite the history.");
  return log;
}

export async function snapshot() {
  const data = await read("data.json", null), fund = (await read("fundamentals.json", { items: {} })).items, news = await read("news.json", null);
  if (!data) throw new Error("site/data.json is missing");
  const log = await readLog();
  const snaps = log ? log.snapshots : [];
  const out = buildLists({ data, fund, news });
  if (snaps.some((s) => s.date === out.date)) { console.log(`Already recorded ${out.date}; nothing to do.`); return false; }
  if (snaps.length && out.date < snaps[snaps.length - 1].date) { console.log(`Price date ${out.date} is older than the last snapshot; skipping.`); return false; }
  snaps.push({ date: out.date, recorded: new Date().toISOString().slice(0, 16) + "Z", dataGenerated: data.generated, universe: out.universe, lists: out.lists });
  await writeFile(join(site, "picks_log.json"), JSON.stringify({ version: 1, snapshots: snaps }));
  console.log(`Recorded ${out.date}: ${Object.entries(out.lists).map(([k, v]) => `${k}=${v.join("/")}`).join("  ")}`);
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await snapshot();
