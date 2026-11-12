# Open Prosthetic Builder: Design Spec (v0.1)

A free, open-source website where someone customizes a 3D-printable prosthetic arm and downloads print-ready files. Phase 1 scope: **transradial (below-elbow) arm**.

> **Safety note:** This is a community-engineering project, not a certified medical device. Every release must state this clearly. Socket fit and load-bearing parts should be reviewed by a prosthetist or clinician before real-world use.

---

## 1. Goals

- Customize each part's length and key dimensions in the browser.
- Live 3D preview that updates as sliders move.
- Download **STL** (print-ready), **STEP** (editable CAD), and the **parameter file** (JSON/.scad) so anyone can reproduce or fork a design.
- Parts are **detachable** via a locking joint that carries everyday loads.
- Printable on a typical hobby FDM printer with no supports where possible.

## 2. Non-goals (v1)

- Myoelectric or powered hands (design joints so these can be added later).
- Automatic socket scanning from photos.
- Medical certification.

---

## 3. Part breakdown (transradial)

| # | Part | Customizable parameters | Notes |
|---|------|------------------------|-------|
| 1 | **Socket** | Residual limb length, circumference at 3 stations (proximal, mid, distal), wall thickness, trim-line height, strap-slot positions | Most fit-critical part. Clinician review recommended. |
| 2 | **Suspension cuff / strap mount** | Upper-arm circumference, cuff width | Holds socket on the limb. |
| 3 | **Forearm tube** | Length (independent), outer diameter, wall thickness | Simple, strong, reprinted often. |
| 4 | **Wrist coupling** | Coupling size (fixed standard), rotation lock yes/no | Quick-disconnect to the terminal device. |
| 5 | **Terminal device** | Hand size, device type: passive hand, hook, utensil/tool holder | Swappable. |

Each part has its **own length slider** with min/max limits. The site shows the total assembled length and a left/right toggle.

---

## 4. Detachable joint and locking mechanism

All connections between parts 1-2-3-4-5 use **one standardized joint** so parts are interchangeable.

**Recommended joint: bayonet (quarter-turn) with spring-detent lock**
- Male stub with 3 radial lugs, female collar with matching L-shaped channels.
- Quarter-turn to engage; a **printed flexure (or small steel spring + ball)** clicks into a detent so it cannot rotate loose.
- A **release button** must be pressed to unlock, preventing accidental disconnect.
- Lugs load in shear across a large face, which is stronger than thin printed threads.

**Alternatives to prototype and compare**
1. Coarse trapezoidal thread with a locking collar (simple, slower to swap).
2. Cam-lever clamp on a split tube collar (very strong, bulkier).

**Load targets (initial, to be validated by testing)**
- Static hold: **5 kg** at the hand, with safety factor of 3, so test to 15 kg.
- Cyclic: 10,000 cycles of 2 kg loading with no loosening or cracking.
- Pull-out (axial): at least 20 kg.
- Torque before slip: at least 3 N·m.

**Design rules**
- Layers must be printed so layer lines are **not** across the lugs' shear plane (print joint pieces oriented axially).
- Minimum 4 perimeters, at least 40% gyroid infill in joint zones.
- Add heat-set brass inserts as an option for any screw-based safety pin.
- A secondary **safety pin or clip** is recommended so a single failure does not drop the hand.

---

## 5. Materials and printing

| Use | Recommended | Why |
|-----|-------------|-----|
| General parts | PETG | Tough, easy to print |
| High-load joints | PA12-CF / Nylon | Fatigue resistance |
| Socket (prototyping) | PETG or TPU liner | TPU liner for comfort |

The site exports **print profile hints** (orientation, wall count, infill) as a README bundled with each download. Slicer-specific files (3MF with settings) are a later milestone.

---

## 6. Software architecture (hybrid)

```
Browser (static site)                 Optional backend
┌──────────────────────────┐         ┌──────────────────────┐
│ UI: sliders + validation │         │ CadQuery service     │
│ three.js 3D preview      │──JSON──▶│ generates STEP files │
│ OpenSCAD-WASM → STL      │         │ (stateless, queued)  │
└──────────────────────────┘         └──────────────────────┘
```

- **Parametric source of truth:** one `params.schema.json` defines every parameter, its limits, and defaults. Both the browser (OpenSCAD) and backend (CadQuery) read it.
- **Browser path:** OpenSCAD compiled to WebAssembly renders STL locally, so no server is needed for the core experience and user data stays on their device.
- **Backend path (optional):** CadQuery builds the same parts and exports **STEP** for editing in Fusion, FreeCAD, etc.
- **Parity tests:** CI generates the same default design in both engines and compares volume/bounding box within tolerance.
- **Frontend:** TypeScript + Vite + three.js. No account required.

### Validation (runs in the UI before export)
- Wall thickness at least 2.4 mm, joint lug thickness at least 4 mm.
- Total length within anatomical range.
- Warnings, such as socket too long for tube diameter or an overhang needing supports.
- Blocks export if a hard limit is violated.

---

## 7. Repository layout

```
/hardware
  /openscad       # parametric .scad modules (socket, tube, joint, wrist, hand)
  /cadquery       # same parts in Python for STEP export
  /params         # params.schema.json + default presets
/web              # frontend
/server           # optional STEP service
/tests
  /mechanical     # test protocols + results
  /parity         # OpenSCAD vs CadQuery checks
/docs             # build guide, assembly, safety, materials
```

## 8. Licensing

- **Hardware designs:** CERN-OHL-S v2 (strongly reciprocal) or CC-BY-SA 4.0.
- **Software:** Apache-2.0 or MIT.
- **Contributions:** Developer Certificate of Origin (DCO) sign-off.

---

## 9. Roadmap

1. **M0: Joint prototype.** Print three joint variants, run pull and torque tests, pick one.
2. **M1: Parametric parts.** Tube, wrist coupling, passive hand in OpenSCAD with the standard joint.
3. **M2: Website MVP.** Sliders, 3D preview, STL download, validation.
4. **M3: Socket module.** Measurement-driven socket with guidance and clinician-review checklist.
5. **M4: STEP export + backend.** CadQuery service, parity tests.
6. **M5: Community.** Test-report submissions, terminal-device library (hook, tool holder), translations.

## 10. Open questions

- Which standard wrist coupling to match (an existing quick-disconnect standard, or our own)?
- How will fit feedback be gathered from users and prosthetists?
- Who can run mechanical testing (a makerspace or university lab)?
- Child sizing: out of scope for v1, or a growth-adjustable design?
