// Trace a photo's reader (screen marks). Give it the photo's pixels and the two ends of a marked line;
// it samples along the line, finds the runs, sorts them into 0 / 1 / start, and votes over copies.
(function (G) {
  const M = G.BQMarks;
  const N = M.NBITS;
  function lumAt(img, x, y) {
    const { data, width, height } = img;
    if (x < 0 || y < 0 || x > width - 1.001 || y > height - 1.001) return NaN;
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const L = (xx, yy) => { const i = (yy * width + xx) * 4; return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; };
    return (L(x0, y0) * (1 - fx) + L(x0 + 1, y0) * fx) * (1 - fy) + (L(x0, y0 + 1) * (1 - fx) + L(x0 + 1, y0 + 1) * fx) * fy;
  }
  const median = (a) => { const s = Float64Array.from(a.filter((v) => !Number.isNaN(v))).sort(); return s.length ? s[s.length >> 1] : NaN; };
  function gauss(a, sigma) {
    if (sigma <= 0) return Float64Array.from(a);
    const r = Math.ceil(sigma * 3), k = [];
    for (let i = -r; i <= r; i++) k.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
    const out = new Float64Array(a.length);
    for (let t = 0; t < a.length; t++) {
      let s = 0, w = 0;
      for (let i = -r; i <= r; i++) { const j = t + i; if (j >= 0 && j < a.length) { s += a[j] * k[i + r]; w += k[i + r]; } }
      out[t] = s / w;
    }
    return out;
  }
  // sample a strip along p1->p2, W rows either side
  function strip(img, p1, p2, W) {
    const dx = p2.x - p1.x, dy = p2.y - p1.y, L = Math.hypot(dx, dy);
    const n = Math.max(2, Math.round(L)), ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
    const rows = [];
    for (let k = -W; k <= W; k++) {
      const r = new Float64Array(n);
      for (let t = 0; t < n; t++) r[t] = lumAt(img, p1.x + ux * t * (L / n) + nx * k, p1.y + uy * t * (L / n) + ny * k);
      rows.push(r);
    }
    return { rows, n, W };
  }
  // follow the line inside the strip: the row that differs most from the background, chunk by chunk
  function profileOf(S) {
    const { rows, n, W } = S;
    // per chunk: the row that differs most from that chunk's background (to a fraction of a row)
    const C = 32, pts = [];
    for (let c0 = 0; c0 + 8 <= n; c0 += C) {
      const meds = rows.map((r) => median(Array.from(r.subarray(c0, Math.min(n, c0 + C)))));
      const bg = median(meds);
      let bk = 0, bv = -1;
      const dv = meds.map((m) => Math.abs(m - bg));
      dv.forEach((d, k) => { if (d > bv) { bv = d; bk = k; } });
      let kf = bk;
      if (bk > 0 && bk < dv.length - 1) { const a = dv[bk - 1], b = dv[bk + 1], den = a - 2 * bv + b; if (den < 0) kf = bk + Math.max(-0.5, Math.min(0.5, (a - b) / (2 * den))); }
      pts.push({ t: c0 + C / 2, k: kf, v: bv, bg });
    }
    // a smooth curve through the strong chunks (lenses bend long lines a few pixels), refit without outliers
    const vmed = median(pts.map((p) => p.v));
    let use = pts.filter((p) => p.v >= vmed * 0.5), co = [W, 0, 0];
    const tn = (t) => t / n - 0.5;
    for (let it = 0; it < 4 && use.length >= 2; it++) {
      const m = use.length >= 6 ? 3 : 2, A = Array.from({ length: m }, () => new Float64Array(m + 1));
      for (const p of use) { const x = tn(p.t), v = [1, x, x * x].slice(0, m); for (let i = 0; i < m; i++) { for (let j = 0; j < m; j++) A[i][j] += v[i] * v[j]; A[i][m] += v[i] * p.k; } }
      let okA = true;
      for (let c = 0; c < m; c++) { let pv = c; for (let r2 = c + 1; r2 < m; r2++) if (Math.abs(A[r2][c]) > Math.abs(A[pv][c])) pv = r2; [A[c], A[pv]] = [A[pv], A[c]]; if (!A[c][c]) { okA = false; break; } for (let r2 = 0; r2 < m; r2++) if (r2 !== c) { const f = A[r2][c] / A[c][c]; for (let j = c; j <= m; j++) A[r2][j] -= f * A[c][j]; } }
      if (!okA) break;
      co = [0, 0, 0]; for (let i = 0; i < m; i++) co[i] = A[i][m] / A[i][i];
      const fitAt = (t) => co[0] + co[1] * tn(t) + co[2] * tn(t) ** 2;
      const keep = use.filter((p) => Math.abs(p.k - fitAt(p.t)) <= 2);
      if (keep.length === use.length || keep.length < 3) break;
      use = keep;
    }
    const al = co[0], be = co[1];
    const centers = new Float64Array(n);
    for (let t = 0; t < n; t++) centers[t] = Math.max(1, Math.min(2 * W - 1, co[0] + co[1] * tn(t) + co[2] * tn(t) ** 2));
    // thickness and contrast from rows lined up on the fit
    const bg = median(pts.map((p) => p.bg)), prof = [];
    for (let j = -4; j <= 4; j++) {
      const vals = []; for (let t = 0; t < n; t += 3) { const k = Math.round(centers[t]) + j; if (k >= 0 && k <= 2 * W) vals.push(rows[k][t]); }
      prof.push(Math.abs(median(vals) - bg));
    }
    const peak = Math.max(...prof); let thick = 0; prof.forEach((d) => { if (d > peak * 0.5) thick++; });
    const half = Math.max(1, Math.min(3, Math.round((thick - 1) / 2)));
    // the line minus the background right beside it: moire and uneven light hit both, the marks only the line
    const at = (k, t) => { const k0i = Math.floor(k), f = k - k0i; if (k0i < 0 || k0i + 1 > 2 * W) return NaN; return rows[k0i][t] * (1 - f) + rows[k0i + 1][t] * f; };
    const gap = half + 2.5, P = new Float64Array(n);
    for (let t = 0; t < n; t++) {
      const c = centers[t]; let s = 0, w = 0, bs = 0, bw = 0;
      for (let j = -half; j <= half; j++) { const v = at(c + j, t); if (!Number.isNaN(v)) { s += v; w++; } }
      for (const j of [-gap, -gap - 1, gap, gap + 1]) { const v = at(c + j, t); if (!Number.isNaN(v)) { bs += v; bw++; } }
      P[t] = w ? s / w - (bw ? bs / bw : 0) : NaN;
    }
    for (let t = 0; t < n; t++) if (Number.isNaN(P[t])) P[t] = t ? P[t - 1] : 0;
    return { P, contrast: peak, thick, fit: { al, be, n: use.length, of: pts.length, ks: pts.map((p) => p.k).join(',') } };
  }
  function boxMean(a, w) {
    const n = a.length, out = new Float64Array(n), c = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) c[i + 1] = c[i] + a[i];
    const h = Math.max(1, Math.floor(w / 2));
    for (let i = 0; i < n; i++) { const lo = Math.max(0, i - h), hi = Math.min(n, i + h + 1); out[i] = (c[hi] - c[lo]) / (hi - lo); }
    return out;
  }
  const HALVES = M.HALVES, K = 4; // bins per half cell when folding
  // fold the signal onto one copy: phase of x is (w(x) mod T) / T, with w(x) = x / (1 + c x) for perspective
  function fold(hp, T, c) {
    const nb = HALVES * K, sum = new Float64Array(nb), cnt = new Float64Array(nb);
    for (let x = 0; x < hp.length; x++) {
      const w = x / (1 + c * x), ph = ((w % T) + T) % T;
      const b = Math.min(nb - 1, Math.floor((ph / T) * nb));
      sum[b] += hp[x]; cnt[b]++;
    }
    let e = 0;
    for (let b = 0; b < nb; b++) { if (cnt[b]) { sum[b] /= cnt[b]; e += cnt[b] * sum[b] * sum[b]; } }
    return { F: sum, cnt, e };
  }
  function foldPhase(hp, phi) {
    const nb = HALVES * K, sum = new Float64Array(nb), cnt = new Float64Array(nb);
    for (let x = 0; x < hp.length; x++) { const f = phi(x), b = Math.min(nb - 1, Math.floor((f - Math.floor(f)) * nb)); sum[b] += hp[x]; cnt[b]++; }
    for (let b = 0; b < nb; b++) if (cnt[b]) sum[b] /= cnt[b];
    return sum;
  }
  // line each copy up against the folded average, then smooth the shifts (perspective, lens) and refold
  function refine(hp, phi0) {
    const n = hp.length, nb = HALVES * K;
    let phi = phi0;
    for (let it = 0; it < 3; it++) {
      const F = foldPhase(hp, phi), tv = (f) => F[Math.min(nb - 1, Math.floor((f - Math.floor(f)) * nb))];
      const ph = Float64Array.from({ length: n }, (_, x) => phi(x));
      const k0 = Math.floor(Math.min(ph[0], ph[n - 1])), k1 = Math.ceil(Math.max(ph[0], ph[n - 1]));
      const pts = [];
      for (let k = k0; k < k1; k++) {
        const xs = []; for (let x = 0; x < n; x++) if (ph[x] >= k && ph[x] < k + 1) xs.push(x);
        if (xs.length < 0.4 * (n / Math.abs(ph[n - 1] - ph[0]))) continue;
        let bd = 0, bc = -Infinity;
        for (let d = -0.06; d <= 0.0601; d += 0.002) { let c = 0; for (const x of xs) c += hp[x] * tv(ph[x] + d); if (c > bc) { bc = c; bd = d; } }
        pts.push({ k: k + 0.5, d: bd, w: Math.max(0, bc) * xs.length });
      }
      if (pts.length < 2) break;
      // weighted quadratic fit of shift vs copy index (straight line if only 2 copies)
      const deg = pts.length >= 4 ? 2 : 1, m = deg + 1, A = Array.from({ length: m }, () => new Float64Array(m + 1));
      for (const p of pts) { const v = [1, p.k, p.k * p.k].slice(0, m); for (let i = 0; i < m; i++) { for (let j = 0; j < m; j++) A[i][j] += p.w * v[i] * v[j]; A[i][m] += p.w * v[i] * p.d; } }
      for (let c = 0; c < m; c++) { let pv = c; for (let r2 = c + 1; r2 < m; r2++) if (Math.abs(A[r2][c]) > Math.abs(A[pv][c])) pv = r2; [A[c], A[pv]] = [A[pv], A[c]]; if (!A[c][c]) return phi; for (let r2 = 0; r2 < m; r2++) if (r2 !== c) { const f = A[r2][c] / A[c][c]; for (let j = c; j <= m; j++) A[r2][j] -= f * A[c][j]; } }
      const co = Array.from({ length: m }, (_, i) => A[i][m] / A[i][i]);
      const prev = phi;
      phi = (x) => { const f = prev(x); return f + co[0] + (m > 1 ? co[1] * f : 0) + (m > 2 ? co[2] * f * f : 0); };
    }
    return phi;
  }
  function decodeLine(img, p1, p2, opt = {}) {
    const S = strip(img, p1, p2, opt.band || 16);
    const { P: P0, contrast, thick, fit } = profileOf(S);
    // keep only the stretch where the line is really there (a found line can run off the screen)
    const lev = boxMean(P0, 31), al = Array.from(lev, Math.abs).sort((x, y) => x - y), ref = al[Math.floor(al.length * 0.9)] || 0;
    let run = null, st0 = -1, gapc = 0, lastOn = -1;
    for (let i = 0; i <= P0.length; i++) {
      const on = i < P0.length && Math.abs(lev[i]) >= 0.4 * ref;
      if (on) { if (st0 < 0) st0 = i; lastOn = i; gapc = 0; }
      else if (st0 >= 0 && (++gapc > 12 || i === P0.length)) { if (!run || lastOn - st0 > run[1] - run[0]) run = [st0, lastOn]; st0 = -1; gapc = 0; }
    }
    if (!run || run[1] - run[0] < 60) return { ok: false, why: 'no line', contrast };
    const P = P0.subarray(run[0], run[1] + 1), n = P.length;
    const at = (t) => ({ x: p1.x + (p2.x - p1.x) * t / S.n, y: p1.y + (p2.y - p1.y) * t / S.n }), ends = [at(run[0]), at(run[1])];
    const base = boxMean(P, Math.max(31, n / 8));
    const hp = new Float64Array(n); let tot = 0;
    for (let i = 0; i < n; i++) hp[i] = P[i] - base[i];
    // clip outliers (glare, a stray mark) at 4x the typical size
    const mad = Array.from(hp, Math.abs).sort((x, y) => x - y)[n >> 1] || 1;
    for (let i = 0; i < n; i++) { if (hp[i] > 6 * mad) hp[i] = 6 * mad; else if (hp[i] < -6 * mad) hp[i] = -6 * mad; tot += hp[i] * hp[i]; }
    if (!tot) return { ok: false, why: 'flat', contrast };
    // the whole pattern repeats every copy, whatever the code: find that period
    // opt.T0: the period to look near (the size another line of the same screen read), opt.span either way
    const Lmin = Math.round(HALVES * 1.2), Lmax = Math.floor(n / 2);
    const lo = opt.T0 ? Math.max(Lmin, Math.round(opt.T0 * (1 - opt.span))) : Lmin, hi = opt.T0 ? Math.min(Lmax, Math.round(opt.T0 * (1 + opt.span))) : Lmax;
    if (hi <= lo) return { ok: false, why: 'too short', contrast };
    const r = new Float64Array(Lmax + 1);
    for (let L = lo; L <= hi; L++) {
      let s = 0, a = 0, b = 0;
      for (let x = 0; x + L < n; x++) { s += hp[x] * hp[x + L]; a += hp[x] * hp[x]; b += hp[x + L] * hp[x + L]; }
      r[L] = s / Math.sqrt(a * b || 1);
    }
    const peaks = [];
    for (let L = lo + 1; L < hi; L++) if (r[L] > 0 && r[L] >= r[L - 1] && r[L] >= r[L + 1]) peaks.push(L);
    peaks.sort((x, y) => r[y] - r[x]);
    const nb = HALVES * K;
    const hmA = new Float64Array(nb), idx = new Int32Array(70);
    function readFold(F) {
      for (let b = 0; b < nb; b++) { let s = 0; for (let j = 1; j < K - 1; j++) s += F[(b + j) % nb]; hmA[b] = s / (K - 2); }
      let best = -Infinity, bb = 0, bd = 1;
      for (let b = 0; b < nb; b++) for (let dir = 1; dir >= -1; dir -= 2) {
        for (let i = 0; i < 70; i++) { let t = dir === 1 ? b + i * K : b - (i + 1) * K; t %= nb; if (t < 0) t += nb; idx[i] = t; }
        let sc = hmA[idx[0]] + hmA[idx[1]] + hmA[idx[2]] - hmA[idx[3]] - hmA[idx[4]] - hmA[idx[5]], pair = 0;
        for (let i = 6; i < 70; i += 2) { const h1 = hmA[idx[i]], h2 = hmA[idx[i + 1]], d = h1 - h2, e = h1 + h2; pair += (d < 0 ? -d : d) - (e < 0 ? -e : e); }
        sc += pair / 4;
        if (sc > best) { best = sc; bb = b; bd = dir; }
      }
      const H = (i) => { let t = bd === 1 ? bb + i * K : bb - (i + 1) * K; t %= nb; if (t < 0) t += nb; return hmA[t]; };
      let sync = 0; for (let i = 0; i < 6; i++) sync += (i < 3 ? 1 : -1) * H(i);
      const soft = []; for (let i = 0; i < 32; i++) soft.push(H(6 + 2 * i) - H(7 + 2 * i));
      let rms = 0; for (let b = 0; b < nb; b++) rms += F[b] * F[b]; rms = Math.sqrt(rms / nb) || 1;
      return { score: best, sync, soft, b: bb, dir: bd, q: best / (rms * 14) };
    }
    // scan every plausible period (and a little perspective) by how well the fold reads as a code;
    // autocorrelation peaks join the shortlist, then each gets a finer local search
    const scan = [];
    for (let T = lo; T <= hi; T *= opt.T0 ? 1.004 : 1.015) for (const cc of [-0.1, 0, 0.1]) { const pk = readFold(fold(hp, T, cc / n).F); scan.push({ T, c: cc / n, q: pk.q }); }
    scan.sort((x, y) => y.q - x.q);
    const short = [];
    for (const s1 of scan) { if (short.length >= (opt.cands0 || 6)) break; if (!short.some((t) => Math.abs(t.T / s1.T - 1) < 0.03)) short.push(s1); }
    for (const L of peaks.slice(0, 3)) if (!short.some((t) => Math.abs(t.T / L - 1) < 0.03)) short.push({ T: L, c: 0 });
    const cands = [];
    const evalAt = (T, c, L0) => { const F = fold(hp, T, c).F; return { F, T, c, pick: readFold(F), L0 }; };
    for (const st of short) {
      let cb = evalAt(st.T, st.c, Math.round(st.T));
      for (let round = 0; round < 2; round++) {
        for (let ti = -8; ti <= 8; ti++) if (ti) { const e = evalAt(cb.T * (1 + ti * 0.0025), cb.c, cb.L0); if (e.pick.q > cb.pick.q) cb = e; }
        for (let ci = -3; ci <= 3; ci++) if (ci) { const e = evalAt(cb.T, cb.c + (ci * 0.04) / n, cb.L0); if (e.pick.q > cb.pick.q) cb = e; }
      }
      cands.push(cb);
      if (opt.quick && cb.pick.q < 0.95) break;
    }
    cands.sort((x, y) => y.pick.q - x.pick.q);
    let best = null;
    for (const cb of cands.slice(0, opt.refineTop || 3)) {
      const phi = refine(hp, ((T, c) => (x) => (x / (1 + c * x)) / T)(cb.T, cb.c));
      const F = foldPhase(hp, phi), pk = readFold(F);
      const rb = pk.q > cb.pick.q ? { ...cb, F, pick: pk, phi, T: (n - 1) / Math.abs(phi(n - 1) - phi(0)), refined: true } : cb;
      if (!best || rb.pick.q > best.pick.q) best = rb;
    }
    // drop stretches that don't carry the pattern (a found line can run on past the marked part), then refold
    {
      const phi = best.phi || ((T, c) => (x) => (x / (1 + c * x)) / T)(best.T, best.c);
      const tv = (f) => best.F[Math.min(nb - 1, Math.floor((f - Math.floor(f)) * nb))];
      const win = Math.max(40, Math.round(best.T / 2)), score = [];
      for (let x0 = 0; x0 < n; x0 += win) { let s1 = 0, e = 0; for (let x = x0; x < Math.min(n, x0 + win); x++) { s1 += hp[x] * tv(phi(x)); e += hp[x] * hp[x]; } score.push(e ? s1 / Math.sqrt(e) : 0); }
      const med = median(score);
      if (med > 0 && score.some((v) => v < 0.25 * med)) {
        const hp2 = Float64Array.from(hp, (v, x) => (score[Math.floor(x / win)] < 0.25 * med ? 0 : v));
        const F2 = foldPhase(hp2, phi), pk2 = readFold(F2);
        if (pk2.q > best.pick.q) best = { ...best, F: F2, pick: pk2, trimmed: true };
      }
    }
    const { F, T, c, pick } = best;
    const soft = pick.soft, sbest = pick.sync, sdir = pick.dir, s0 = pick.b;
    const mag = soft.reduce((a, v) => a + Math.abs(v), 0) / 32 || 1;
    const norm = soft.map((v) => v / mag);
    const bits = norm.map((v) => (v > 0 ? 1 : 0)), code = M.bitsCode(bits);
    const syncQ = sbest / 6 / (mag / 2 || 1);
    const out = { ok: true, ends, soft: norm, code, copies: n / T, T, half: T / HALVES, c, dir: sdir, syncQ, q: pick.q, period: r[best.L0] || 0, contrast, thick, fold: best.e / tot, scan: opt.T0 ? null : scan };
    return out;
  }
  // several lines -> one answer, plus the nearest of the teacher's codes
  // several lines -> one answer. A code counts when two lines agree on it with the check passing
  // (or one line reads very clean); class codes are ranked by how well each line agrees with them.
  const mid = (l) => ({ x: (l.ends[0].x + l.ends[1].x) / 2, y: (l.ends[0].y + l.ends[1].y) / 2 });
  // two reads of one line (found twice, a few pixels apart) are one line, not two that agree
  function same(a, b) {
    const [p, q] = a.ends, m = mid(b), L = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    return Math.abs((q.x - p.x) * (p.y - m.y) - (p.x - m.x) * (q.y - p.y)) / L < 8;
  }
  const distinct = (ls) => ls.reduce((acc, l) => (acc.some((x) => same(x, l)) ? acc : acc.concat([l])), []);
  // how many of a line's 32 bits differ from a code's
  const misses = (l, b) => { let k = 0; for (let i = 0; i < 32; i++) if ((l.soft[i] > 0) !== !!b[i]) k++; return k; };
  function combine(lines, codes) {
    const good = lines.filter((l) => l && l.ok);
    const groups = new Map();
    for (const l of good) if (l.code.ok) { const g = groups.get(l.code.code) || { code: l.code.code, ls: [] }; g.ls.push(l); groups.set(l.code.code, g); }
    // given the teacher's codes, only one of them is a read: lines that misread one pattern alike can agree
    const known = (cd) => !codes || !codes.length || codes.includes(cd);
    const gs = [...groups.values()].filter((g) => known(g.code)).map((g) => ({ ...g, n: g.ls.length, q: g.ls.reduce((a, l) => a + l.q, 0) })).sort((x, y) => y.n - x.n || y.q - x.q);
    const corr = (l, b) => { let sc = 0, t = 0; for (let i = 0; i < 32; i++) { sc += (b[i] ? 1 : -1) * l.soft[i]; t += Math.abs(l.soft[i]); } return t ? sc / t : 0; };
    // a line that read a near miss of the winning code backs it up (random lines sit near 0)
    for (const g of gs) { const b = M.codeBits(g.code); g.back = good.filter((l) => !g.ls.includes(l) && corr(l, b) >= 0.55); g.n = distinct(g.ls.concat(g.back)).length; }
    gs.sort((x, y) => y.n - x.n || y.q - x.q);
    let read = null, sure = false, agree = gs.length ? gs[0].n : 0;
    if (gs.length && (gs[0].n >= 2 || gs[0].q >= 1.3)) { read = gs[0].code; sure = gs[0].n >= 2; }
    let use = read ? gs[0].ls.concat(gs[0].back) : good.filter((l) => l.q > 1.05);
    // or two lines that each read one of the teacher's codes to within 3 bits (by chance: about 1 in 10 million)
    if (!sure && codes && codes.length) {
      for (const cd of codes) {
        const b = M.codeBits(cd), ls = distinct(good.filter((l) => misses(l, b) <= 3));
        if (ls.length >= 2 && ls.length > (sure ? agree : 1)) { read = cd; sure = true; agree = ls.length; use = ls; }
      }
    }
    const sum = new Float64Array(32);
    for (const l of use) { const w = Math.sqrt(Math.max(1, l.copies)) * (l.code.ok ? 3 : 1); l.soft.forEach((v, i) => { sum[i] += v * w; }); }
    if (!read && use.length) { const r = M.bitsCode(Array.from(sum, (v) => (v > 0 ? 1 : 0))); if (r.ok && known(r.code)) read = r.code; }
    let ranked = [];
    if (codes && codes.length && good.length) {
      const by = use.length ? use : good;
      ranked = codes.map((cd) => { const b = M.codeBits(cd), cs = by.map((l) => corr(l, b)); return { code: cd, score: Math.max(...cs), s2: cs.reduce((a, c) => a + Math.max(0, c) ** 2, 0) }; })
        .sort((x, y) => y.s2 - x.s2).slice(0, 3);
    }
    return { code: read, sure, agree, used: use, ranked, lines: good.length };
  }
  // The stripe sizes the lines read, likeliest first: lines that read within 7% of each other are one size,
  // weighed by how cleanly each read (a line whose check passes counts three times).
  function sizes(reads) {
    const groups = [];
    for (const d of reads) {
      if (!d.ok) continue;
      const w = d.q * (d.code.ok ? 3 : 1), g = groups.find((x) => Math.abs(d.half / x.half - 1) < 0.07);
      if (g) { g.half = (g.half * g.w + d.half * w) / (g.w + w); g.w += w; } else groups.push({ half: d.half, w });
    }
    return groups.sort((a, b) => b.w - a.w).map((g) => g.half);
  }
  // How good a combined read is: two lines agreeing on one of the teacher's codes, then one of their codes,
  // then how far the likeliest student leads the next, but only for a close match (0.9 and up): reading every
  // line again at several sizes makes many reads, and some come near a code by chance.
  function rank(r, codes) {
    const mine = !!r.code && codes.includes(r.code), a = r.ranked[0], b = r.ranked[1];
    return (r.sure && mine ? 4 : mine ? 3 : 0) + (a && a.score >= 0.9 ? Math.max(0, Math.min(0.99, a.score - (b ? b.score : 0))) : 0);
  }
  // A whole photo: find its long lines and read them one by one, stopping once two agree. Every line on one
  // screen has the same stripe size, give or take the photo's perspective, so when they don't agree, read
  // every line again near each size the lines read, likeliest first, and keep the best. progress(done, of).
  // The sizes all the lines' scans agree on: each line's scan of every period, as how far each period
  // stands out of that line's own run of scores, pooled over the lines (allowing 4% either way, as the
  // photo's perspective makes lines nearer the camera a little bigger), and its strongest peaks.
  function pooled(reads) {
    const scans = reads.filter((d) => d.ok && d.scan).map((d) => {
      const qs = d.scan.map((x) => x.q).sort((a, b) => a - b), med = qs[qs.length >> 1], mad = qs.map((v) => Math.abs(v - med)).sort((a, b) => a - b)[qs.length >> 1] || 1e-6;
      return d.scan.map((x) => ({ T: x.T, z: Math.max(0, Math.min(6, (x.q - med) / (1.4826 * mad))) }));
    });
    if (!scans.length) return [];
    const T0 = Math.min(...scans.map((sc) => sc[0].T)), T1 = Math.max(...scans.map((sc) => sc[sc.length - 1].T)), grid = [];
    for (let T = T0; T <= T1; T *= 1.01) {
      let sum = 0;
      for (const sc of scans) { let m = 0; for (const x of sc) if (x.T >= T * 0.96 && x.T <= T * 1.04 && x.z > m) m = x.z; sum += m; }
      grid.push({ T, sum });
    }
    const peaks = grid.filter((g, i) => (!i || g.sum >= grid[i - 1].sum) && (i === grid.length - 1 || g.sum >= grid[i + 1].sum)).sort((a, b) => b.sum - a.sum), out = [];
    for (const p of peaks) if (!out.some((T) => Math.abs(p.T / T - 1) < 0.08)) out.push(p.T);
    return out.map((T) => T / HALVES);
  }
  function readPhoto(img, codes, progress) {
    const found = G.BQFind.findLines(img).slice(0, 8);
    const read = (f, opt) => { try { return { ...decodeLine(img, f.p1, f.p2, opt), at: f }; } catch (err) { return { ok: false, why: 'error', at: f }; } };
    const reads = [];
    for (let i = 0; i < found.length; i++) {
      if (combine(reads, codes).sure) break;
      if (progress) progress(i, found.length * 2);
      reads.push(read(found[i]));
    }
    let best = { ...combine(reads, codes), reads };
    if (best.sure) return best;
    // a size a line's check passed at first, then where the scans agree, then the sizes lines read most
    const tries = [];
    for (const h of reads.filter((d) => d.ok && d.code.ok).map((d) => d.half).concat(pooled(reads).slice(0, 3), sizes(reads).slice(0, 2))) {
      if (tries.length < 4 && !tries.some((t) => Math.abs(h / t - 1) < 0.05)) tries.push(h);
    }
    for (let k = 0; k < tries.length; k++) {
      if (progress) progress(reads.length + Math.round((k * reads.length) / tries.length), reads.length * 2);
      const again = reads.map((d) => (d.why === 'no line' ? d : read(d.at, { T0: tries[k] * HALVES, span: 0.1 })));
      const r = { ...combine(again, codes), reads: again, half: tries[k] };
      if (rank(r, codes) > rank(best, codes)) best = r;
      if (best.sure && best.code && codes.includes(best.code)) break;
    }
    return best;
  }
  G.BQReader = { decodeLine, combine, readPhoto, lumAt };
})(typeof window !== 'undefined' ? window : globalThis);
