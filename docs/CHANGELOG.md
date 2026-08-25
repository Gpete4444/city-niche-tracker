# Rover changelog

## Version 1.2 (`1.2.0`)

Operator UX and decision/map reliability since 1.1:

- **Tables:** Content-fit column widths with session drag-resize; Batch/Notes default ~14ch; Discovery Notes match; stage progress column; freeze strip; Homepages/Subpages centered
- **Research filters:** Compact Find + Selection/Decision/Groups accordion (manual open only; no auto-toggle; no deselect on accordion/toolbar chrome)
- **Stages:** Always-visible Stage 1–4 boxes (actions disabled until selection) to stop table jump
- **Short viewports:** Page scroll unlocked on Discovery / Research / Website Builder / Launched Sites / Phone when the window is short or narrow
- **Decisions:** Score-based recommend (pursue ≥7 / maybe 6–7 / pass <6); Discovery stays review until Research stages 1–3; migration helper on startup
- **Map:** Fix *City place names (Park City, etc.); St/Mt/Ft aliases; safer Show matching; selection label beside Reset

## Version 1.1 (`1.1.0`) — continued

### Structural Openness

- **Structural Openness:** Stage-1 competition uses structural blue-link Openness; Stage 2 preserves that score; Domain Rank stays on Displaceability only (rubric v3).

### Earlier 1.1

Pipeline and Rover dashboard improvements for parallel work and clearer operator feedback:

- True parallel **Prepare preview** via heavy jobs + worker staging (Jobs K pool)
- In-step Prepare progress bar (no false green check while running)
- Launch-content gaps preflight; join existing Prepare job on 409
- Launched-site edit guard + **Revert** from GitHub Ship
- Restore fidelity for confirmed Structure / image slots / locations
- Operator cadence, env setup, GSC/metrics, and related docs
