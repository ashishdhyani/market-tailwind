#!/usr/bin/env node
/* Password-protects the static site.
 *
 *   MARKET_PASSWORD='a long passphrase' node tools/protect.mjs [srcDir=site] [outDir=dist]
 *
 * Reads every file in srcDir, compresses and encrypts them into outDir/bundle.enc (AES-256-GCM, key from
 * PBKDF2-SHA256, 600,000 iterations), and writes a small login page to outDir/index.html. Publish outDir,
 * not srcDir. The page decrypts in the browser, so the password is never sent anywhere.
 *
 * Fails (rather than publishing unprotected) if the password is missing or shorter than 12 characters.
 * Anyone can download bundle.enc and guess passwords offline, so use a long, unique passphrase.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { pbkdf2Sync, randomBytes, webcrypto } from "node:crypto";

export const SALT = "market-tailwind/v1";
export const ITERATIONS = 600000;
export const MAGIC = Buffer.from([0x4d, 0x54, 0x31, 0x00]); // "MT1\0"
export const MIN_PASSWORD = 12;
const TEXT_EXT = new Set([".html", ".js", ".css", ".json"]);

export async function collect(srcDir) {
  const files = {};
  async function walk(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) { await walk(full); continue; }
      const rel = relative(srcDir, full).split(sep).join("/");
      const ext = rel.slice(rel.lastIndexOf("."));
      if (!TEXT_EXT.has(ext)) throw new Error(`Unsupported file type in site/: ${rel} (only html, js, css, json are bundled)`);
      const text = await readFile(full, "utf8");
      // The login page inlines scripts into HTML; these sequences could break out of a <script> element.
      if (ext === ".js" && (/<\/script/i.test(text) || text.includes("<!--"))) throw new Error(`${rel} contains "</script" or "<!--" and cannot be inlined safely`);
      files[rel] = text;
    }
  }
  await walk(srcDir);
  if (!files["index.html"]) throw new Error("site/index.html is missing");
  return files;
}

export function deriveKey(password) {
  return pbkdf2Sync(password, SALT, ITERATIONS, 32, "sha256");
}

export async function encrypt(files, password) {
  const iv = randomBytes(12);
  const key = await webcrypto.subtle.importKey("raw", deriveKey(password), "AES-GCM", false, ["encrypt"]);
  const packed = gzipSync(Buffer.from(JSON.stringify(files)), { level: 9 });
  const ct = Buffer.from(await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, packed));
  return Buffer.concat([MAGIC, iv, ct]);
}

export async function decrypt(buf, password) {  // used by tests; the browser has its own copy in login.html
  if (!buf.subarray(0, 4).equals(MAGIC)) throw new Error("bad format");
  const key = await webcrypto.subtle.importKey("raw", deriveKey(password), "AES-GCM", false, ["decrypt"]);
  const plain = await webcrypto.subtle.decrypt({ name: "AES-GCM", iv: buf.subarray(4, 16) }, key, buf.subarray(16));
  return JSON.parse(gunzipSync(Buffer.from(plain)).toString("utf8"));
}

async function main() {
  const [src = "site", out = "dist"] = process.argv.slice(2);
  const password = process.env.MARKET_PASSWORD || "";
  if (password.length < MIN_PASSWORD) {
    console.error(`::error::MARKET_PASSWORD is missing or shorter than ${MIN_PASSWORD} characters. Not publishing an unprotected site. `
      + "Add it under repo Settings > Secrets and variables > Actions > New repository secret.");
    process.exit(1);
  }
  const files = await collect(src);
  const bundle = await encrypt(files, password);
  const login = await readFile(join(dirname(fileURLToPath(import.meta.url)), "login.html"), "utf8");
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await writeFile(join(out, "bundle.enc"), bundle);
  await writeFile(join(out, "index.html"), login);
  await writeFile(join(out, "robots.txt"), "User-agent: *\nDisallow: /\n");
  console.log(`Protected ${Object.keys(files).length} files -> ${out}/ (bundle.enc ${(bundle.length / 1e6).toFixed(2)} MB)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
