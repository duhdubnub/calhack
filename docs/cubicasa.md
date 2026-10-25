# Floor plan to a furnished house

Open `/planner/demo`, choose **Floor plan**, then **Try sample 3D floor plan**.
This synthetic 20 × 15 ft wall footprint includes a partition, two doors, two
windows, and an 8 ft ceiling. Toggle **View: 2D/3D** and **Full walls/Cutaway**.
Furniture already supports dimensions, dragging, rotation, undo/redo, collision
warnings and saving. Furniture positions are retained when a house is replaced;
warnings identify pieces outside the new footprint.

## Import the existing notebook result

Choose **Import an existing 3D floor plan** and select `plan1_clean.json`.
Use the notebook's `feet` output, not `plan1_output.json` (raw polygons). Supported
input is the chat's wall-centerline schema:

```json
{
  "units": "feet",
  "ceiling_height": 8,
  "walls": [{"id": 0, "x1": 1, "y1": 1, "x2": 15, "y2": 1, "thickness": 0.5}],
  "openings": [{"wall": 0, "type": "door", "position": 7, "width": 3}]
}
```

Opening positions are **centers**, measured from the wall's first endpoint.
Geometry is converted to inches once. Ceiling height in this notebook format is
feet. Doors default to 81 inches high; windows default to a 36 inch sill and 48
inch height. Explicit opening heights/sills use the file's geometry units.
JSON imports work without a Python installation or model weights and survive
reload through existing layout storage. Limit: 200 KB, 1,000 walls, 240 openings.

Use **Check wall lengths** to inspect imported centerline lengths. Compare two
known distances with the original image; interior room dimensions exclude wall
thickness. The checked-in example image, notebook output and scale are now in
`floorplan/cubicasa5k`. The `17.72972972972973` px/ft scale belongs to
`plan1_resized.png` (1024 × 768), not the original 4000 × 3000 `fp1.jpg`.

## Convert an uploaded image or PDF

1. Upload the file, preview its page and choose **Use this page**. Crop each floor
   separately for best detection. Existing PDF normalization renders up to four pages.
2. Choose **Convert to 3D**. CPU inference uses four image rotations and reads
   printed dimensions with Tesseract. It requires at least two enclosed rooms
   with consistent dimension pairs; regions with multiple labels are skipped.
3. If the scale cannot be read, choose **Set the scale**, select two points with
   a known distance, enter its real length, and convert again. Explicit user
   calibration takes precedence over OCR.
4. Compare the top view with the original. Check two dimensions and openings,
   then add furniture, edit dimensions, drag and rotate. Full walls show window
   sills and door headers; cutaway makes furniture easier to see.

Each successful conversion replaces that floor and retains other converted
floors. Recalibration/rotation invalidates the previous model. Furniture physical
dimensions never scale. Single-job CPU concurrency, a 180-second deadline,
bounded output and existing upload ownership checks apply.

## Local model setup

The server now uses the source checked into `floorplan/cubicasa5k` by default.
It reuses the existing Python environment at `server/data/cubicasa/.venv` and
the full trained checkpoint at
`server/data/cubicasa/CubiCasa5k/model_best_val_loss_var.pkl` when available.
Explicit `CUBICASA_DIR`, `CUBICASA_PYTHON`, and `CUBICASA_WEIGHTS` settings
override these defaults. The bundled `model_1427.pth` is only a pose backbone;
it does not replace the full floor-plan checkpoint.

The official source is [CubiCasa/CubiCasa5k](https://github.com/CubiCasa/CubiCasa5k).
Download its **official pretrained weights**, linked under Evaluation in that
README. Use trusted weights: PyTorch loads the legacy pickle checkpoint with
`weights_only=False`. No uploaded checkpoint is accepted.

To reuse an existing working environment, set these in `server/.env`:

```dotenv
CUBICASA_DIR=/absolute/path/to/CubiCasa5k
CUBICASA_PYTHON=/absolute/path/to/.venv/bin/python
# Optional if not in the CubiCasa directory:
CUBICASA_WEIGHTS=/absolute/path/to/model_best_val_loss_var.pkl
# Optional if Tesseract is not on PATH:
TESSERACT_CMD=/absolute/path/to/tesseract
```

On Windows the Python executable is `.venv/Scripts/python.exe`. For a new local
setup, clone the source to `server/data/cubicasa/CubiCasa5k`, create a virtual
environment at `server/data/cubicasa/.venv`, and install:

```sh
python -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
python -m pip install -r server/floorplan/python/requirements.txt
```

Put `model_best_val_loss_var.pkl` in the cloned CubiCasa directory. This local
directory and environment are detected automatically. Restart the API after
setup. For automatic scale, the `tesserocr` wheel bundles the OCR runtime. Place
the official [English trained data](https://github.com/tesseract-ocr/tessdata_fast/blob/main/eng.traineddata)
at `server/data/cubicasa/tessdata/eng.traineddata`, or set `TESSDATA_PREFIX` to an
existing language-data directory. The worker also supports a system Tesseract
executable through `pytesseract` as a fallback. On Fedora: `sudo dnf install
tesseract`. Explicit two-point calibration works without OCR.

The worker applies compatibility shims for NumPy aliases, SciPy `stats.mode`,
and Matplotlib colormaps without editing the external checkout. Missing model
setup disables conversion but leaves JSON import and furniture placement usable.

## Limits and validation

CubiCasa can miss openings and distort angled walls during its own polygon
postprocessing. The viewer preserves the segments it receives, including angles;
it cannot recover detail already lost upstream. Room names and interior room
polygons are not inferred. The floor surface and outside-footprint checks use
the image/import bounding rectangle, so concave exterior voids are not checked.
Detected walls and door clearance use oriented geometry; windows are conservatively
treated as walls for furniture collision. Flush-to-wall snapping is disabled for
detected models. Photorealistic furniture, renovation AI and a first-person tour
are separate work.

Run `node --test server/tests/*.test.js`, `node node_modules/vite/bin/vite.js build`,
and `node server/scripts/check-secrets.js`. Import/API tests use synthetic geometry
and a stubbed model runner; they do not establish inference accuracy. Real model
inference must also be checked with a real floor plan.

The Python OCR smoke tests use actual Tesseract on two generated rooms and a
blank image: `python server/floorplan/python/test_scale.py`.

The bundled source was also verified through the real upload and conversion API
using `plan1_resized.png` and its supplied scale: 61 wall segments, 8 doors and
10 windows, with geometry converted to inches at 1.4774774774774775 px/in.
Automatic OCR scale was rejected on the original example; it requires manual
calibration for this input. These counts verify execution and schema integration,
not the accuracy of every detected segment or opening.
