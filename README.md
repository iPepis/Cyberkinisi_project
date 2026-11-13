# Open Prosthetic Builder

A free, open-source website for designing a 3D-printable **below-elbow (transradial) prosthetic arm**. Enter your measurements, adjust the length of every part, choose a prosthetic sock or liner, check the 3D preview, and download print-ready STL files.

> **Not a certified medical device.** This is a community engineering prototype. Have a prosthetist or clinician review the socket fit and the load-bearing joints before anyone wears or relies on a printed arm.

## Try it

No build step and no dependencies. The page loads the hand meshes from `web/assets/hand`, so serve it over http (it will not work from `file://`).

```bash
npm run serve        # then open http://localhost:8080
npm test             # geometry checks (every shell closed, sizes, joint fit)
npm run sample       # write sample STL files to ./samples without a browser
npm run build        # one-file page in ./dist (about 30 MB, the hand meshes are embedded)
```

## What the prototype does

- **Per-part sliders.** Residual limb length and three circumferences (socket), forearm tube length and wall, wrist adapter length, left or right arm. Total length and each part's share are shown live.
- **Prosthetic sock and silicone liner.** Pick a sock ply count (0 to 15, with presets) and an optional 3 mm or 6 mm liner. The socket grows by the sock and liner thickness on every side and gets longer at the distal end, so the limb sits where you measured it. A to-scale wall section shows skin, liner, sock, clearance and socket wall. The rim can be rolled and flared so the sock does not catch.
- **Detachable parts with one standard joint.** Socket, forearm tube, wrist adapter and hand adapter all connect through the same three-lug bayonet (quarter turn, with a rotation stop), so parts are interchangeable.
- **A printed hand with moving fingers, used unchanged.** The palm, the eight finger bones and the two thumb bones are the "Hand" by BQEducacion (Thingiverse thing:1095104, CC BY-SA). Their triangles are used exactly as published; `tools/import_hand.py` only splits the files and finds the hinge-pin holes. Each of the four fingers and the thumb bends at its base and at the joint near the tip, as far as the printed parts allow (0 to 90 and 0 to 100 degrees). The thumb sits on the opposite wall of the palm and bends toward the fingers. The pose panel has Relaxed, Open, Fist and Hook presets and a curl slider per digit (the fist keeps the thumb straight, because a bent thumb would hit the curled fingers). Movement is a preview; the real fingers are pulled by fishing line and returned by elastic cord, as the author describes.
- **A new hand adapter.** The palm is an open gauntlet with no collar, so a new part joins it to the bayonet: a standard stub, a neck, and a saddle shaped to the palm's wrist opening. The palm is not altered to fit it.
- **Two designs, on tabs.** *Basic Design* has smooth walls and is the easiest to print. *Honeycomb* perforates the socket and the forearm tube with one irregular web of cells (a Voronoi pattern with rounded corners and an even strut width). The pattern is laid over the whole arm by depth and angle, so it carries on across the joint, and the cells stay the same size while the forearm tapers. Cells are small so each hole roof is a short bridge Hole width, strut width and an extra wall thickness (which pays back the removed material) are sliders. Solid bands stay at the rim, floor and joints. The wrist adapter stays solid because it is shorter than the pattern.
- **Live 3D preview** with a cutaway through the socket, a limb-and-sock view, and a pull-apart view of the joints.
- **Downloads.** One STL per arm part, the assembled arm, a settings file, and a zip with print notes. The zip also holds a `hand/` folder with the palm, finger bones, link bars and thumb bones exactly as published (the left palm is the right palm reflected), plus the author's credit. The arm parts are already oriented for printing; the hand files keep the author's orientation.
- **Checks before export.** Hard limits block the download (for example a distal end too narrow for the joint); soft limits warn.

## Sock model

Inside radius at each station = `circumference / 2π + liner + (plies × mm per ply) + clearance`.

The distal gap grows by the liner and sock thickness so the limb end does not touch the floor. The defaults are 0.8 mm per ply and 1.0 mm clearance. Sock thickness varies by brand and compresses with wear, so measure your own sock and set the value under *Sock thickness per ply*.

## Known limits of v0.0.3

These are the next milestones in [docs/SPEC.md](docs/SPEC.md).

- **The joint is not load-tested.** It has the geometry and the rotation stop, but no spring detent or safety pin yet, so it can turn back. The 5 kg hold, 20 kg pull-out and fatigue targets in the spec are still to be tested (M0).
- **Print orientation is a hypothesis.** Parts lie as worn (collar on the bed). The lug bearing face then prints as a 3 mm overhang, which may be weaker across layers. M0 compares orientations; the spec line "print joint pieces oriented axially" needs revising once tests are in.
- **The socket is a smooth three-station shape,** not a scan. It does not model trim lines, strap slots or the suspension cuff yet.
- **The hand adapter is untested.** It is a new design (neck and saddle under the palm's wrist opening). Print it and check how the palm sits on it, and how you will hold the palm on (the original uses a fabric strap with velcro), before anyone wears it. Its neck is steep, so expect to print it flange-down with supports.
- **The hand has no sizing sliders.** The imported palm and fingers are fixed shapes, so palm and finger length, width and thickness can no longer be changed. They fit an adult-sized hand; scaling them would also scale the 1.75 mm pin holes.
- **How the fingers sit on the palm was worked out from the files, not from the author's assembly.** The published files are laid out for printing, not assembled. The knuckle pins, the distal joint and the direction of bending were found from the hinge holes, from collision checks of every pose, and from the photos on the Thingiverse page. Check an assembled hand against those photos before trusting the preview. The resting angle of the fingertip joint (6 degrees from the proximal bone's line) is the first angle at which the two bones stop touching.
- **The link bars are not placed.** The five printed link bars are included as print files but not shown in the preview: where they anchor could not be found from the files. The digits in the preview move independently, without the linkage the real hand uses. The thumb sits on the palm's wide pivot bore (the one 8.6 mm long); that choice came from the pin gaps and collision checks, so compare it with the Thingiverse photos too.
- **STL shells overlap** (lugs, ledges, the adapter's neck, the imported parts at their hinges). Slicers merge them; a boolean-based exporter and STEP output are planned (M4).

## Layout

```
web/            the website (static: index.html, style.css, src/)
web/src/geometry.js   parametric engine, runs in browser and Node
web/src/load-hand.js  loads the hand meshes, then starts the app
web/assets/hand/      the imported palm and finger files and hand-rig.json (transforms and pivots)
tests/          automated geometry tests
tools/          build-single.js (one-file page), export-sample.js, load-hand.js,
                import_hand.py (rebuilds web/assets/hand from the Thingiverse files)
docs/SPEC.md    design spec and roadmap
```

## Credits and licence

The palm and finger meshes in `web/assets/hand` are "Hand" by BQEducacion, https://www.thingiverse.com/thing:1095104, licensed Creative Commons Attribution-ShareAlike (CC BY-SA). Anything built from them must keep that credit and be shared under the same licence. Check the exact licence version on the Thingiverse page. This also decides the repository licence below: CERN-OHL-S is not on Creative Commons' list of licences compatible with CC BY-SA, so a CC BY-SA licence is the safe choice for the hardware designs (this is not legal advice).

Licence of the rest: to be chosen. The spec proposes CERN-OHL-S-2.0 (or CC-BY-SA-4.0) for the hardware designs and MIT or Apache-2.0 for the software. Add a `LICENSE` file before accepting contributions.
