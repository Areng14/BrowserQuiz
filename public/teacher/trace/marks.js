// Screen marks: a 5-character code in a line as two near-equal tones (A lighter, B darker). The student app
// paints them (student/app/screenmark.js); this is the same encoding, for the reader.
// Each bit is a light-dark pair (1 = A then B, 0 = B then A). A copy starts with a sync of
// 3 halves A then 3 halves B, which no bit pair can make. 25 data bits + 7 check bits.
(function (G) {
  const ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford: no I L O U
  const NBITS = 32, SYNC = [1, 1, 1, -1, -1, -1], HALVES = SYNC.length + 2 * 32; // 70 halves per copy
  // fixed whitening so no code is a long repeat (that would fool the period search)
  const MASK = [1,0,1,1,0,0,1,0, 0,1,1,1,0,1,0,0, 1,1,0,1,0,0,0,1, 0,1,0,1,1,0,1,0];
  function crc7(bits) { // x^7 + x^3 + 1
    let r = 0;
    for (const b of bits) { const top = ((r >> 6) & 1) ^ b; r = (r << 1) & 0x7f; if (top) r ^= 0x09; }
    return Array.from({ length: 7 }, (_, i) => (r >> (6 - i)) & 1);
  }
  function codeBits(code) {
    code = String(code).toUpperCase();
    if (code.length !== 5) throw new Error('code must be 5 chars');
    const data = [];
    for (const ch of code) {
      const v = ALPHA.indexOf(ch);
      if (v < 0) throw new Error('bad char ' + ch);
      for (let i = 4; i >= 0; i--) data.push((v >> i) & 1);
    }
    return data.concat(crc7(data)).map((b, i) => b ^ MASK[i]);
  }
  function bitsCode(bits) {
    bits = bits.map((b, i) => b ^ MASK[i]);
    const data = bits.slice(0, 25), ok = crc7(data).every((b, i) => b === bits[25 + i]);
    let code = '';
    for (let c = 0; c < 5; c++) { let v = 0; for (let i = 0; i < 5; i++) v = v * 2 + data[c * 5 + i]; code += ALPHA[v]; }
    return { code, ok };
  }
  // +1 = light, -1 = dark, one entry per half cell
  function pattern(code) { const p = SYNC.slice(); for (const b of codeBits(code)) p.push(b ? 1 : -1, b ? -1 : 1); return p; }
  G.BQMarks = { ALPHA, NBITS, SYNC, HALVES, codeBits, bitsCode, pattern };
})(typeof window !== 'undefined' ? window : globalThis);
