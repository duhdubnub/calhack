// Checks tracked/staged files without ever printing credential values or file content.
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config.js";

const git = (...args) => {
  try {
    return execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  } catch {
    // Child-process errors can embed stdout, which may contain a credential.
    throw new Error("Git secret scan could not complete. Check Git access and file sizes before committing.");
  }
};
const files = git("ls-files", "-z").split("\0").filter(Boolean);
const forbidden = files.filter(
  (file) => /(^|\/)\.env(?:\.|$)/.test(file) && file !== "server/.env.example",
);
if (forbidden.length)
  throw new Error(
    "An environment file is tracked or staged; stop before committing.",
  );
const secrets = [
  config.apiKey,
  config.apifyToken,
  process.env.OPENAI_API_KEY,
  ...Object.entries(process.env).filter(([key]) => /(?:KEY|TOKEN|SEED)$/.test(key)).map(([,value]) => value),
].filter(
  (value) => value && !value.startsWith('replace_') && !["your_key_here", "your_token_here"].includes(value),
);
const containsSecret = (text) =>
  secrets.some((secret) => text.includes(secret)) ||
  /apify_api_[a-zA-Z0-9]{20,}/.test(text) ||
  /sk-ant-[a-zA-Z0-9_-]{20,}/.test(text);
{
  for (const file of files) {
    const staged = git("show", `:${file}`);
    let working = "";
    try {
      working = await readFile(file, "utf8");
    } catch {}
    if (containsSecret(staged) || containsSecret(working))
      throw new Error(
        `Credential detected in ${file}; stop before committing.`,
      );
  }
  async function checkBuild(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await checkBuild(path);
      else if (containsSecret(await readFile(path, "utf8")))
        throw new Error("Credential detected in browser build.");
    }
  }
  await checkBuild("dist");
  if (containsSecret(git("log", "-p", "--all")))
    throw new Error(
      "Credential detected in Git history. STOP and notify the repository owner.",
    );
}
console.log(
  "Secret check passed: no tracked environment secrets or supplied key in source, index, history, or browser build.",
);
