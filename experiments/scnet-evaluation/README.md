# SCNet evaluation on the choir Library

An isolated Windows/Node CPU experiment. It does not install dependencies into the app or change its audio pipeline.

Double-click `Listen.cmd`, or open `results/index.html` in a browser, for the listening page. Every excerpt includes original, estimated vocals, and estimated accompaniment WAVs, pitch comparisons using the app's actual extractor, and CPU/memory plots. The players can switch versions at the same timestamp. Listening notes are saved in browser local storage when available.

## Reproduce

From this directory, using Node 22 and Python 3 on Windows, with the project's usual root dependencies already installed (the report uses its TypeScript pitch extractor):

```powershell
npm.cmd ci --ignore-scripts --no-audit --no-fund
node prepare.mjs
python monitor.py
node report.mjs
```

`prepare.mjs` downloads the catalogue, six source recordings, two score pages for context, and the compact SCNet checkpoint. It verifies the checkpoint against the package's pinned SHA-256 and cuts the excerpts before benchmarking. Existing downloads are reused. Model and audio files stay in this directory's ignored local folders.

`monitor.py` starts one Node process per excerpt, sequentially. Windows samples process RAM, private commit, CPU time, whole-PC CPU, available physical RAM, and available commit every 250 ms. It records an approximately three-second baseline before each run. Runs use two ONNX intra-op threads, one inter-op thread, the CPU provider, and the package's default overlap. Sustained critically low available RAM or a 15-minute excerpt timeout stops a run. These limits are evaluation safeguards, not deployment benchmarks.

`report.mjs` runs pitch analysis after separation measurements, so analysis does not contaminate inference timing. Completed analysis is cached. The model is small SCNet, not SCNet-large. The CPU run is native ONNX Runtime, not a browser/WebGPU/mobile test.

You can evaluate individual prepared IDs:

```powershell
python monitor.py somebody-to-love-1-soprano
```

Completed measurements are skipped. To repeat a run, first move that excerpt's `metrics.json` and `monitor-summary.json` somewhere else, then run the command again. Existing audio and logs for that excerpt will be overwritten. To recompute pitch analysis after changing the app's pitch extractor, move its `analysis.json` aside and regenerate the report.

## Files and interpretation

- `results/index.html`: local listening and measurement report; keep its sibling excerpt folders with it.
- `results/manifest.json`: source URLs, crop positions, model hash, machine information, and pinned package versions.
- `results/summary.json`: complete measurement summary and limitations.
- `results/<excerpt>/original.wav`, `vocals.wav`, `accompaniment.wav`: PCM16 listening samples, using the same anti-clipping gain for all three versions.
- `results/<excerpt>/load.csv`: external samples; `metrics.json`: exact process CPU/timing and inference chunk timings; `monitor-summary.json`: OS memory high-water mark and load summary.
- `results/<excerpt>/analysis.json`: pitch frames and signal-level measurements. Float32 files retain the unattenuated data for reproducible analysis.

The Library does not supply clean stems or an aligned reference melody. Therefore pitch changes, output energy ratios, and removed notes are descriptive measurements, **not** accuracy scores or vocal-leakage measurements. An arrangement labelled a cappella may still have piano guide notes in its rehearsal recording. Automated listening cues identify interesting signal changes, not verified vocal/instrument labels. This experiment does not claim an independent human listening assessment.

Accompaniment is the original mixture minus estimated vocals. It includes all non-vocal material and separation error, and is not necessarily piano alone. The WAVs reconstruct their mixture before quantization. A single shared attenuation gain prevents clipping; there is no per-stem normalization that could disguise leakage.

Whole-PC load includes other applications. Compare its baseline with processing load and use the worker's process CPU to assess SCNet itself. A working-set peak is physical resident memory; private commit also includes memory that may be paged out. Sampled page faults include soft faults and cannot be interpreted as disk paging alone.

## Full Library preparation

The full-song batch is separate from the excerpt evaluation. It prepares 27 upload MP3s from 22 source recordings: 17 individual vocal parts, five vocal-only all-voices mixes, and one accompaniment per processed song. Accompaniment is extracted from the all-voices mix, rather than combining several potentially different accompaniments.

Processed songs: Corcovado, Let It Snow, Mas Que Nada, Somebody to Love, and Water Is Wide. Connected, Follow the Star, Moon River, Words, and You Can't Step Twice are explicitly excluded and remain unchanged. The Chain and White Winter Hymnal currently have no audio entries.

After installing the isolated dependencies and preparing the model as above:

```powershell
npm.cmd run library:prepare
.\RunLibrary.cmd
```

Preparation downloads originals without modifying the host. The runner starts hidden, processes one recording at a time using two CPU threads, and continues independently of the terminal. This is roughly 80 minutes of input audio and takes several hours on this PC. It prevents idle system sleep while active, without changing saved power settings; pausing or finishing releases that request. Keep the PC powered on. Double-click `LibraryStatus.cmd` to view progress, `PauseLibrary.cmd` to pause, or `ResumeLibrary.cmd` to resume. Completed windows are saved; interruption requires repeating at most the active window. Use pause before restarting the PC.

Output and working files are ignored by Git:

- `../../artifacts/choir-library-upload/index.html`: listen to completed recordings while the batch continues.
- `../../artifacts/choir-library-upload/READY.txt`: appears only after all 27 files and both catalogues pass validation. Until this exists, the bundle is incomplete.
- `../../artifacts/choir-library-upload/s/<song-id>/`: MP3 files retaining existing base names with `-voice` or `-acc` added.
- `../../artifacts/choir-library-upload/songs.replace.json`: recommended full catalogue, replacing processed recordings while preserving scores and excluded songs.
- `../../artifacts/choir-library-upload/songs.append.json`: alternative full catalogue retaining originals alongside labelled processed variants.
- `../../artifacts/choir-library-upload/processed-parts.json`: new entries only, for manual merging by the host.
- `../../artifacts/choir-library-upload/UPLOAD-NOTES.txt`: instructions for merging the new files and choosing a catalogue. Existing original audio and score assets referenced by the catalogue must remain on the host.
- `library-work/originals/`: all downloaded original recordings.
- `library-work/masters/`: 24-bit FLAC masters for future re-encoding without running SCNet again.
- `library-work/jobs/<recording>/`: resumable checkpoints, worker log, completion metadata, and one-second Windows CPU/memory measurements in `load.csv`. Completed checkpoints are removed after successful encoding; originals and masters remain.
- `library-work/status.html`, `status.json`, and `runner.stderr.log`: live progress and any failure details.

The MP3 encoder preserves leading rests and checks gapless sample counts by decoding every output. Mono sources stay mono at 128 kbps, 44.1 kHz, to preserve the app's decoded-audio memory budget. Stereo sources use 160 kbps. A common gain for vocals and accompaniment prevents clipping. The first mix can be converted from its initial stereo encoding using `node library-reencode.mjs`; this uses its lossless masters and runs automatically in the batch.

The app recognizes the new accompaniment metadata, keeps it audible without pitch analysis, and defaults to processed vocals when both variants exist. The optional all-voices mix stays unchecked when individual parts are available. Nothing in this workflow uploads or deploys files.

Run `npm.cmd test` in this experiment directory to check the separation window implementation against the upstream pipeline, checkpoint reuse, mono/stereo MP3 alignment, and final catalogue construction. These tests use synthetic signals and temporary files.

## Provenance and licensing

- SCNet: <https://github.com/starrytong/SCNet>. Author confirmation for MIT weights and converted redistribution: <https://github.com/starrytong/SCNet/issues/35>.
- JavaScript pipeline and compact ONNX export: `@audio/neural-separate` 0.7.0, <https://github.com/audiojs/neural/tree/main/packages/neural-separate>. Its `NOTICE` is installed in `node_modules/@audio/neural-separate/NOTICE`.
- Native inference: `onnxruntime-node` 1.24.3, <https://github.com/microsoft/onnxruntime>.
- Evaluation-only MP3 decoder: `mpg123-decoder` 1.0.3, <https://github.com/eshaz/wasm-audio-decoders>. Preserve the package's MIT and bundled mpg123 LGPL notices if redistributing this evaluation environment; it is not added to the app.
- Catalogue: <https://papaya-truffle-25f879.netlify.app/songs.json>. Source recordings and score images retain their existing rights. This experiment stores them locally and does not publish them.
