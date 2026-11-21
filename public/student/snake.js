// A game for the waiting room, while the teacher admits the class: a snake that's a linked list. Each
// piece is a node pointing at the next; eating a node appends it at the tail. Arrow keys or WASD (swipe
// on a touch screen); Space or Enter starts. Nothing goes to the server; the best length stays in this
// browser. It stops by itself once it's off the page (the teacher admitted them).
(function () {
  'use strict';
  const BQ = (window.BQ = window.BQ || {});

  const COLS = 16;
  const ROWS = 11;
  const CELL = 26;
  const BEST_KEY = 'bq-snake-best';
  const DIRS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] };

  function readBest() { try { return Number(localStorage.getItem(BEST_KEY)) || 0; } catch (e) { return 0; } }
  function saveBest(n) { try { localStorage.setItem(BEST_KEY, String(n)); } catch (e) { /* only this game's best */ } }

  BQ.snake = function snake() {
    const wrap = document.createElement('div');
    wrap.className = 'snake';
    const canvas = document.createElement('canvas');
    canvas.className = 'snake-board';
    canvas.setAttribute('role', 'img');
    canvas.tabIndex = 0;
    const foot = document.createElement('div');
    foot.className = 'snake-foot';
    const score = document.createElement('span');
    score.className = 'snake-score';
    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'btn';
    play.textContent = 'Play';
    foot.append(score, play);
    wrap.append(canvas, foot);

    const ctx = canvas.getContext('2d');
    let body; // [[x, y]], head first
    let dir; let next; let food; let running = false; let over = false; let best = readBest();
    let last = 0; let acc = 0; let raf = 0;

    function size() {
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      canvas.width = COLS * CELL * dpr;
      canvas.height = ROWS * CELL * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function reset() {
      const y = Math.floor(ROWS / 2);
      body = [[5, y], [4, y], [3, y]];
      dir = [1, 0]; next = [1, 0];
      placeFood();
    }
    function placeFood() {
      const free = [];
      for (let x = 0; x < COLS; x++) for (let y = 0; y < ROWS; y++) if (!body.some(([a, b]) => a === x && b === y)) free.push([x, y]);
      food = free[Math.floor(Math.random() * free.length)];
    }
    const speed = () => Math.max(65, 150 - (body.length - 3) * 4); // ms a step, faster as it grows
    function label() {
      score.textContent = `Length ${body.length}${best ? ` · Best ${best}` : ''}`;
      canvas.setAttribute('aria-label', over ? `Game over, length ${body.length}` : `Snake, length ${body.length}`);
      play.textContent = over ? 'Play again' : 'Play';
      play.hidden = running;
    }

    function step() {
      dir = next;
      const head = [body[0][0] + dir[0], body[0][1] + dir[1]];
      const hit = head[0] < 0 || head[1] < 0 || head[0] >= COLS || head[1] >= ROWS
        || body.slice(0, -1).some(([a, b]) => a === head[0] && b === head[1]);
      if (hit) { running = false; over = true; if (body.length > best) { best = body.length; saveBest(best); } label(); return; }
      body.unshift(head);
      if (head[0] === food[0] && head[1] === food[1]) { placeFood(); label(); } else body.pop();
    }

    function colors() {
      const cs = getComputedStyle(wrap);
      const v = (n, d) => cs.getPropertyValue(n).trim() || d;
      return { bg: v('--soft', '#f4f5f7'), line: v('--line', '#d9dde2'), ink2: v('--ink-2', '#5b6470'), accent: v('--accent', '#2257d6'), good: v('--good', '#1b7f45'), bgPage: v('--bg', '#fff') };
    }
    function draw() {
      const c = colors();
      const W = COLS * CELL; const H = ROWS * CELL;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = c.bg;
      ctx.fillRect(0, 0, W, H);
      // a faint grid of dots
      ctx.fillStyle = c.line;
      for (let x = 1; x < COLS; x++) for (let y = 1; y < ROWS; y++) ctx.fillRect(x * CELL - 1, y * CELL - 1, 2, 2);
      const mid = ([x, y]) => [x * CELL + CELL / 2, y * CELL + CELL / 2];
      // pointers: from each node to the next, an arrow between the boxes
      ctx.strokeStyle = c.ink2; ctx.fillStyle = c.ink2; ctx.lineWidth = 2;
      for (let i = 0; i < body.length - 1; i++) {
        const [ax, ay] = mid(body[i]); const [bx, by] = mid(body[i + 1]);
        const dx = Math.sign(bx - ax); const dy = Math.sign(by - ay);
        const sx = ax + dx * (CELL / 2 - 5); const sy = ay + dy * (CELL / 2 - 5);
        const ex = bx - dx * (CELL / 2 - 5); const ey = by - dy * (CELL / 2 - 5);
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex - dx * 4 - dy * 3, ey - dy * 4 - dx * 3); ctx.lineTo(ex - dx * 4 + dy * 3, ey - dy * 4 + dx * 3); ctx.closePath(); ctx.fill();
      }
      // nodes: the head solid, the rest outlined
      body.forEach(([x, y], i) => {
        const px = x * CELL + 5; const py = y * CELL + 5; const s = CELL - 10; // a node, with room for its arrow
        ctx.lineWidth = 2;
        ctx.strokeStyle = c.accent;
        ctx.fillStyle = i === 0 ? c.accent : c.bgPage;
        ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(px, py, s, s, 4); else ctx.rect(px, py, s, s); ctx.fill(); ctx.stroke();
      });
      // the node to eat
      const [fx, fy] = mid(food);
      ctx.strokeStyle = c.good; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(fx, fy, CELL / 2 - 7, 0, Math.PI * 2); ctx.stroke();
    }

    function loop(t) {
      raf = 0;
      if (!wrap.isConnected) { stop(); return; } // off the page: admitted
      if (running && !document.hidden) {
        acc += Math.min(250, t - (last || t));
        while (running && acc >= speed()) { acc -= speed(); step(); }
      }
      last = t;
      draw();
      if (running) raf = requestAnimationFrame(loop);
    }
    function start() {
      if (running) return;
      if (over || !body) reset();
      over = false; running = true; acc = 0; last = 0;
      label();
      canvas.focus({ preventScroll: true });
      if (!raf) raf = requestAnimationFrame(loop);
    }
    function turn(d) {
      if (!running) return;
      if (d[0] === -dir[0] && d[1] === -dir[1]) return; // no reversing into itself
      next = d;
    }
    function onKey(e) {
      if (!wrap.isConnected) { stop(); return; }
      if (e.target && e.target.closest && e.target.closest('input, textarea, select')) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (DIRS[k] && running) { e.preventDefault(); turn(DIRS[k]); return; }
      // Space or Enter starts, unless they mean something where the focus is (a button, a link)
      const f = document.activeElement;
      const own = f && f !== canvas && f.closest && f.closest('button, a, input, textarea, select, summary');
      if ((k === ' ' || k === 'Enter') && !running && !own) { e.preventDefault(); start(); }
    }
    let touch = null;
    canvas.addEventListener('touchstart', (e) => { const p = e.touches[0]; touch = [p.clientX, p.clientY]; if (!running) start(); }, { passive: true });
    canvas.addEventListener('touchmove', (e) => {
      if (!touch || !running) return;
      const p = e.touches[0]; const dx = p.clientX - touch[0]; const dy = p.clientY - touch[1];
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return;
      turn(Math.abs(dx) > Math.abs(dy) ? [Math.sign(dx), 0] : [0, Math.sign(dy)]);
      touch = [p.clientX, p.clientY];
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('click', () => { if (!running) start(); });
    play.addEventListener('click', start);
    window.addEventListener('keydown', onKey);
    function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; window.removeEventListener('keydown', onKey); }

    size();
    reset();
    label();
    requestAnimationFrame(draw);
    return wrap;
  };
}());
