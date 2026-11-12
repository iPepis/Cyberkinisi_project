# Open Prosthetic Builder

A free, open-source website for designing a 3D-printable **below-elbow (transradial) prosthetic arm**. Enter your measurements, adjust the length of every part, choose a prosthetic sock or liner, check the 3D preview, and download print-ready STL files.

> **Not a certified medical device.** This is a community engineering prototype. Have a prosthetist or clinician review the socket fit and the load-bearing joints before anyone wears or relies on a printed arm.

## Try it

No build step and no dependencies.

```bash
npm run serve        # then open http://localhost:8080
npm test             # geometry checks (every shell closed, sizes, joint fit)
npm run sample       # write sample STL files to ./samples without a browser
```

## What the prototype does

- **Per-part sliders.** Residual limb length and three circumferences (socket), forearm tube length and wall, wrist adapter length, left or right arm. Total length and each part's share are shown live.
- **Prosthetic sock and silicone liner.** Pick a sock ply count (0 to 15, with presets) and an optional 3 mm or 6 mm liner. The socket grows by the sock and liner thickness on every side and gets longer at the distal end, so the limb sits where you measured it. A to-scale wall section shows skin, liner, sock, clearance and socket wall. The rim can be rolled and flared so the sock does not catch.
- **Detachable parts with one standard joint.** Socket, forearm tube, wrist adapter and hand all connect through the same three-lug bayonet (quarter turn, with a rotation stop), so parts are interchangeable.
- **A hand that can move like a real one.** Wrist, palm, three bones in each finger and a three-segment thumb are separate rigid pieces joined at real joint positions. Each joint stops at the range of a real hand (for example knuckle -25° to 90°, middle finger joint 0° to 105°, wrist -70° to 80°). The pose panel has Relaxed, Open, Fist and Hook presets, a curl slider per digit, and every joint on its own slider. Movement is a preview; driving it comes later.
- **Palm and per-finger sizing.** Palm length, width and thickness, wrist width and thickness, and one length slider each for the thumb, index, middle, ring and little finger.
- **Live 3D preview** with a cutaway through the socket, a limb-and-sock view, and a pull-apart view of the joints.
- **Downloads.** One STL per part, the assembled arm, a settings file, and a zip with print notes. Parts are already oriented for printing.
- **Checks before export.** Hard limits block the download (for example a distal end too narrow for the joint); soft limits warn.

## Sock model

Inside radius at each station = `circumference / 2π + liner + (plies × mm per ply) + clearance`.

The distal gap grows by the liner and sock thickness so the limb end does not touch the floor. The defaults are 0.8 mm per ply and 1.0 mm clearance. Sock thickness varies by brand and compresses with wear, so measure your own sock and set the value under *Sock thickness per ply*.

## Known limits of v0.0.1

These are the next milestones in [docs/SPEC.md](docs/SPEC.md).

- **The joint is not load-tested.** It has the geometry and the rotation stop, but no spring detent or safety pin yet, so it can turn back. The 5 kg hold, 20 kg pull-out and fatigue targets in the spec are still to be tested (M0).
- **Print orientation is a hypothesis.** Parts lie as worn (collar on the bed). The lug bearing face then prints as a 3 mm overhang, which may be weaker across layers. M0 compares orientations; the spec line "print joint pieces oriented axially" needs revising once tests are in.
- **The socket is a smooth three-station shape,** not a scan. It does not model trim lines, strap slots or the suspension cuff yet.
- **The hand is built to move but not hinged yet.** It prints as one rigid piece in the relaxed pose. The zip also holds every bone separately (`hand-segments/`) and `hand-joints.json` with each pivot, axis and range, but pin holes, hinges and tendon channels are not designed. Hooks and tool holders come later.
- **STL shells overlap** (lugs, ledges, fingers sit inside the main body). Slicers merge them; a boolean-based exporter and STEP output are planned (M4).

## Layout

```
web/            the website (static: index.html, style.css, src/)
web/src/geometry.js   parametric engine, runs in browser and Node
tests/          automated geometry tests
tools/          build-single.js (one-file page), export-sample.js
docs/SPEC.md    design spec and roadmap
```

## Licence

To be chosen. The spec proposes CERN-OHL-S-2.0 (or CC-BY-SA-4.0) for the hardware designs and MIT or Apache-2.0 for the software. Add a `LICENSE` file before accepting contributions.
