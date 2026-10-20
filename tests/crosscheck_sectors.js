// Usage: node tests/crosscheck_sectors.js <python-output.json>
const fs = require("fs"), E = require("../site/engine.js");
const py = JSON.parse(fs.readFileSync(process.argv[2]));
const sd = JSON.parse(fs.readFileSync(__dirname + "/../site/sector_data.json"));
const news = JSON.parse(fs.readFileSync(__dirname + "/../site/news.json"));
for (const k of Object.keys(sd.prices)) sd.prices[k] = Float64Array.from(sd.prices[k], (v) => (v === null ? NaN : v));
const r = E.sectorAnalysis(sd, news, "long");
let bad = 0;
const chk = (n, a, b) => { if (!(Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b)))) { bad++; console.log("MISMATCH", n, a, b); } };
if (r.sectors.length !== Object.keys(py).length) { bad++; console.log("sector count"); }
for (const s of r.sectors) {
  const p = py[s.name];
  chk(s.name + " price", s.priceScore, p.price); chk(s.name + " n", s.newsN, p.n);
  chk(s.name + " avg", s.newsAvg, p.avg); chk(s.name + " newsZ", s.newsZ, p.newsZ); chk(s.name + " final", s.final, p.final);
}
const order = Object.entries(py).sort((a, b) => b[1].final - a[1].final).map((e) => e[0]).join();
if (order !== r.sectors.map((s) => s.name).join()) { bad++; console.log("ORDER MISMATCH"); }
// horizons must run and return every sector
for (const h of Object.keys(E.HORIZONS)) { const x = E.sectorAnalysis(sd, news, h); if (x.sectors.length !== r.sectors.length) { bad++; console.log("horizon", h); } }
// no news -> pure price ranking
const nn = E.sectorAnalysis(sd, { generated: news.generated, items: [] }, "long");
nn.sectors.forEach((s) => chk(s.name + " nonews", s.final, s.priceScore));
console.log(bad ? `FAILED: ${bad}` : `sectors ALL MATCH (${r.sectors.length} sectors, ${r.sectors.reduce((a, s) => a + s.newsN, 0)} headline hits)`);
process.exit(bad ? 1 : 0);
