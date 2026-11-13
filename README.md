# Open Prosthetic Builder

**A free, open-source tool for designing a 3D-printable below-elbow (transradial) prosthetic arm, right in your browser.**
Version **v0.0.6** · prototype

> **This is not a medical device.** It is a community engineering prototype. Have a prosthetist or clinician review the socket fit and the load-bearing joints before anyone wears or relies on a printed arm.

## Why this exists

3D printers and filament have become cheap for what they can do, and chances are you know someone who owns one. Prosthetic limbs, on the other hand, are expensive, and life is expensive enough already. This project is an attempt to put those two facts together: type in a few measurements, get print-ready files, and hand them to a friend with a printer.

It is a starting point, not a finished answer. The more people test it, fix it and share what they learn, the closer it gets to being something safe to rely on.

## Contents

- [Try it](#try-it)
- [How to use the tool](#how-to-use-the-tool)
- [What it does](#what-it-does)
- [What you get when you download](#what-you-get-when-you-download)
- [Sock model](#sock-model)
- [Known limits](#known-limits-of-v006)
- [Project layout](#layout)
- [Credits and licence](#credits-and-licence)

## Try it

No build step and no dependencies. The page loads the hand meshes from `web/assets/hand`, so serve it over http (it will not work from `file://`).

```bash
npm run serve        # then open http://localhost:8080
npm test             # geometry checks (every shell closed, sizes, joint fit)
npm run sample       # write sample STL files to ./samples without a browser
npm run build        # one-file page in ./dist (about 30 MB, the hand meshes are embedded)
```

## How to use the tool

1. **Pick the arm side.** Right or left, under *Hand*.
2. **Measure the residual limb.** Enter its length and three circumferences (near the elbow, middle, and the distal end). Measure the bare limb; the sock and liner allowance is added for you.
3. **Choose your sock and liner.** Set the number of sock plies (0 to 15, with presets) and an optional 3 mm or 6 mm silicone liner. Sock thickness varies by brand, so measure yours and set *Sock thickness per ply*.
4. **Set the part lengths.** Adjust the forearm tube length and wall and the wrist adapter length. The total length and each part's share update live.
5. **Pick a design.** *Basic Design* has smooth walls and is the easiest to print. *Honeycomb* perforates the socket and tube to save material; set hole width, strut width and extra wall.
6. **Check the 3D preview.** Drag to turn, shift-drag to tilt, scroll or pinch to zoom. Try the cutaway, the limb-and-sock view, and *Pull apart* to see the joints. Use the *Hand pose* presets (Relaxed, Open, Fist, Hook) or the per-finger sliders to see how the fingers move.
7. **Read the checks.** Under *Summary and download*, hard limits block the download (for example a distal end too narrow for the joint) and soft limits show a warning.
8. **Download.** Use **Download everything (.zip)**, or pick single parts: Socket, Forearm tube, Wrist adapter, Palm, or Fingers. The Fingers button has a small arrow to choose All, Thumb, Index, Middle, Ring or Pinky.
9. **Print and test.** Read the print notes in the zip, then have a prosthetist check the fit before anyone wears it.

## What it does

- **Per-part sliders.** Residual limb length and three circumferences (socket), forearm tube length and wall, wrist adapter length, left or right arm.
- **Prosthetic sock and silicone liner.** The socket grows by the sock and liner thickness on every side and gets longer at the distal end, so the limb sits where you measured it. A to-scale wall section shows skin, liner, sock, clearance and socket wall. The rim can be rolled and flared so the sock does not catch.
- **Detachable parts, one standard joint.** Socket, forearm tube, wrist adapter and hand adapter all connect through the same three-lug bayonet (quarter turn, with a rotation stop), so parts are interchangeable.
- **A printed hand with moving fingers, used unchanged.** The palm, the eight finger bones and the two thumb bones are the "Hand" by BQEducacion (Thingiverse thing:1095104, CC BY-SA). Their triangles are used exactly as published; `tools/import_hand.py` only splits the files and finds the hinge-pin holes. Each finger and the thumb bends at its base and near the tip, as far as the printed parts allow. Movement is a preview; the real fingers are pulled by fishing line and returned by elastic cord, as the author describes.
- **A new hand adapter.** The palm is an open gauntlet with no collar, so a new part joins it to the bayonet: a standard stub, a neck, and a saddle shaped to the palm's wrist opening. The palm itself is not altered.
- **Two designs, on tabs.** *Basic Design* (smooth) and *Honeycomb* (an irregular web of rounded cells over the socket and tube, with solid bands at the rim, floor and joints). Cells stay the same size while the forearm tapers, and are small enough that each hole roof is a short bridge.
- **Live 3D preview** with a cutaway through the socket, a limb-and-sock view, and a pull-apart view of the joints.
- **Checks before export.** Hard limits block the download; soft limits warn.

## What you get when you download

| File | What it is |
|---|---|
| `socket.stl` | The socket, in print orientation |
| `tube.stl` | The forearm tube, in print orientation |
| `wrist.stl` | The wrist adapter, in print orientation |
| `palm.stl` | Everything between the wrist adapter and the fingers: the new hand adapter joined to the published palm (the left palm is the right palm reflected) |
| `fingers/all.stl` | All four fingers and the thumb, each with its link bar |
| `fingers/<finger>.stl` | One finger (or the thumb): its two bones and its link bar |
| `ATTRIBUTION.txt`, `README.txt` | The hand author's credit, and print and assembly notes for your settings |

Single-part buttons give one STL each. The Fingers button downloads the digit shown on it, or all of them if you have not picked one.

## Sock model

Inside radius at each station = `circumference / 2π + liner + (plies × mm per ply) + clearance`.

The distal gap grows by the liner and sock thickness so the limb end does not touch the floor. The defaults are 0.8 mm per ply and 1.0 mm clearance. Sock thickness varies by brand and compresses with wear, so measure your own sock.

## Known limits of v0.0.6

These are the next milestones in [docs/SPEC.md](docs/SPEC.md).

- **The joint is not load-tested.** It has the geometry and the rotation stop, but no spring detent or safety pin yet, so it can turn back. The 5 kg hold, 20 kg pull-out and fatigue targets in the spec are still to be tested (M0).
- **Print orientation is a hypothesis.** Parts lie as worn (collar on the bed). The lug bearing face then prints as a 3 mm overhang, which may be weaker across layers. M0 compares orientations; the spec line "print joint pieces oriented axially" needs revising once tests are in.
- **The socket is a smooth three-station shape,** not a scan. It does not model trim lines, strap slots or the suspension cuff yet.
- **The hand adapter is untested.** It is a new design (neck and saddle under the palm's wrist opening). Print it and check how the palm sits on it, and how you will hold the palm on (the original uses a fabric strap with velcro), before anyone wears it. Its neck is steep, so expect to print it flange-down with supports.
- **The hand has no sizing sliders.** The imported palm and fingers are fixed shapes, so palm and finger length, width and thickness can no longer be changed. They fit an adult-sized hand; scaling them would also scale the 1.75 mm pin holes.
- **How the fingers sit on the palm was worked out from the files, not from the author's assembly.** The published files are laid out for printing, not assembled. The knuckle pins, the distal joint and the direction of bending were found from the hinge holes, from collision checks of every pose, and from the photos on the Thingiverse page. Check an assembled hand against those photos before trusting the preview. The resting angle of the fingertip joint (6 degrees from the proximal bone's line) is the first angle at which the two bones stop touching.
- **The link bars are not placed.** Each finger file includes its link bar as a print file, but the bars are not shown in the preview: where they anchor could not be found from the files. The digits in the preview move independently, without the linkage the real hand uses. The thumb sits on the palm's wide pivot bore (the one 8.6 mm long); that choice came from the pin gaps and collision checks, so compare it with the Thingiverse photos too.
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
