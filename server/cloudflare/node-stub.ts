/**
 * Stand-in for the Node built-ins that only the development Codex provider
 * (server/engine/providers/codex-node.ts) imports. wrangler.jsonc aliases node:child_process,
 * node:readline, node:fs, node:os and node:path here, so the Worker bundles without
 * nodejs_compat. Nothing on the Worker calls them (LLM_PROVIDER=codex is refused off a Node
 * server); if something ever does, it fails loudly instead of silently.
 */
const unavailable = (name: string) => (): never => {
  throw new Error(`${name} is not available on the Cloudflare Worker`);
};

export const spawn = unavailable('child_process.spawn');
export const createInterface = unavailable('readline.createInterface');
export const mkdirSync = unavailable('fs.mkdirSync');
export const mkdtempSync = unavailable('fs.mkdtempSync');
export const readFileSync = unavailable('fs.readFileSync');
export const rmSync = unavailable('fs.rmSync');
export const tmpdir = unavailable('os.tmpdir');
export const join = unavailable('path.join');
export default {};
