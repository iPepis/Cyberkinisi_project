#!/usr/bin/env python3
"""
Imports the palm and finger meshes of "Hand" by BQEducacion (Thingiverse thing:1095104,
CC BY-SA) into web/assets/hand/ without changing their shape.

    python3 tools/import_hand.py "<folder with the Thingiverse files>"

Needs numpy and scipy. What it does:
  1. Splits each STL into its separate shells and copies the triangles of the parts we use
     byte for byte into one binary STL per part (original coordinates, normals and all).
  2. Finds the hinge-pin holes (small cylindrical bores) in those parts.
  3. Writes web/assets/hand/hand-rig.json: for each hand side, the rigid transform that places
     every part in the hand frame of geometry.js, the pivot of every joint, and the outline of
     the palm's wrist opening.

Hand frame (same as geometry.js): the wrist opening sits at y = 0 and the hand points along -y.
Positive z is the palm (flexor) side, x runs across the hand. Millimetres.

The thumb sits on the palm's wide bore; the link bars are imported as spare print files only.
"""
import json
import os
import sys
from collections import defaultdict

import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

REC = np.dtype([('n', '<f4', 3), ('v', '<f4', (3, 3)), ('a', '<u2')])
HEADER = b'Part of Hand by BQEducacion, thingiverse.com/thing:1095104, CC BY-SA. Triangles unchanged.'[:80].ljust(80, b' ')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'web', 'assets', 'hand')

PHI0 = -6.0          # distal joint rest angle in the proximal frame (deg); first collision-free angle
THUMB_PSI0 = 5.0     # thumb knuckle rest angle (deg): first angle at which the bone clears the palm
FINGERS = ['index', 'middle', 'ring', 'pinky']


def load(path):
    b = open(path, 'rb').read()
    n = int(np.frombuffer(b[80:84], '<u4')[0])
    if 84 + 50 * n != len(b):
        sys.exit('not a binary STL: ' + path)
    return np.frombuffer(b[84:], dtype=REC, count=n)


def shells(rec):
    """Triangle index lists, one per connected shell, largest first."""
    v = rec['v'].astype(np.float64).reshape(-1, 3)
    _, inv = np.unique(np.round(v, 3), axis=0, return_inverse=True)
    inv = inv.reshape(-1, 3)
    m = inv.max() + 1
    rows = np.concatenate([inv[:, 0], inv[:, 1]])
    cols = np.concatenate([inv[:, 1], inv[:, 2]])
    g = coo_matrix((np.ones(len(rows)), (rows, cols)), shape=(m, m))
    _, lab = connected_components(g, directed=False)
    tri_lab = lab[inv[:, 0]]
    groups = defaultdict(list)
    for i, l in enumerate(tri_lab):
        groups[l].append(i)
    return sorted((np.array(x) for x in groups.values()), key=lambda s: -len(s))


def tris(rec, idx):
    return rec['v'][idx].astype(np.float64)


def write_stl(path, rec, idx):
    sub = rec[idx]
    with open(path, 'wb') as f:
        f.write(HEADER)
        f.write(np.uint32(len(sub)).tobytes())
        f.write(sub.tobytes())


def find_holes(T, maxedge=12.0, dmax=3.4, tol=0.5):
    """Cylindrical bores of 1.4 mm to dmax diameter in a closed shell. T: (n,3,3) triangles."""
    n = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0])
    ln = np.linalg.norm(n, axis=1)
    ok = ln > 1e-12
    n = n / np.where(ok, ln, 1)[:, None]
    e = np.maximum.reduce([np.linalg.norm(T[:, 0] - T[:, 1], axis=1),
                           np.linalg.norm(T[:, 1] - T[:, 2], axis=1),
                           np.linalg.norm(T[:, 0] - T[:, 2], axis=1)])
    cen = T.mean(1)
    out = []
    for ax in range(3):
        cand = np.where(ok & (np.abs(n[:, ax]) < 0.25) & (e < maxedge))[0]
        if len(cand) == 0:
            continue
        keys = {}
        tv = []
        for i in cand:
            tv.append([keys.setdefault(tuple(np.round(v, 3)), len(keys)) for v in T[i]])
        par = list(range(len(cand)))

        def find(x):
            while par[x] != x:
                par[x] = par[par[x]]
                x = par[x]
            return x
        emap = {}
        for ci, a in enumerate(tv):
            for u, w in ((a[0], a[1]), (a[1], a[2]), (a[0], a[2])):
                k = (min(u, w), max(u, w))
                if k in emap:
                    ra, rb = find(ci), find(emap[k])
                    if ra != rb:
                        par[rb] = ra
                else:
                    emap[k] = ci
        groups = defaultdict(list)
        for ci, i in enumerate(cand):
            groups[find(ci)].append(i)
        p = [k for k in range(3) if k != ax]
        for comp in groups.values():
            if len(comp) < 12:
                continue
            V = T[comp].reshape(-1, 3)
            mn, mx = V.min(0), V.max(0)
            ext = mx - mn
            if ext[ax] < 1.2:
                continue
            e1, e2 = ext[p[0]], ext[p[1]]
            if not (1.4 <= e1 <= dmax and 1.4 <= e2 <= dmax and abs(e1 - e2) < tol):
                continue
            c = (mn + mx) / 2
            inward = np.mean(np.einsum('ij,ij->i', n[comp], c - cen[comp]))
            if inward > 0:   # normals point at the axis: a hole, not a pin
                out.append({'axis': 'xyz'[ax], 'c': c, 'd': (e1 + e2) / 2})
    return out


def rotx(deg):
    a = np.radians(deg)
    c, s = np.cos(a), np.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def pair_center(holes):
    return np.mean([h['c'] for h in holes], axis=0)


def finger_proximal(T):
    """Knuckle pin centre (A) and distal-joint pin centre (B), both on the pin axis x."""
    hx = [h for h in find_holes(T) if h['axis'] == 'x']
    zs = sorted(set(round(h['c'][2]) for h in hx))
    lo = [h for h in hx if h['c'][2] < 20]
    hi = [h for h in hx if h['c'][2] >= 20]
    if len(lo) != 2 or len(hi) != 2:
        sys.exit('proximal phalanx: expected two bores at each end, found %s' % zs)
    return pair_center(lo), pair_center(hi)


def finger_distal(T):
    """Distal-joint pin centre (B, lower) and link pin centre (C, upper)."""
    hx = sorted([h for h in find_holes(T) if h['axis'] == 'x'], key=lambda h: h['c'][2])
    if len(hx) != 4:
        sys.exit('distal phalanx: expected four bores, found %d' % len(hx))
    return pair_center(hx[:2]), pair_center(hx[2:])


def roty(deg):
    a = np.radians(deg)
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def thumb_pins(T_prox, T_dist):
    """Thumb proximal bone: the end with the 3.2 mm bores (high z) sits on the palm, the end with the
    2.8 mm bores (low z) carries the distal bone. The distal bone has one pin pair."""
    hx = [h for h in find_holes(T_prox) if h['axis'] == 'x']
    lo = [h for h in hx if h['c'][2] < 20]
    hi = [h for h in hx if h['c'][2] >= 20]
    dx = [h for h in find_holes(T_dist) if h['axis'] == 'x']
    if len(lo) != 2 or len(hi) != 2 or len(dx) != 2:
        sys.exit('thumb: unexpected pin bores (%d, %d, %d)' % (len(lo), len(hi), len(dx)))
    return pair_center(hi), pair_center(lo), pair_center(dx)


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    src = sys.argv[1]
    files = os.path.join(src, 'files') if os.path.isdir(os.path.join(src, 'files')) else src
    os.makedirs(OUT, exist_ok=True)

    # ---- palm (right) and mirror check against the left file
    rp = load(os.path.join(files, '-hand_right.stl'))
    rsh = shells(rp)
    palm_idx = rsh[0]
    write_stl(os.path.join(OUT, 'palm.stl'), rp, palm_idx)
    P = tris(rp, palm_idx)
    V = P.reshape(-1, 3)

    lp = load(os.path.join(files, '_hand_left.stl'))
    lsh = shells(lp)
    L = tris(lp, lsh[0]).reshape(-1, 3)
    from scipy.spatial import cKDTree
    cx = float(V[:, 0].min() + L[:, 0].max())          # mirror plane: x' = cx - x
    mirrored = np.column_stack([cx - L[:, 0], L[:, 1], L[:, 2]])
    dev = float(cKDTree(V).query(mirrored[::7])[0].max())
    same = dev < 0.02
    print('left palm is the mirror of the right palm about x = %.3f (largest vertex deviation %.4f mm):' % (cx / 2, dev), same)
    if not same:
        sys.exit('left palm is not a mirror of the right palm; per-side palm files are not supported yet')

    # ---- palm knuckle pins (axis y, two cheeks about 6.2 mm apart)
    hy = [h for h in find_holes(P) if h['axis'] == 'y']
    hy.sort(key=lambda h: h['c'][1])
    pairs = []
    used = set()
    for i, a in enumerate(hy):
        for j in range(i + 1, len(hy)):
            b = hy[j]
            if i in used or j in used:
                continue
            if 5.5 < b['c'][1] - a['c'][1] < 6.9 and abs(a['c'][0] - b['c'][0]) < 3 and abs(a['c'][2] - b['c'][2]) < 3:
                pairs.append(((a['c'] + b['c']) / 2, a['c'][2] + b['c'][2]))
                used.update([i, j])
    pins = [p for p, _ in pairs if p[2] > -220]       # the pair at z = -228 is the wrist hinge, not a knuckle
    if len(pins) != 4:
        sys.exit('expected four knuckle pins in the palm, found %d' % len(pins))
    order = sorted(range(4), key=lambda i: pins[i][2])   # middle finger is the longest, little finger the shortest
    pin = {'pinky': pins[order[0]], 'middle': pins[order[3]]}
    mid_two = sorted([pins[order[1]], pins[order[2]]], key=lambda p: p[1])
    pin['index'], pin['ring'] = mid_two[0], mid_two[1]
    print('knuckle pins (right palm, original coordinates):')
    for f in FINGERS:
        print('  %-7s' % f, np.round(pin[f], 2))

    # ---- thumb pivot: the one wide bore (8.6 mm long, 3.6 mm across) low on the palm's thumb side
    cen = P.mean(1)
    region = P[(cen[:, 0] < 535) & (cen[:, 2] < -205)]      # the bore's walls join the surrounding boss, so look at this corner alone
    boss = [h for h in find_holes(region, dmax=4.2, tol=0.8) if h['axis'] == 'y' and h['d'] > 3.4 and h['c'][2] < -220]
    if len(boss) != 1:
        sys.exit('expected one thumb pivot bore in the palm, found %d' % len(boss))
    boss_pin = boss[0]['c']
    print('thumb pivot (right palm, original coordinates):', np.round(boss_pin, 2))

    # ---- wrist opening: outline of the lowest 4 mm of the palm
    zmin = V[:, 2].min()
    rim = V[V[:, 2] < zmin + 4.0]
    c0 = np.array([(rim[:, 0].min() + rim[:, 0].max()) / 2, (rim[:, 1].min() + rim[:, 1].max()) / 2, zmin])

    # ---- fingers
    mid = load(os.path.join(files, '5_middle_fingers.stl'))
    end = load(os.path.join(files, '5_end_fingers.stl'))
    msh = [s for s in shells(mid) if len(s) > 500]
    esh = [s for s in shells(end) if len(s) > 500]
    mt = [(s, tris(mid, s)) for s in msh]
    et = [(s, tris(end, s)) for s in esh]
    zext = lambda t: t.reshape(-1, 3)[:, 2].max()
    thumb_p = [x for x in mt if len(x[0]) != 17680][0]
    prox4 = sorted([x for x in mt if len(x[0]) == 17680], key=lambda x: -zext(x[1]))
    thumb_d = [x for x in et if len(x[0]) < 15000][0]
    dist4 = sorted([x for x in et if len(x[0]) > 15000], key=lambda x: -zext(x[1]))
    # longest = middle, shortest = little; the two in between are interchangeable
    prox = {'middle': prox4[0]}
    rest = sorted(prox4[1:], key=lambda x: x[1].reshape(-1, 3)[:, 1].mean())
    prox['index'], prox['ring'], prox['pinky'] = rest[0], rest[1], rest[2]
    dist = {'middle': dist4[0], 'pinky': dist4[3], 'index': dist4[1], 'ring': dist4[2]}
    parts = {}
    for f in FINGERS:
        write_stl(os.path.join(OUT, 'finger_%s_prox.stl' % f), mid, prox[f][0])
        write_stl(os.path.join(OUT, 'finger_%s_dist.stl' % f), end, dist[f][0])
        parts[f] = (prox[f][1], dist[f][1])
    write_stl(os.path.join(OUT, 'thumb_prox.stl'), mid, thumb_p[0])
    write_stl(os.path.join(OUT, 'thumb_dist.stl'), end, thumb_d[0])
    lk = load(os.path.join(files, 'LINKS.stl'))
    write_stl(os.path.join(OUT, 'links.stl'), lk, np.arange(len(lk)))

    # ---- rigs for both hands
    rig = {'frame': 'hand frame of geometry.js: wrist opening at y=0, fingers along -y, +z palm side, mm',
           'phi0Deg': PHI0, 'palmFile': 'palm.stl', 'mirrorX': cx if same else None, 'sides': {}}
    # palm frame (original coordinates) -> hand frame
    # right: x_h = +y, y_h = -(z - z0), z_h = -(x - cx0)     left (mirrored x'): x_h = -y, z_h = +(x' - cx0')
    for side in ('right', 'left'):
        mir = np.diag([-1.0, 1, 1]) if side == 'left' else np.eye(3)
        shift = np.array([cx, 0, 0]) if side == 'left' else np.zeros(3)

        def to_left(p):                               # original (right) coordinates -> this side's palm frame
            return mir @ p + shift
        c0s = to_left(c0)
        # the fingers curl into the palm cavity (photos 01 and 03 of the Thingiverse page), which is the
        # -x side of the right palm, so the palm side +z of the hand frame is -x there and +x on the left
        S = np.array([[0, 1, 0], [0, 0, -1], [-1, 0, 0]], float) if side == 'right' \
            else np.array([[0, -1, 0], [0, 0, -1], [1, 0, 0]], float)
        Rf = np.array([[0, -1, 0], [1, 0, 0], [0, 0, 1]], float) if side == 'right' \
            else np.array([[0, 1, 0], [-1, 0, 0], [0, 0, 1]], float)

        def palm_to_hand(p):
            return S @ (p - c0s)
        # raw palm file (right coordinates) -> hand: p_h = S (mir p + shift - c0s)
        Mpalm = np.eye(4)
        Mpalm[:3, :3] = S @ mir
        Mpalm[:3, 3] = S @ (shift - c0s)
        entry = {'palm': {'matrix': Mpalm.ravel().tolist()}, 'fingers': {}}
        for f in FINGERS:
            T_prox, T_dist = parts[f]
            A, B = finger_proximal(T_prox)
            Bd, C = finger_distal(T_dist)
            Pp = to_left(pin[f])
            # proximal raw -> palm -> hand: p_h = S (Rf (p - A) + Pp - c0s)
            Mp = np.eye(4)
            Mp[:3, :3] = S @ Rf
            Mp[:3, 3] = S @ (Pp - c0s - Rf @ A)
            # distal raw -> proximal raw: Rx(phi0) (p - Bd) + B   then the same as above
            Rx = rotx(PHI0)
            Md_in = np.eye(4)
            Md_in[:3, :3] = Rx
            Md_in[:3, 3] = B - Rx @ Bd
            Md = Mp @ Md_in
            pivA = (Mp @ np.append(A, 1))[:3]
            pivB = (Mp @ np.append(B, 1))[:3]
            entry['fingers'][f] = {
                'prox': {'file': 'finger_%s_prox.stl' % f, 'matrix': Mp.ravel().tolist(), 'pivot': pivA.tolist()},
                'dist': {'file': 'finger_%s_dist.stl' % f, 'matrix': Md.ravel().tolist(), 'pivot': pivB.tolist()},
                'linkPin': (Md @ np.append(C, 1))[:3].tolist()
            }
        # thumb: proximal bone on the palm's wide bore, distal bone flipped onto its far end
        A, B, Bd = thumb_pins(thumb_p[1], thumb_d[1])
        D = np.diag([-1.0, 1, 1])
        R0 = np.array([[0, -1, 0], [-1, 0, 0], [0, 0, -1]], float)
        Rt = roty(THUMB_PSI0) @ R0                     # raw bone -> right palm frame
        Rt_side = Rt if side == 'right' else D @ Rt @ D
        Pb = to_left(boss_pin)
        Mt = np.eye(4)
        Mt[:3, :3] = S @ Rt_side
        Mt[:3, 3] = S @ (Pb - c0s - Rt_side @ A)
        Rc = np.diag([1.0, -1, -1])
        Mt_in = np.eye(4)
        Mt_in[:3, :3] = Rc
        Mt_in[:3, 3] = B - Rc @ Bd
        Mtd = Mt @ Mt_in
        entry['thumb'] = {
            'prox': {'file': 'thumb_prox.stl', 'matrix': Mt.ravel().tolist(), 'pivot': (Mt @ np.append(A, 1))[:3].tolist()},
            'dist': {'file': 'thumb_dist.stl', 'matrix': Mtd.ravel().tolist(), 'pivot': (Mt @ np.append(B, 1))[:3].tolist()}
        }
        # wrist opening outline in the hand frame (x_h, z_h), convex hull
        H = np.array([palm_to_hand(to_left(p)) for p in rim])[:, [0, 2]]
        from scipy.spatial import ConvexHull
        hull = H[ConvexHull(H).vertices]
        entry['rimHull'] = np.round(hull, 2).tolist()
        entry['palmLength'] = float(-(S @ (to_left(np.array([0, 0, V[:, 2].max()])) - c0s))[1])
        rig['sides'][side] = entry
    # mm the palm reaches beyond the wrist opening along -y, and the longest finger tip
    rig['stats'] = {'palmHeight': float(V[:, 2].max() - zmin)}
    json.dump(rig, open(os.path.join(OUT, 'hand-rig.json'), 'w'), indent=1)
    print('wrote', os.path.abspath(OUT))


if __name__ == '__main__':
    main()
