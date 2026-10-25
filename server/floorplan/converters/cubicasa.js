import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importFloorPlan } from "../../../src/lib/planner/importFloorPlan.js";
import { calibrate } from "../../../src/lib/planner/calibration.js";

export class ConversionError extends Error {}
const worker = fileURLToPath(new URL("../python/convert.py", import.meta.url));
export function cubicasaSettings(env = process.env) {
  const localRoot = fileURLToPath(new URL("../../data/cubicasa/", import.meta.url));
  const bundledDir = fileURLToPath(new URL("../../../floorplan/cubicasa5k/", import.meta.url));
  const dir = env.CUBICASA_DIR || (existsSync(path.join(bundledDir, "floortrans")) ? bundledDir : path.join(localRoot,"CubiCasa5k"));
  // model_1427.pth is the pose backbone, not the full floor-plan checkpoint.
  const weights = env.CUBICASA_WEIGHTS || [path.join(dir,"model_best_val_loss_var.pkl"), path.join(localRoot,"CubiCasa5k","model_best_val_loss_var.pkl")].find(existsSync);
  const localPython = path.join(localRoot,".venv",process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  return { dir, weights, python: env.CUBICASA_PYTHON || (existsSync(localPython) ? localPython : "python"),
    configured: !!dir && existsSync(path.join(dir,"floortrans")) && !!weights && existsSync(weights) };
}

// No shell, user-supplied executable, remote URLs, or unbounded process output.
export function runWorker(args, { python = "python", timeoutMs = 180000, spawnProcess = spawn } = {}) {
  return new Promise((resolve,reject) => {
    const child = spawnProcess(python,[worker,...args], { windowsHide: true, shell: false, stdio: ["ignore","pipe","pipe"] });
    let output = "", bytes = 0, settled = false;
    const done = (err,value) => { if (settled) return; settled = true; clearTimeout(timer); err ? reject(err) : resolve(value); };
    const timer = setTimeout(() => { child.kill(); done(new ConversionError("Conversion timed out. Try a smaller, single-floor image.")); },timeoutMs);
    child.stdout.on("data", chunk => {
      bytes += chunk.length;
      if (bytes > 2000000) { child.kill(); done(new ConversionError("The detected plan is too complex. Try a single-floor image.")); }
      else output += chunk.toString();
    });
    // Drain errors without forwarding model paths, stack traces, or checkpoint data.
    child.stderr.on("data", () => {});
    child.on("error", () => done(new ConversionError("Python could not start. Check CUBICASA_PYTHON on the server.")));
    child.on("close", code => {
      if (settled) return;
      try {
        const result = JSON.parse(output);
        if (code !== 0 || result.error) {
          const messages = {
            scale: "Could not confidently read room dimensions. Set the scale using two points, then convert again.",
            dependencies: "CubiCasa Python dependencies are unavailable. Complete the setup in docs/cubicasa.md.",
            geometry: "No usable walls were detected. Try a clearer image of one floor.",
          };
          throw new ConversionError(messages[result.error] || "CubiCasa could not process this plan. Check its model setup and try a clearer image.");
        }
        done(null,result);
      } catch (e) { done(e instanceof ConversionError ? e : new ConversionError("CubiCasa returned an unreadable result. Check its Python environment.")); }
    });
  });
}

export function createCubicasaConverter({ settings = cubicasaSettings(), run = runWorker } = {}) {
  let active = false;
  return {
    label: "CubiCasa floor plan conversion", imageBased: true, automaticScale: true,
    stub: !settings.configured,
    async convert({ asset, calibration, ceilingHeightIn, levelIndex = 0, rotationDeg = calibration?.rotationDeg || 0 }) {
      if (!settings.configured) throw new ConversionError("Configure CUBICASA_DIR and CUBICASA_PYTHON on the server first.");
      if (active) throw new ConversionError("Another plan is converting. Please try again when it finishes.");
      active = true;
      try {
        const args = ["--input",asset.pngPath,"--cubicasa-dir",settings.dir,"--weights",settings.weights];
        if (calibration) args.push("--pixels-per-inch",String(calibration.pixelsPerInch));
        const data = await run(args,{ python: settings.python });
        if (data.width_px !== asset.widthPx || data.height_px !== asset.heightPx) throw new ConversionError("The model result does not match the uploaded image dimensions.");
        const ppi = calibration?.pixelsPerInch ?? data.pixels_per_inch;
        const houseModel = importFloorPlan(data,{ pixelsPerInch: ppi, rotationDeg,
          level: levelIndex, widthPx: asset.widthPx, heightPx: asset.heightPx, ceilingHeightIn });
        const x = Math.min(asset.widthPx * 0.5, ppi * 1200);
        const autoCalibration = calibrate({x:0,y:0},{x,y:0},x/ppi,asset.widthPx,asset.heightPx);
        return { houseModel, confidence: data.scale_method === "ocr" ? 0.7 : 0.8,
          calibration: autoCalibration,
          warnings: [data.scale_method === "ocr" ? "Scale estimated from printed room dimensions. Verify two dimensions against the plan." : "Scale uses your calibration. Verify wall positions and openings against the plan.",
            "Door and window detection can miss or misclassify openings. Room names are not inferred."] };
      } finally { active = false; }
    },
  };
}
