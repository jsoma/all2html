// Fails fast when the running Node is below the engines floor.
//
// engine-strict only guards `pnpm install`; the failure this exists for
// happened at test time — on Node < 20.19 (no require(esm)) the two jsdom
// escaping-parity suites fail at collect and the security evidence base
// silently does not run. A version check here turns that into one clear
// sentence instead of an ERR_REQUIRE_ESM stack.
// The real requirement is require(esm): 20.19+, 22.12+, or 23+. Plain
// ">= 20.19" would re-admit Node 21.x, the exact version that broke.
const [major, minor] = process.versions.node.split(".").map(Number);
const ok = (major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major >= 23;
if (!ok) {
  console.error(
    `all2html needs Node 20.19+, 22.12+, or 23+ (found ${process.versions.node}). ` +
      "Run `nvm use` (or install a matching Node) and retry.",
  );
  process.exit(1);
}
