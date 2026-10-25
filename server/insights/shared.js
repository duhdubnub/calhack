import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { config, serverDirectory } from "../config.js";
import { persistentMemo } from "../storage/memo.js";
export const coordinate = (v, min, max) => {
  if (
    v === undefined ||
    v === null ||
    v === "" ||
    Array.isArray(v) ||
    !Number.isFinite(Number(v)) ||
    Number(v) < min ||
    Number(v) > max
  )
    throw new Error("Valid coordinates are required");
  return Number(v);
};
export const coords = (q) => ({
  lat: coordinate(q.lat, -90, 90),
  lng: coordinate(q.lng, -180, 180),
});
export function moduleHandler(name, validate, load, { ttl = 86400000 } = {}) {
  const memo = persistentMemo(
    join(serverDirectory, ".cache", "insight-" + name + ".json"),
  );
  return async (q) => {
    const params = validate(q);
    if (config.useFixtures) {
      const fixtures = JSON.parse(
        await readFile(
          join(serverDirectory, "fixtures", "insight-" + name + ".json"),
          "utf8",
        ),
      );
      const index =
        params.address?.includes("1601") ||
        params.zip === "78741" ||
        (params.lat && params.lat < 30.245)
          ? 1
          : 0;
      return {
        ...fixtures[index],
        usingFixtures: true,
        sampleNotice:
          "Saved demonstration data; may describe a different property or area.",
      };
    }
    return memo(
      [name, config.enableApify, params],
      async () => ({ ...(await load(params)), usingFixtures: false }),
      ttl,
      { bypass: q.retry === "1" },
    );
  };
}
