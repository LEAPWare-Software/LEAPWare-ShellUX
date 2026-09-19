# Gate 4: the 1.0 screens (v4), recorded in the repository

These are the gate-4 wireframes, v4, copied from the design canvas published on 2026-09-19. That canvas is a private claude.ai artifact, so cloud routines cannot open it.

- `screens/*.dc.html` holds the canvas source, one file per artboard; `canvas.json` is the layout.
- `png/*.png` holds a rendered picture of each artboard.
- `gen.v4.mjs` writes the nine `.dc.html` files and `canvas.json` from the token values, and **nothing else**: its only output call is `writeFileSync`, and it renders no images. **What produced the PNGs is not recorded here.** They were rendered somewhere with a browser and committed beside the source, and this repository does not say where or when, so nobody can currently regenerate them and check that they still match the HTML.

**Status: an approval is recorded on #189; the ledger has not caught up yet.** D-45 recorded an owner approval on 2026-09-18 that the owner did not recognise on 2026-09-19, so #189 was opened for the conflict. An `OWNER: gate 4 approved` comment was posted there at 2026-09-19T13:23Z, asking for a new decision row to supersede the D-45 conflict and for C-24 to cite it.

That row does not exist yet and C-24 still cites D-45, so nothing yet builds "per the approved gate-4 wireframe": ADR-0006 step 9 (the plugin manager) and wave 4 wait for the ledger, which is the order the answer itself sets out.

**Before that row is written, settle what D-45 was about.** D-45 approves "the six gate-4 screens"; this is the **v4** set and holds **nine** numbered pages, published 2026-09-19, a day after D-45, with the resolved critique and the D-48 plugin state added. The nine are not six screens plus three state sheets — `canvas.json` numbers all nine as pages. So D-45 may be an approval of an earlier, different artefact rather than a mislaid approval of this one, and #189's answer inherits the ambiguity: it reads "the six gate-4 screens (v4, `docs/design/gate4/`)". Whichever way it resolves, the decision row should name the screens it approves.

This directory is the record the screens were reviewed from, and stays here as the thing any such decision row points at.

The critique was resolved on the canvas before v4. Its resolutions R1 to R9 are listed in `docs/design/WAVE3-PLAN.md`.
