// Integrity monitor. Armed only while the quiz is on screen.
// It reports raw facts to the server and never decides anything itself:
// the server scores every event, so nothing here tells the student how they're doing.
(function () {
  'use strict';
  const BQ = (window.BQ = window.BQ || {});

  const BEAT_MS = 3000;
  const MOUSE_SAMPLE_MS = 100;
  const BULK_INSERT_CHARS = 80;
  const TYPING_WINDOW_MS = 10000;
  const TYPING_MAX_CPS = 15;

  const norm = (s) => String(s || '').replace(/\r\n?/g, '\n');

  // ---------- what else is on the page ----------
  // Extensions can't be listed from a page, but two kinds leave marks that a page can see.
  const nativeFn = (fn) => {
    try { return typeof fn === 'function' && /\{\s*\[native code\]\s*\}\s*$/.test(Function.prototype.toString.call(fn)); } catch (e) { return false; }
  };
  // "Always active window" extensions make the page believe it is still in front after the student has
  // switched away, by replacing the browser's own visibility and focus checks. Nothing honest does that.
  function spoofedChecks() {
    const bad = [];
    const own = (o, p) => Object.prototype.hasOwnProperty.call(o, p);
    for (const p of ['hidden', 'visibilityState']) {
      const d = Object.getOwnPropertyDescriptor(Document.prototype, p);
      if (own(document, p) || !d || !nativeFn(d.get)) bad.push(p);
    }
    if (own(document, 'hasFocus') || !nativeFn(document.hasFocus)) bad.push('hasFocus');
    return bad;
  }
  // Helper extensions (AI sidebars, writing assistants) put their own elements on the page. The quiz
  // itself uses no frames and no custom elements, and only the app and the code editor add to <body>.
  const PLAIN = new Set(['script', 'style', 'link', 'meta', 'title', 'base', 'noscript', 'template']); // nothing to see: themes add these
  const fromExtension = (el) => /^(chrome|moz|safari-web|ms-browser)-extension:/.test(el.getAttribute('src') || el.getAttribute('href') || '');
  const ourBodyChild = (el) => el.id === 'bq-app' || /(^|\s)(monaco-|context-view)/.test(el.getAttribute('class') || '');
  function foreignName(el) {
    if (!el || el.nodeType !== 1) return null;
    const tag = el.localName || '';
    const top = el.parentNode === document.documentElement && el !== document.head && el !== document.body;
    const inBody = el.parentNode === document.body && !ourBodyChild(el);
    const odd = tag.includes('-') || tag === 'iframe' || tag === 'embed' || tag === 'object' || fromExtension(el);
    if (!odd && (PLAIN.has(tag) || !(top || inBody))) return null;
    const cls = (el.getAttribute('class') || '').trim();
    return ('<' + tag + (el.id ? '#' + el.id : cls ? '.' + cls.split(/\s+/)[0] : '') + '>').slice(0, 60);
  }
  function foreignElements() {
    const names = new Set();
    const look = (el) => { const n = foreignName(el); if (n) names.add(n); };
    for (const el of document.documentElement.children) look(el);
    if (document.body) for (const el of document.body.querySelectorAll('*')) look(el);
    return [...names];
  }
  BQ.pageCheck = () => ({ spoofed: spoofedChecks(), added: foreignElements() });

  // Browser shortcuts that move focus out of the page (find bar, address bar, bookmark and history
  // panels, help tab). Pressed out of habit they would count as leaving the quiz, so they do nothing here.
  const CTRL_KEYS = new Set(['f', 'g', 'd', 'e', 'k', 'l', 'h', 'j', 'o']);
  const EDITOR_KEYS = new Set(['f', 'g', 'd', 'h', 'k', 'l', 'f1', 'f3']); // the code editor has its own use for these
  const PLAIN_KEYS = new Set(['f1', 'f3', 'f6']);

  function inAnswerField(el) {
    return !!(el && el.closest && el.closest('input, textarea, .monaco-editor, [data-answer-field]'));
  }

  class Monitor {
    /**
     * @param {object} api   BQ.api (event, beat)
     * @param {object} opts  { fullscreen, getAnswers, onFullscreenLost, onFullscreenBack, onPasteBlocked, onSave,
     *                         onReloadBlocked, onBeat(res, info), onBeatError(err, failures) }
     */
    constructor(api, opts) {
      this.api = api;
      this.opts = opts || {};
      this.armed = false;
      this.mouse = [];
      this.lastMouseAt = 0;
      this.lastActivityAt = Date.now();
      this.awaySince = 0;
      this.lastSent = Object.create(null);
      this.clip = '';
      this.internalPasteAt = 0;
      this.fsChangedAt = 0;
      this.answersDirty = false;
      this.edits = [];
      this.typed = [];
      this.typingFlaggedAt = 0;
      this.selectionProvider = null; // (target) => selected text, set by the code editor
      this.beatTimer = 0;
      this.bound = [];
      this.failures = 0;
      this.late = []; // events that couldn't be sent (offline), delivered with the next good heartbeat
      this.seenForeign = new Set();
      this.scriptedAt = 0;
      this.timers = [];
      this.raf = 0;
      this.wake = null;
    }

    // Each extension element is reported once, by name, so the teacher can tell a dark theme from a helper.
    noteForeign(el) {
      const name = foreignName(el);
      if (!name || this.seenForeign.has(name) || this.seenForeign.size >= 12) return;
      this.seenForeign.add(name);
      this.lastSent.extension = 0;
      this.report('extension', name);
    }

    // Idle screens on lab PCs lock themselves, which looks exactly like leaving. Keep the screen on.
    keepAwake() {
      if (!navigator.wakeLock || !navigator.wakeLock.request || document.hidden) return;
      navigator.wakeLock.request('screen').then((w) => {
        if (this.armed) this.wake = w;
        else w.release().catch(() => {});
      }).catch(() => {});
    }

    // One line for the teacher about this computer, so they know which checks were working on it.
    reportSetup() {
      const scr = window.screen || {};
      const parts = [`screen ${scr.width}x${scr.height}`, `window ${window.outerWidth}x${window.outerHeight}`];
      parts.push(!('isExtended' in scr) ? 'second-display check not available' : scr.isExtended ? 'second display' : 'one display');
      if (this.opts.fullscreen) parts.push(this.opts.keysHeld && this.opts.keysHeld() ? 'Alt+Tab and Windows key held' : 'Alt+Tab and Windows key not held');
      if (!window.isSecureContext) parts.push('not HTTPS');
      this.report('setup', parts.join(', '));
    }

    report(type, detail) {
      if (!this.armed) return;
      const now = Date.now();
      if (now - (this.lastSent[type] || 0) < 500) return; // same event twice in 500ms is one report
      this.lastSent[type] = now;
      const d = detail == null ? undefined : String(detail);
      Promise.resolve(this.api.event(type, d)).catch(() => {
        if (this.late.length < 100) this.late.push([type, d || null, now]);
      });
    }

    on(target, type, fn, options) {
      target.addEventListener(type, fn, options);
      this.bound.push(() => target.removeEventListener(type, fn, options));
    }

    arm() {
      if (this.armed) return;
      this.armed = true;
      const o = this.opts;
      if (o.integrity === false) { // practice: heartbeats to autosave answers, and the mouse for Watch
        this.trackMouse();
        this.beatMs = BEAT_MS;
        this.beatTimer = setInterval(() => this.beat(), BEAT_MS);
        this.beat();
        return;
      }

      this.on(window, 'blur', () => {
        if (!this.awaySince) this.awaySince = Date.now();
        this.report('blur');
      });
      this.on(window, 'focus', () => {
        if (this.awaySince) {
          this.report('return', ((Date.now() - this.awaySince) / 1000).toFixed(1) + 's away');
          this.awaySince = 0;
          if (this.opts.onReturn) this.opts.onReturn();
        }
      });
      this.on(document, 'visibilitychange', () => {
        if (document.hidden) {
          if (!this.awaySince) this.awaySince = Date.now();
          this.report('hidden');
        } else {
          this.keepAwake(); // the browser drops the wake lock whenever the page is hidden
        }
      });
      this.on(document, 'fullscreenchange', () => {
        this.fsChangedAt = Date.now();
        if (!o.fullscreen) return;
        if (document.fullscreenElement) {
          if (o.onFullscreenBack) o.onFullscreenBack();
        } else {
          this.report('fullscreen-exit');
          if (o.onFullscreenLost) o.onFullscreenLost();
        }
      });
      this.on(document.documentElement, 'mouseleave', () => {
        // On a one-monitor lab PC in fullscreen the cursor can't leave the page.
        if (document.fullscreenElement) this.report('mouse-left');
      });
      this.trackMouse();

      this.on(window, 'keydown', (e) => {
        this.lastActivityAt = Date.now();
        const mod = e.ctrlKey || e.metaKey;
        const k = (e.key || '').toLowerCase();
        if (e.key === 'F12' || (mod && e.shiftKey && ['i', 'j', 'c'].includes(k)) || (e.metaKey && e.altKey && ['i', 'j', 'c'].includes(k))) {
          e.preventDefault();
          this.report('blocked-key', e.key === 'F12' ? 'F12' : 'devtools shortcut');
          return;
        }
        if (mod && (k === 'p' || k === 'u')) {
          e.preventDefault();
          this.report('blocked-key', (e.metaKey ? 'Cmd+' : 'Ctrl+') + k.toUpperCase());
          return;
        }
        // With the keys held in fullscreen (enterFullscreen in app.js), Alt+Tab, Ctrl+Tab and the Windows
        // key arrive here instead of switching windows. Plain Tab is untouched.
        if (k === 'tab' && (e.altKey || e.ctrlKey)) {
          e.preventDefault();
          this.report('blocked-key', (e.altKey ? 'Alt' : 'Ctrl') + '+Tab');
          return;
        }
        if (e.key === 'Meta' && /^Win/.test(navigator.platform || '') && document.fullscreenElement && o.keysHeld && o.keysHeld()) {
          e.preventDefault();
          this.report('blocked-key', 'Windows key');
          return;
        }
        const fkey = !mod && !e.altKey && PLAIN_KEYS.has(k);
        if (fkey || (mod && !e.altKey && !e.shiftKey && CTRL_KEYS.has(k)) || (mod && !e.altKey && e.shiftKey && ['o', 'b', 'delete'].includes(k))
          || (e.altKey && !mod && (k === 'd' || k === 'home'))) {
          e.preventDefault();
          const editorsOwn = !e.shiftKey && !e.altKey && EDITOR_KEYS.has(k) && !!(e.target && e.target.closest && e.target.closest('.monaco-editor'));
          if (!editorsOwn) {
            this.report('blocked-key', fkey ? e.key : (mod ? (e.metaKey ? 'Cmd+' : 'Ctrl+') : 'Alt+') + (e.shiftKey ? 'Shift+' : '') + (k.length === 1 ? k.toUpperCase() : e.key));
          }
          return;
        }
        if (mod && k === 's') {
          e.preventDefault(); // muscle memory; answers autosave anyway
          if (o.onSave) o.onSave();
        }
        if (e.key === 'F5' || (mod && k === 'r')) {
          e.preventDefault(); // an accidental reload mid-quiz is costly
          if (o.onReloadBlocked) o.onReloadBlocked();
        }
      }, true);
      this.on(window, 'keyup', (e) => {
        if (e.key === 'PrintScreen') this.report('print-screen');
      }, true);

      this.on(window, 'contextmenu', (e) => {
        e.preventDefault();
        this.report('contextmenu');
      }, true);

      const rememberCopy = (e) => {
        if (!inAnswerField(e.target)) {
          e.preventDefault(); // question text stays on the page
          this.report('copy');
          return;
        }
        let text = this.selectionProvider ? this.selectionProvider(e.target) : '';
        if (!text) {
          const t = e.target;
          if (t && typeof t.selectionStart === 'number') text = t.value.slice(t.selectionStart, t.selectionEnd);
          else text = String(window.getSelection() || '');
        }
        if (text) this.clip = norm(text);
      };
      this.on(window, 'copy', rememberCopy, true);
      this.on(window, 'cut', rememberCopy, true);

      this.on(window, 'paste', (e) => {
        const text = norm(e.clipboardData ? e.clipboardData.getData('text/plain') : '');
        if (text && text === this.clip) {
          this.internalPasteAt = Date.now(); // your own code moving around: allowed
          return;
        }
        e.preventDefault();
        e.stopImmediatePropagation(); // capture phase on window: the editor never sees it
        this.report('paste', text.length + ' chars');
        if (o.onPasteBlocked) o.onPasteBlocked();
      }, true);

      // Typing that didn't come from the keyboard: an auto-typer or helper extension filling in the answer.
      const scripted = (e) => {
        if (e.isTrusted || !inAnswerField(e.target) || Date.now() - this.scriptedAt < 30000) return;
        this.scriptedAt = Date.now();
        this.report('scripted-input', e.type + ' event not from the keyboard');
      };
      for (const type of ['keydown', 'beforeinput', 'input']) this.on(window, type, scripted, true);

      this.on(window, 'drop', (e) => { e.preventDefault(); e.stopImmediatePropagation(); }, true);
      this.on(window, 'dragstart', (e) => { if (!inAnswerField(e.target)) e.preventDefault(); }, true);
      // Selecting is allowed in answers and in question text (to highlight it); copying question text out
      // is still blocked above.
      this.on(document, 'selectstart', (e) => {
        const el = e.target && (e.target.nodeType === 1 ? e.target : e.target.parentElement);
        if (!inAnswerField(el) && !(el && el.closest && el.closest('.hl-root'))) e.preventDefault();
      });

      // Only the window changing size counts. Zooming the page (which a student may need to read it) changes
      // the inner size only.
      // Turning a tablet sideways isn't one either (only on touch screens: a desktop window snapped to half the
      // screen can turn tall too).
      let outer = window.outerWidth + 'x' + window.outerHeight;
      const portrait = () => window.matchMedia('(orientation: portrait)').matches;
      let wasPortrait = portrait();
      this.on(window, 'resize', () => {
        const now = window.outerWidth + 'x' + window.outerHeight;
        if (now === outer) return;
        outer = now;
        const turned = portrait() !== wasPortrait && window.matchMedia('(pointer: coarse)').matches;
        wasPortrait = portrait();
        if (!turned && Date.now() - this.fsChangedAt > 1500) this.report('resize', window.innerWidth + 'x' + window.innerHeight);
      });

      // In fullscreen the page is the whole window. Zoom scales width and height alike, so if one of
      // them is short, something is docked beside the page: a browser side panel or DevTools.
      let squeezed = false;
      const checkFill = () => {
        if (!this.armed || !document.fullscreenElement || Date.now() - this.fsChangedAt < 1500) return;
        const scr = window.screen || {};
        if (window.outerWidth < scr.width - 2 || window.outerHeight < scr.height - 2) return; // not a real fullscreen window: sizes can't be trusted
        const w = window.outerWidth / Math.max(1, window.innerWidth);
        const hgt = window.outerHeight / Math.max(1, window.innerHeight);
        const zoom = Math.min(w, hgt);
        const now = Math.max(w, hgt) / zoom > 1.1;
        if (now && !squeezed) {
          this.report('viewport', `page is ${Math.round(window.innerWidth * zoom)}x${Math.round(window.innerHeight * zoom)} of ${window.outerWidth}x${window.outerHeight}`);
        }
        squeezed = now;
      };
      this.on(window, 'resize', () => setTimeout(checkFill, 300));
      this.on(document, 'fullscreenchange', () => setTimeout(checkFill, 2000));
      this.timers.push(setTimeout(checkFill, 2000));

      // The browser stops drawing a page that is hidden or fully covered, and normally says so (the
      // "hidden" event above). No frames for several seconds, while timers still run and the page still
      // says it is visible, means the visibility report itself is being blocked.
      let lastFrame = Date.now();
      let lastTick = Date.now();
      let dry = 0;
      let dryFrom = 0;
      const frame = () => {
        lastFrame = Date.now();
        if (this.armed) this.raf = requestAnimationFrame(frame);
      };
      this.raf = requestAnimationFrame(frame);
      this.timers.push(setInterval(() => {
        const now = Date.now();
        const gap = now - lastTick;
        lastTick = now;
        if (gap > 2500) { dry = 0; return; } // the whole page was paused (a browser dialog, sleep): tells nothing
        if (!document.hidden && now - lastFrame > 3000) {
          if (!dry) dryFrom = lastFrame;
          if (++dry === 3) this.report('no-frames', 'page says it is visible');
        } else {
          if (dry >= 3) this.report('no-frames', `on screen again after ${Math.round((now - dryFrom) / 1000)}s`);
          dry = 0;
        }
      }, 1000));

      const spoofed = spoofedChecks();
      if (spoofed.length) this.report('spoofed-checks', spoofed.join(', '));
      for (const el of [...document.documentElement.children, ...document.body.querySelectorAll('*')]) this.noteForeign(el);
      const mo = new MutationObserver((list) => {
        for (const m of list) for (const n of m.addedNodes) this.noteForeign(n);
      });
      mo.observe(document.documentElement, { childList: true, subtree: true });
      this.bound.push(() => mo.disconnect());

      // Back (Alt+Left, a mouse side button, a touchpad swipe) would leave the page. Give it a step that
      // goes nowhere.
      try {
        history.pushState({ bq: 'quiz' }, '');
        this.on(window, 'popstate', () => {
          try { history.pushState({ bq: 'quiz' }, ''); } catch (e) { /* ignore */ }
          this.report('blocked-key', 'Back');
        });
      } catch (e) { /* ignore */ }

      this.keepAwake();
      this.timers.push(setTimeout(() => this.reportSetup(), 1500));

      if (window.screen && 'isExtended' in window.screen && window.screen.addEventListener) {
        this.on(window.screen, 'change', () => {
          if (window.screen.isExtended) this.report('extended-display');
        });
      }

      // Reload button or closing the tab: ask first.
      this.on(window, 'beforeunload', (e) => { e.preventDefault(); e.returnValue = ''; });

      this.beatMs = BEAT_MS;
      this.beatTimer = setInterval(() => this.beat(), BEAT_MS);
      this.beat();
    }

    // The mouse path (10 samples a second, clicks marked): the trail on the teacher's page, and the cursor
    // when they watch live.
    trackMouse() {
      // A click goes in the trail right away, marked, so a teacher watching sees it.
      this.on(document, 'mousedown', (e) => {
        const now = Date.now();
        const dt = this.lastMouseAt ? now - this.lastMouseAt : 0;
        this.lastMouseAt = now;
        if (this.mouse.length < 400) {
          this.mouse.push([Math.round((e.clientX / Math.max(1, window.innerWidth)) * 1000), Math.round((e.clientY / Math.max(1, window.innerHeight)) * 1000), dt, 1]);
        }
      }, { passive: true, capture: true });
      this.on(document, 'mousemove', (e) => {
        const now = Date.now();
        this.lastActivityAt = now;
        if (now - this.lastMouseAt < MOUSE_SAMPLE_MS) return;
        const dt = this.lastMouseAt ? now - this.lastMouseAt : 0;
        this.lastMouseAt = now;
        if (this.mouse.length < 400) {
          this.mouse.push([
            Math.round((e.clientX / Math.max(1, window.innerWidth)) * 1000),
            Math.round((e.clientY / Math.max(1, window.innerHeight)) * 1000),
            dt,
          ]);
        }
      }, { passive: true });
    }

    // The server can ask for heartbeats more often (every student in a run alike, while a teacher watches).
    setBeat(ms) {
      ms = Math.max(1000, Math.min(BEAT_MS, Number(ms) || BEAT_MS));
      if (!this.armed || ms === this.beatMs) return;
      this.beatMs = ms;
      clearInterval(this.beatTimer);
      this.beatTimer = setInterval(() => this.beat(), ms);
    }

    beat() {
      if (!this.armed) return;
      const payload = {
        focused: document.hasFocus(),
        visible: !document.hidden,
        fullscreen: !!document.fullscreenElement,
        extended: window.screen && 'isExtended' in window.screen ? !!window.screen.isExtended : null,
        idleMs: Date.now() - this.lastActivityAt,
        mouse: this.mouse.splice(0),
        edits: this.edits.splice(0, 300),
      };
      // How long ago the last mouse sample was, so the trail can be placed in time; and what's on screen.
      if (payload.mouse.length) payload.mouseEnd = Date.now() - this.lastMouseAt;
      if (this.opts.getView) payload.view = this.opts.getView();
      if (this.answersDirty && this.opts.getAnswers) {
        payload.answers = this.opts.getAnswers();
        this.answersDirty = false;
      }
      const sentAt = Date.now();
      const late = this.late.splice(0);
      if (late.length) payload.late = late.map(([type, detail, t]) => [type, detail, sentAt - t]);
      Promise.resolve(this.api.beat(payload))
        .then((r) => {
          this.failures = 0;
          this.setBeat(r && r.beatMs);
          if (this.opts.onBeat) this.opts.onBeat(r, { answers: !!payload.answers });
        })
        .catch((err) => {
          this.failures++;
          if (payload.answers) this.answersDirty = true;
          // Keep the typing replay and anything we couldn't report; the mouse trail can go.
          if (payload.edits.length && this.edits.length < 5000) this.edits.unshift(...payload.edits);
          if (late.length) this.late.unshift(...late.slice(0, 100 - this.late.length));
          if (this.opts.onBeatError) this.opts.onBeatError(err, this.failures);
        });
    }

    // Code editor telemetry: every edit delta (for typing replay), bulk inserts, inhuman typing speed.
    trackEditor(editor, questionId) {
      const sub = editor.onDidChangeModelContent((e) => {
        const now = Date.now();
        this.lastActivityAt = now;
        let inserted = 0;
        let biggest = '';
        const ch = e.changes.map((c) => {
          inserted += c.text.length;
          if (c.text.length > biggest.length) biggest = c.text;
          return [c.rangeOffset, c.rangeLength, c.text];
        });
        if (this.edits.length < 5000) {
          this.edits.push({ q: questionId, t: now, ch, u: e.isUndoing ? 1 : 0, r: e.isRedoing ? 1 : 0, f: e.isFlush ? 1 : 0 });
        }
        if (!this.armed || e.isFlush || e.isUndoing || e.isRedoing) return;
        // One big piece arriving at once. Indenting or commenting many lines is many small pieces, and
        // duplicating lines leaves the same text in the code twice: neither came from outside.
        if (biggest.length >= BULK_INSERT_CHARS && now - this.internalPasteAt > 1000) {
          const text = editor.getValue();
          const piece = biggest.trim();
          if (!piece || text.indexOf(piece) === text.lastIndexOf(piece)) this.report('bulk-insert', biggest.length + ' chars');
        }
        if (inserted === 1) {
          this.typed.push(now);
          while (this.typed.length && now - this.typed[0] > TYPING_WINDOW_MS) this.typed.shift();
          if (this.typed.length > TYPING_MAX_CPS * (TYPING_WINDOW_MS / 1000) && now - this.typingFlaggedAt > 60000) {
            this.typingFlaggedAt = now;
            this.report('inhuman-typing', this.typed.length + ' chars in 10s');
          }
        }
      });
      return sub;
    }

    markAnswersDirty() {
      this.answersDirty = true;
    }

    disarm() {
      if (!this.armed) return;
      this.beat();
      this.armed = false;
      clearInterval(this.beatTimer);
      this.timers.splice(0).forEach((t) => clearTimeout(t)); // clears the intervals too
      cancelAnimationFrame(this.raf);
      if (this.wake) { this.wake.release().catch(() => {}); this.wake = null; }
      this.bound.splice(0).forEach((off) => off());
    }
  }

  BQ.Monitor = Monitor;
})();
