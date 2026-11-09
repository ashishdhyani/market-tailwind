import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { MAGIC, SALT, ITERATIONS, collect, decrypt, encrypt } from "../tools/protect.mjs";

const root = new URL("..", import.meta.url).pathname;
const pw = "test-" + randomBytes(9).toString("hex");          // throwaway test password, not a real one
const work = await mkdtemp(join(tmpdir(), "mt-protect-"));
let ok = 0; const pass = (m) => { ok++; };
try {
  // 1. real site round-trips exactly
  const files = await collect(join(root, "site"));
  assert.ok(Object.keys(files).length >= 10 && files["index.html"] && files["data.json"]); pass();
  const enc = await encrypt(files, pw);
  assert.deepEqual(await decrypt(enc, pw), files); pass();

  // 2. wrong password and tampering are rejected
  await assert.rejects(() => decrypt(enc, pw + "x")); pass();
  const bad = Buffer.from(enc); bad[bad.length - 40] ^= 1;
  await assert.rejects(() => decrypt(bad, pw)); pass();
  await assert.rejects(() => decrypt(Buffer.from("not a bundle at all"), pw)); pass();

  // 3. each build uses a fresh IV (same input, different ciphertext)
  assert.notDeepEqual((await encrypt(files, pw)).subarray(4, 16), enc.subarray(4, 16)); pass();

  // 4. CLI: fails closed without a (long enough) password, and builds a clean dist/ otherwise
  const run = (env) => spawnSync("node", [join(root, "tools/protect.mjs"), join(root, "site"), join(work, "dist")], { env: { ...process.env, MARKET_PASSWORD: "", ...env }, encoding: "utf8" });
  assert.equal(run({}).status, 1); pass();
  assert.equal(run({ MARKET_PASSWORD: "short" }).status, 1); pass();
  const good = run({ MARKET_PASSWORD: pw });
  assert.equal(good.status, 0, good.stderr); pass();
  const bundle = await readFile(join(work, "dist/bundle.enc"));
  assert.deepEqual(await decrypt(bundle, pw), files); pass();

  // 5. nothing readable is published: no site text in dist/ and the password is not in it
  const published = [bundle, await readFile(join(work, "dist/index.html"))];
  for (const marker of ["O39.SI", "Fwd P/E", "sectorAnalysis", "fundamentals", "Strongest sector", pw]) {
    for (const buf of published) assert.ok(!buf.includes(marker), `leaked: ${marker}`);
  }
  pass();
  assert.ok(!(await readFile(join(work, "dist/index.html"), "utf8")).includes("data.json")); pass();

  // 6. crypto constants in the login page match the build script
  const login = await readFile(join(root, "tools/login.html"), "utf8");
  assert.ok(login.includes(`new TextEncoder().encode("${SALT}")`)); pass();
  assert.ok(login.includes(`ITER = ${ITERATIONS}`)); pass();
  assert.ok(login.includes(`MAGIC = [${[...MAGIC].map((b) => "0x" + b.toString(16).padStart(2, "0")).join(", ")}]`)); pass();

  // 6b. the login page has exactly one script element, and no stray closing tag inside it (an early </script> breaks the page)
  const closers = login.match(/<\/script\s*>/gi) || [];
  assert.equal(closers.length, 1); pass();   // the one real closing tag (inner ones are escaped)

  // 7. refuses files that cannot be inlined safely or are not text
  const evil = join(work, "evil"); await mkdir(evil);
  await writeFile(join(evil, "index.html"), "<html></html>"); await writeFile(join(evil, "x.js"), 'var s = "</script><script>alert(1)</script>";');
  await assert.rejects(() => collect(evil), /cannot be inlined/); pass();
  await rm(join(evil, "x.js")); await writeFile(join(evil, "logo.png"), "x");
  await assert.rejects(() => collect(evil), /Unsupported file type/); pass();
  console.log(`protect: ALL OK (${ok} checks, bundle ${(bundle.length / 1e6).toFixed(2)} MB)`);
} finally { await rm(work, { recursive: true, force: true }); }
