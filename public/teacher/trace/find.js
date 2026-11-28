// Find long, nearly level thin lines in a photo (Hough over a thin-line response), with their ends.
(function (G) {
  function findLines(img, opt = {}) {
    const { data, width: W0, height: H0 } = img;
    const f = Math.min(1, (opt.detect || 1200) / Math.max(W0, H0));
    const W = Math.round(W0 * f), H = Math.round(H0 * f);
    // grey, downscaled by box averaging
    const g = new Float32Array(W * H), cnt = new Float32Array(W * H);
    for (let y = 0; y < H0; y++) { const yy = Math.min(H - 1, Math.floor(y * f)); for (let x = 0; x < W0; x++) { const i = (y * W0 + x) * 4, j = yy * W + Math.min(W - 1, Math.floor(x * f)); g[j] += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; cnt[j]++; } }
    for (let j = 0; j < g.length; j++) g[j] /= cnt[j] || 1;
    // thin-line response: how much a pixel differs from the pixels 2 above and 2 below (either way)
    const R = new Float32Array(W * H);
    for (let y = 2; y < H - 2; y++) for (let x = 1; x < W - 1; x++) {
      const c = (g[y * W + x - 1] + 2 * g[y * W + x] + g[y * W + x + 1]) / 4;
      const a = (g[(y - 2) * W + x - 1] + 2 * g[(y - 2) * W + x] + g[(y - 2) * W + x + 1]) / 4;
      const b = (g[(y + 2) * W + x - 1] + 2 * g[(y + 2) * W + x] + g[(y + 2) * W + x + 1]) / 4;
      const d = c - (a + b) / 2;
      // a line, not an edge: both sides agree with each other more than with the centre
      R[y * W + x] = Math.abs(d) > Math.abs(a - b) ? Math.abs(d) - Math.abs(a - b) / 2 : 0;
    }
    const sample = []; for (let j = 0; j < R.length; j += 7) if (R[j] > 0) sample.push(R[j]);
    sample.sort((p, q) => p - q);
    const thr = Math.max(2, sample[Math.floor(sample.length * 0.85)] || 2);
    // Hough over angles within +-20 degrees of level
    const A = [], amax = opt.angle || 20, astep = 0.25;
    for (let a = -amax; a <= amax + 1e-9; a += astep) A.push((a * Math.PI) / 180);
    const off = Math.ceil(W * Math.tan((amax * Math.PI) / 180)) + 2, NR = H + 2 * off;
    const acc = new Float32Array(A.length * NR), sn = A.map(Math.sin), cs = A.map(Math.cos);
    for (let y = 2; y < H - 2; y++) for (let x = 1; x < W - 1; x++) {
      const v = R[y * W + x]; if (v < thr) continue;
      for (let k = 0; k < A.length; k++) { const r = Math.round(y * cs[k] - x * sn[k]) + off; acc[k * NR + r] += Math.min(v, thr * 4); }
    }
    // strongest peaks, each suppressing its neighbourhood
    const peaks = [], used = new Uint8Array(acc.length), want = opt.max || 14;
    const order = Array.from(acc.keys()).filter((i) => acc[i] > 0).sort((p, q) => acc[q] - acc[p]);
    for (const i of order) {
      if (peaks.length >= want) break;
      if (used[i]) continue;
      const k = Math.floor(i / NR), r = (i % NR) - off;
      peaks.push({ k, r, v: acc[i] });
      for (let dk = -8; dk <= 8; dk++) for (let dr = -3; dr <= 3; dr++) { const kk = k + dk, rr = r + dr + off; if (kk >= 0 && kk < A.length && rr >= 0 && rr < NR) used[kk * NR + rr] = 1; }
    }
    // each peak's extent: the longest stretch where the line response is there
    const out = [];
    for (const p of peaks) {
      const s = sn[p.k], c = cs[p.k], on = [];
      for (let x = 0; x < W; x++) {
        const y = (p.r + x * s) / c; const yi = Math.round(y);
        let m = 0; for (let dy = -2; dy <= 2; dy++) { const yy = yi + dy; if (yy >= 2 && yy < H - 2) m = Math.max(m, R[yy * W + x]); }
        on.push(m >= thr * 0.6 ? 1 : 0);
      }
      let best = null, start = -1, gap = 0, last = -1;
      const gapMax = Math.round(W * 0.02);
      for (let x = 0; x <= W; x++) {
        if (x < W && on[x]) { if (start < 0) start = x; last = x; gap = 0; }
        else if (start >= 0 && ++gap > gapMax || (x === W && start >= 0)) { const len = last - start; if (!best || len > best.len) best = { a: start, b: last, len }; start = -1; gap = 0; }
      }
      if (!best || best.len < W * 0.15) continue;
      const P = (x) => ({ x: x / f, y: ((p.r + x * s) / c) / f });
      out.push({ p1: P(best.a + 2), p2: P(best.b - 2), len: best.len / f, v: p.v });
    }
    // drop near-duplicates (the same line found at two angles): keep the longer
    out.sort((p, q) => q.len - p.len);
    const keep = [];
    const yAt = (l, x) => l.p1.y + (l.p2.y - l.p1.y) * (x - l.p1.x) / ((l.p2.x - l.p1.x) || 1);
    for (const l of out) {
      const dup = keep.some((k) => { const lo = Math.max(l.p1.x, k.p1.x), hi = Math.min(l.p2.x, k.p2.x); if (hi <= lo) return false; return Math.abs(yAt(l, lo) - yAt(k, lo)) < 8 / f && Math.abs(yAt(l, hi) - yAt(k, hi)) < 8 / f; });
      if (!dup) keep.push(l);
    }
    return keep;
  }
  G.BQFind = { findLines };
})(typeof window !== 'undefined' ? window : globalThis);
