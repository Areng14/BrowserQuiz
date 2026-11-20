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
      if (o.integrity === false) { // practice: heartbeats only, to autosave answers
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

      this.on(window, 'drop', (e) => { e.preventDefault(); e.stopImmediatePropagation(); }, true);
      this.on(window, 'dragstart', (e) => { if (!inAnswerField(e.target)) e.preventDefault(); }, true);
      this.on(document, 'selectstart', (e) => { if (!inAnswerField(e.target)) e.preventDefault(); });

      this.on(window, 'resize', () => {
        if (Date.now() - this.fsChangedAt > 1500) this.report('resize', window.innerWidth + 'x' + window.innerHeight);
      });

      if (window.screen && 'isExtended' in window.screen && window.screen.addEventListener) {
        this.on(window.screen, 'change', () => {
          if (window.screen.isExtended) this.report('extended-display');
        });
      }

      // Reload button or closing the tab: ask first.
      this.on(window, 'beforeunload', (e) => { e.preventDefault(); e.returnValue = ''; });

      this.beatTimer = setInterval(() => this.beat(), BEAT_MS);
      this.beat();
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
        const ch = e.changes.map((c) => {
          inserted += c.text.length;
          return [c.rangeOffset, c.rangeLength, c.text];
        });
        if (this.edits.length < 5000) {
          this.edits.push({ q: questionId, t: now, ch, u: e.isUndoing ? 1 : 0, r: e.isRedoing ? 1 : 0, f: e.isFlush ? 1 : 0 });
        }
        if (!this.armed || e.isFlush || e.isUndoing || e.isRedoing) return;
        if (inserted >= BULK_INSERT_CHARS && now - this.internalPasteAt > 1000) {
          this.report('bulk-insert', inserted + ' chars');
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
      this.bound.splice(0).forEach((off) => off());
    }
  }

  BQ.Monitor = Monitor;
})();
