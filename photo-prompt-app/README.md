# Photo prompt app

Writes photograph prompts for one Rover candidate. Rover generates the images afterward from **Website → Review images**. This folder is separate from `ops/`. Copy the whole folder into a new Rover download. The copy list is [ROVER-UPDATE-COPY.md](ROVER-UPDATE-COPY.md). The same list is in `docs/ROVER-UPDATE-COPY.md`.

## Before you run

1. Start Rover with `npm run rover` (http://127.0.0.1:8787).
2. On the candidate, finish **Structure** and the service list so the photo slots exist.
3. Make an object file: one recognizable thing per line. See `objects.example.txt`.

## Commands

From the Rover folder:

```powershell
node photo-prompt-app/write-prompts.mjs --candidate <candidate-id> --objects photo-prompt-app/objects.example.txt
```

That is a dry run. It prints every prompt and writes `photo-prompt-app/out/<candidate-id>.json`. Nothing is saved in Rover.

When the prompts look right:

```powershell
node photo-prompt-app/write-prompts.mjs --candidate <candidate-id> --objects your-objects.txt --apply
```

Then in Rover, open that candidate → **Website → Review images → Generate**. Review the first city. **Save photo group** with a name you can load on later cities.

Gilbert’s photos and prompts are already saved. The app will not write over `gilbert-smart-home-automation-installation` unless you pass `--allow-gilbert`.

## What a prompt contains

One object, one place, one framing. A hero is the finished system. A materials photo is that object where it is installed. A process photo is the step itself, with a technician only for install, test, pair, or program, and a homeowner on a site visit. A before/after after-image is an edit of the before. Website captions are not pasted into the prompt. A lit screen is described without the stock “no people, no UI” sentence, which blanks screens.
