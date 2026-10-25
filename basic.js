/*
 * BASIC interpreter core.
 *
 * DOM-free: the UI supplies a Terminal (character grid) and a storage
 * adapter, then drives execution with enter() / runSlice() / provideInput().
 */
(function (root) {
    'use strict';

    const KEYWORDS = new Set([
        'PRINT', 'INPUT', 'LET', 'GOTO', 'GOSUB', 'RETURN', 'IF', 'THEN', 'ELSE',
        'FOR', 'TO', 'STEP', 'NEXT', 'REM', 'END', 'STOP', 'DIM', 'WHILE', 'WEND',
        'EXIT', 'DATA', 'READ', 'RESTORE', 'CLS', 'AT', 'AND', 'OR', 'NOT', 'MOD',
        'ON', 'RANDOMIZE', 'RUN', 'LIST', 'NEW', 'SAVE', 'LOAD', 'FILES', 'KILL',
        'CONT', 'CLEAR', 'HELP'
    ]);

    const STORAGE_PREFIX = 'basic_program_';
    const EOF = { t: 'eof', v: null };

    class BasicError extends Error {}
    function err(msg) { throw new BasicError(msg); }

    function N(v) { if (typeof v !== 'number') err('TYPE MISMATCH'); return v; }
    function S(v) { if (typeof v !== 'string') err('TYPE MISMATCH'); return v; }

    function fmt(n) {
        if (!isFinite(n)) err('OVERFLOW');
        if (Number.isInteger(n)) return String(n);
        return String(parseFloat(n.toPrecision(9))).replace('e', 'E');
    }

    // Built-in functions: [minArgs, maxArgs, impl]
    const FUNCS = {
        ABS: [1, 1, a => Math.abs(N(a[0]))],
        SGN: [1, 1, a => Math.sign(N(a[0]))],
        INT: [1, 1, a => Math.floor(N(a[0]))],
        SQR: [1, 1, a => { if (N(a[0]) < 0) err('ILLEGAL QUANTITY'); return Math.sqrt(a[0]); }],
        SIN: [1, 1, a => Math.sin(N(a[0]))],
        COS: [1, 1, a => Math.cos(N(a[0]))],
        TAN: [1, 1, a => Math.tan(N(a[0]))],
        ATN: [1, 1, a => Math.atan(N(a[0]))],
        LOG: [1, 1, a => { if (N(a[0]) <= 0) err('ILLEGAL QUANTITY'); return Math.log(a[0]); }],
        EXP: [1, 1, a => Math.exp(N(a[0]))],
        RND: [0, 1, () => Math.random()],
        PI: [0, 0, () => Math.PI],
        LEN: [1, 1, a => S(a[0]).length],
        VAL: [1, 1, a => parseFloat(S(a[0])) || 0],
        ASC: [1, 1, a => { if (!S(a[0])) err('ILLEGAL QUANTITY'); return a[0].charCodeAt(0); }],
        'CHR$': [1, 1, a => String.fromCharCode(N(a[0]))],
        'STR$': [1, 1, a => fmt(N(a[0]))],
        'LEFT$': [2, 2, a => S(a[0]).substring(0, Math.max(0, N(a[1])))],
        'RIGHT$': [2, 2, a => { const n = Math.max(0, N(a[1])); return n ? S(a[0]).slice(-n) : ''; }],
        'MID$': [2, 3, a => {
            const start = Math.max(1, Math.floor(N(a[1]))) - 1;
            return a.length > 2 ? S(a[0]).substr(start, Math.max(0, N(a[2]))) : S(a[0]).substring(start);
        }],
        INSTR: [2, 2, a => S(a[0]).indexOf(S(a[1])) + 1],
        'UCASE$': [1, 1, a => S(a[0]).toUpperCase()],
        'LCASE$': [1, 1, a => S(a[0]).toLowerCase()],
        'STRING$': [2, 2, a => (typeof a[1] === 'number' ? String.fromCharCode(a[1]) : a[1].charAt(0)).repeat(Math.max(0, N(a[0])))]
    };

    /**
     * Uppercase everything outside string literals and comments.
     */
    function normalize(src) {
        let out = '';
        let quoted = false;
        for (let i = 0; i < src.length; i++) {
            const c = src[i];
            if (c === '"') quoted = !quoted;
            if (!quoted) {
                if (c === "'") return out + src.slice(i);
                if (/^REM(?![A-Z0-9_$])/i.test(src.slice(i)) && !/[A-Z0-9_$]/i.test(src[i - 1] || '')) {
                    return out + 'REM' + src.slice(i + 3);
                }
            }
            out += quoted ? c : c.toUpperCase();
        }
        return out;
    }

    function tokenize(src) {
        const toks = [];
        let i = 0;
        const n = src.length;
        while (i < n) {
            const c = src[i];
            const rest = src.slice(i);
            if (c === ' ' || c === '\t') { i++; continue; }
            if (c === '"') {
                let j = src.indexOf('"', i + 1);
                if (j < 0) j = n;
                toks.push({ t: 'str', v: src.slice(i + 1, j) });
                i = j + 1;
                continue;
            }
            if (/[0-9.]/.test(c)) {
                const m = /^(\d+\.?\d*|\.\d+)(E[+-]?\d+)?/i.exec(rest);
                if (!m) err('SYNTAX');
                toks.push({ t: 'num', v: parseFloat(m[0]) });
                i += m[0].length;
                continue;
            }
            if (/[A-Za-z]/.test(c)) {
                const m = /^[A-Za-z][A-Za-z0-9_]*\$?/.exec(rest);
                const word = m[0].toUpperCase();
                i += m[0].length;
                if (word === 'REM') {
                    toks.push({ t: 'kw', v: 'REM' });
                    break;
                }
                if (word === 'DATA') {
                    // Raw text up to the next statement separator
                    let j = i, quoted = false;
                    while (j < n && (quoted || src[j] !== ':')) {
                        if (src[j] === '"') quoted = !quoted;
                        j++;
                    }
                    toks.push({ t: 'kw', v: 'DATA' }, { t: 'raw', v: src.slice(i, j) });
                    i = j;
                    continue;
                }
                toks.push({ t: KEYWORDS.has(word) ? 'kw' : 'id', v: word });
                continue;
            }
            if (c === "'") { toks.push({ t: 'kw', v: 'REM' }); break; }
            if (c === '?') { toks.push({ t: 'kw', v: 'PRINT' }); i++; continue; }
            const two = src.substr(i, 2);
            const twoOps = { '<>': '<>', '><': '<>', '<=': '<=', '=<': '<=', '>=': '>=', '=>': '>=', '==': '=' };
            if (twoOps[two]) { toks.push({ t: 'op', v: twoOps[two] }); i += 2; continue; }
            if ('+-*/^=<>()[],;:'.includes(c)) { toks.push({ t: 'op', v: c }); i++; continue; }
            err('SYNTAX');
        }
        return toks;
    }

    /** Split comma-separated text, honouring double quotes. */
    function splitCsv(text) {
        const parts = [];
        let cur = '', quoted = false;
        for (const c of text) {
            if (c === '"') quoted = !quoted;
            if (c === ',' && !quoted) { parts.push(cur); cur = ''; } else cur += c;
        }
        parts.push(cur);
        return parts;
    }

    function unquote(s) {
        s = s.trim();
        return s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"' ? s.slice(1, -1) : s;
    }

    class Cursor {
        constructor(toks) { this.t = toks; this.i = 0; }
        peek(k = 0) { return this.t[this.i + k] || EOF; }
        next() { return this.t[this.i++] || EOF; }
        is(type, v) { const k = this.peek(); return k.t === type && (v === undefined || k.v === v); }
        accept(type, v) { if (this.is(type, v)) { this.i++; return true; } return false; }
        expect(type, v) { if (!this.accept(type, v)) err('SYNTAX'); }
        atEnd() { return this.i >= this.t.length; }
        end() { if (!this.atEnd()) err('SYNTAX'); }
    }

    /**
     * Character-grid screen with scrollback.
     */
    class Terminal {
        constructor(cols = 40, rows = 24, maxHistory = 1000) {
            this.cols = cols;
            this.rows = rows;
            this.maxHistory = maxHistory;
            this.cls();
        }

        blankRow() { return new Array(this.cols).fill(' '); }

        cls() {
            this.grid = Array.from({ length: this.rows }, () => this.blankRow());
            this.history = [];
            this.row = 0;
            this.col = 0;
        }

        scroll() {
            this.history.push(this.grid.shift().join('').trimEnd());
            if (this.history.length > this.maxHistory) this.history.shift();
            this.grid.push(this.blankRow());
        }

        newline() {
            this.col = 0;
            if (++this.row >= this.rows) {
                this.scroll();
                this.row = this.rows - 1;
            }
        }

        write(text) {
            for (const ch of String(text)) {
                if (ch === '\n') { this.newline(); continue; }
                if (this.col >= this.cols) this.newline();
                this.grid[this.row][this.col++] = ch;
            }
        }

        println(text = '') { this.write(text); this.newline(); }

        ensureNewline() { if (this.col > 0) this.newline(); }

        at(row, col) {
            this.row = Math.min(this.rows - 1, Math.max(0, Math.floor(row)));
            this.col = Math.min(this.cols - 1, Math.max(0, Math.floor(col)));
        }

        /** Advance to the next 10-column print zone. */
        zone() {
            const next = (Math.floor(this.col / 10) + 1) * 10;
            if (next >= this.cols) this.newline(); else this.col = next;
        }

        tabTo(col) {
            col = Math.floor(col);
            if (col > this.col) this.write(' '.repeat(Math.min(col, this.cols - 1) - this.col));
        }

        lines() {
            return this.history.concat(this.grid.map(r => r.join('').trimEnd()));
        }
    }

    class Basic {
        /**
         * @param {Terminal} term
         * @param {{get(k):string|null, set(k,v):boolean, remove(k):void, keys():string[]}} storage
         */
        constructor(term, storage) {
            this.term = term;
            this.storage = storage;
            this.program = {};
            this.prog = null;
            this.state = 'idle';
            this.onProgramChange = null;
            this.cont = null;
            this.clearVars();
        }

        clearVars() {
            this.vars = {};
            this.arrays = {};
            this.loops = [];
            this.gosubs = [];
            this.dataPtr = 0;
        }

        changed() {
            this.prog = null;
            this.cont = null;
            if (this.onProgramChange) this.onProgramChange();
        }

        lineNumbers() {
            return Object.keys(this.program).map(Number).sort((a, b) => a - b);
        }

        listing() {
            return this.lineNumbers().map(n => `${n} ${this.program[n]}`).join('\n');
        }

        /** Replace the program with numbered lines from text. Returns line count. */
        loadText(text) {
            this.program = {};
            for (const line of text.split(/\r?\n/)) {
                const m = /^\s*(\d+)\s*(.*)$/.exec(line);
                if (m && m[2].trim()) this.program[+m[1]] = normalize(m[2].trim());
            }
            this.clearVars();
            this.changed();
            return Object.keys(this.program).length;
        }

        // ---- compilation ---------------------------------------------------

        /**
         * Flatten source lines into a statement list. Lines split at ':',
         * after THEN and around ELSE so IF can skip to the line end.
         */
        compile(entries) {
            const stmts = [];
            const lineIndex = {};
            const data = [];
            for (const [ln, src] of entries) {
                if (ln !== null) lineIndex[ln] = stmts.length;
                let toks;
                try {
                    toks = tokenize(src);
                } catch (e) {
                    stmts.push({ line: ln, toks: [], err: e.message });
                    continue;
                }
                let cur = [];
                const push = () => { if (cur.length) stmts.push({ line: ln, toks: cur }); cur = []; };
                const gotoIfNumber = k => { if (toks[k + 1] && toks[k + 1].t === 'num') cur.push({ t: 'kw', v: 'GOTO' }); };
                for (let k = 0; k < toks.length; k++) {
                    const tk = toks[k];
                    if (tk.t === 'op' && tk.v === ':') { push(); continue; }
                    if (tk.t === 'kw' && tk.v === 'THEN') { cur.push(tk); push(); gotoIfNumber(k); continue; }
                    if (tk.t === 'kw' && tk.v === 'ELSE') { push(); cur.push(tk); push(); gotoIfNumber(k); continue; }
                    if (tk.t === 'raw' && ln !== null) {
                        for (const item of splitCsv(tk.v)) {
                            const t = item.trim();
                            const quoted = t.startsWith('"');
                            data.push({ line: ln, v: !quoted && t !== '' && isFinite(Number(t)) ? Number(t) : unquote(t) });
                        }
                    }
                    cur.push(tk);
                }
                push();
            }
            // Index of the first statement on the following line
            for (let i = stmts.length - 1; i >= 0; i--) {
                const nxt = stmts[i + 1];
                stmts[i].lineEnd = nxt && nxt.line === stmts[i].line ? nxt.lineEnd : i + 1;
            }
            return { stmts, lineIndex, data };
        }

        ensureProg() {
            if (!this.prog) this.prog = this.compile(this.lineNumbers().map(n => [n, this.program[n]]));
            return this.prog;
        }

        // ---- driver --------------------------------------------------------

        /** Handle a line typed at the prompt. */
        enter(text) {
            if (this.state !== 'idle') return;
            const src = text.trim();
            if (!src) return;
            const m = /^(\d+)\s*(.*)$/.exec(src);
            if (m) {
                const body = normalize(m[2].trim());
                if (body) this.program[+m[1]] = body; else delete this.program[+m[1]];
                this.changed();
                return;
            }
            this.quiet = false;
            this.ranProgram = false;
            this.stmt = null;
            this.cur = this.compile([[null, normalize(src)]]).stmts;
            this.pc = 0;
            this.state = 'running';
        }

        /** Execute statements for up to `ms` milliseconds. Returns the new state. */
        runSlice(ms = 15) {
            const t0 = Date.now();
            let count = 0;
            try {
                while (this.state === 'running') {
                    if (this.pc >= this.cur.length) { this.finish(); break; }
                    this.stmt = this.cur[this.pc++];
                    this.exec(this.stmt);
                    if ((++count & 255) === 0 && Date.now() - t0 > ms) break;
                }
            } catch (e) {
                if (!(e instanceof BasicError)) {
                    console.error(e);
                    e = new BasicError('INTERNAL');
                }
                this.fail(e.message);
            }
            return this.state;
        }

        finish() {
            this.state = 'idle';
            this.term.ensureNewline();
            if (!this.quiet) this.term.println(this.ranProgram ? 'READY.' : 'OK');
        }

        fail(msg) {
            const ln = this.stmt ? this.stmt.line : null;
            this.term.ensureNewline();
            this.term.println(`?${msg} ERROR${ln !== null ? ' IN ' + ln : ''}`);
            this.term.println('READY.');
            this.state = 'idle';
            this.pending = null;
            this.cont = null;
        }

        /** Break (Esc / STOP button / STOP statement). */
        interrupt() {
            if (this.state === 'idle') return;
            const ln = this.stmt ? this.stmt.line : null;
            const inProgram = this.prog && this.cur === this.prog.stmts;
            // An interrupted INPUT is re-executed on CONT
            this.cont = inProgram ? { pc: this.state === 'input' ? this.pc - 1 : this.pc } : null;
            this.state = 'idle';
            this.pending = null;
            this.term.ensureNewline();
            this.term.println(`BREAK${ln !== null ? ' IN ' + ln : ''}`);
            this.term.println('READY.');
        }

        provideInput(text) {
            if (this.state !== 'input') return;
            const pend = this.pending;
            const parts = pend.lvs.length - pend.i === 1 ? [text] : splitCsv(text);
            try {
                for (const raw of parts) {
                    if (pend.i >= pend.lvs.length) { this.term.println('?EXTRA IGNORED'); break; }
                    const lv = pend.lvs[pend.i];
                    let v;
                    if (lv.name.endsWith('$')) {
                        v = unquote(raw);
                    } else {
                        const t = raw.trim();
                        if (t === '' || !isFinite(Number(t))) {
                            this.term.println('?REDO FROM START');
                            pend.i = 0;
                            this.term.write(pend.prompt);
                            return;
                        }
                        v = Number(t);
                    }
                    this.assign(lv, v);
                    pend.i++;
                }
            } catch (e) {
                this.fail(e.message);
                return;
            }
            if (pend.i < pend.lvs.length) { this.term.write('?? '); return; }
            this.pending = null;
            this.state = 'running';
        }

        exec(st) {
            if (st.err) err(st.err);
            const p = new Cursor(st.toks);
            const tk = p.peek();
            if (tk.t === 'kw') {
                p.next();
                const handler = this['s_' + tk.v];
                if (!handler) err('SYNTAX');
                handler.call(this, p, st);
            } else if (tk.t === 'id') {
                this.s_LET(p);
            } else {
                err('SYNTAX');
            }
        }

        jumpToLine(n) {
            const prog = this.ensureProg();
            const idx = prog.lineIndex[n];
            if (idx === undefined) err("UNDEF'D STATEMENT");
            if (this.cur !== prog.stmts) this.ranProgram = true;
            this.cur = prog.stmts;
            this.pc = idx;
        }

        lineArg(p) {
            const tk = p.next();
            if (tk.t !== 'num') err('SYNTAX');
            return tk.v;
        }

        /** Skip forward past the block closer matching an already-open block. */
        skipBlock(open, close) {
            let depth = 1;
            for (let i = this.pc; i < this.cur.length; i++) {
                const toks = this.cur[i].toks;
                const head = toks[0] && toks[0].t === 'kw' ? toks[0].v : null;
                if (head === open) depth++;
                else if (head === close || (close === 'WEND' && head === 'END' && toks[1] && toks[1].v === 'WHILE')) {
                    depth -= close === 'NEXT' ? Math.max(1, toks.filter(t => t.t === 'id').length) : 1;
                }
                if (depth <= 0) { this.pc = i + 1; return; }
            }
            err(open === 'FOR' ? 'FOR WITHOUT NEXT' : 'WHILE WITHOUT WEND');
        }

        // ---- expressions ---------------------------------------------------

        expr(p) {
            let a = this.andExpr(p);
            while (p.accept('kw', 'OR')) a = Math.trunc(N(a)) | Math.trunc(N(this.andExpr(p)));
            return a;
        }

        andExpr(p) {
            let a = this.notExpr(p);
            while (p.accept('kw', 'AND')) a = Math.trunc(N(a)) & Math.trunc(N(this.notExpr(p)));
            return a;
        }

        notExpr(p) {
            if (p.accept('kw', 'NOT')) return ~Math.trunc(N(this.notExpr(p)));
            return this.compare(p);
        }

        compare(p) {
            let a = this.additive(p);
            for (;;) {
                const op = p.peek();
                if (op.t !== 'op' || !['=', '<>', '<', '>', '<=', '>='].includes(op.v)) return a;
                p.next();
                const b = this.additive(p);
                if (typeof a !== typeof b) err('TYPE MISMATCH');
                let r;
                switch (op.v) {
                    case '=': r = a === b; break;
                    case '<>': r = a !== b; break;
                    case '<': r = a < b; break;
                    case '>': r = a > b; break;
                    case '<=': r = a <= b; break;
                    default: r = a >= b;
                }
                a = r ? -1 : 0;
            }
        }

        additive(p) {
            let a = this.term_(p);
            for (;;) {
                if (p.accept('op', '+')) {
                    const b = this.term_(p);
                    if (typeof a === 'string' && typeof b === 'string') a += b;
                    else a = N(a) + N(b);
                } else if (p.accept('op', '-')) {
                    a = N(a) - N(this.term_(p));
                } else {
                    return a;
                }
            }
        }

        term_(p) {
            let a = this.unary(p);
            for (;;) {
                if (p.accept('op', '*')) a = N(a) * N(this.unary(p));
                else if (p.accept('op', '/')) {
                    const b = N(this.unary(p));
                    if (b === 0) err('DIVISION BY ZERO');
                    a = N(a) / b;
                } else if (p.accept('kw', 'MOD')) {
                    const b = N(this.unary(p));
                    if (b === 0) err('DIVISION BY ZERO');
                    a = N(a) % b;
                } else return a;
            }
        }

        unary(p) {
            if (p.accept('op', '-')) return -N(this.unary(p));
            if (p.accept('op', '+')) return N(this.unary(p));
            return this.power(p);
        }

        power(p) {
            let a = this.primary(p);
            while (p.accept('op', '^')) a = Math.pow(N(a), N(this.unary(p)));
            return a;
        }

        primary(p) {
            const tk = p.next();
            if (tk.t === 'num' || tk.t === 'str') return tk.v;
            if (tk.t === 'op' && tk.v === '(') {
                const v = this.expr(p);
                p.expect('op', ')');
                return v;
            }
            if (tk.t !== 'id') err('SYNTAX');
            const fn = FUNCS[tk.v];
            if (fn) {
                const args = [];
                if (p.accept('op', '(')) {
                    if (!p.is('op', ')')) {
                        do args.push(this.expr(p)); while (p.accept('op', ','));
                    }
                    p.expect('op', ')');
                }
                if (args.length < fn[0] || args.length > fn[1]) err('SYNTAX');
                return fn[2](args);
            }
            if (p.is('op', '(') || p.is('op', '[')) {
                const { a, off } = this.element(tk.v, this.indices(p));
                return a.data[off];
            }
            const v = this.vars[tk.v];
            return v !== undefined ? v : (tk.v.endsWith('$') ? '' : 0);
        }

        indices(p) {
            const close = p.next().v === '(' ? ')' : ']';
            const idx = [];
            do idx.push(N(this.expr(p))); while (p.accept('op', ','));
            p.expect('op', close);
            return idx;
        }

        dim(name, dims) {
            const size = dims.reduce((s, d) => s * (Math.floor(d) + 1), 1);
            if (dims.some(d => d < 0) || size > 1e6) err('ILLEGAL QUANTITY');
            const a = { dims: dims.map(Math.floor), data: new Array(size).fill(name.endsWith('$') ? '' : 0) };
            this.arrays[name] = a;
            return a;
        }

        element(name, idx) {
            const a = this.arrays[name] || this.dim(name, idx.map(() => 10));
            if (idx.length !== a.dims.length) err('BAD SUBSCRIPT');
            let off = 0;
            idx.forEach((v, k) => {
                const i = Math.floor(v);
                if (i < 0 || i > a.dims[k]) err('BAD SUBSCRIPT');
                off = off * (a.dims[k] + 1) + i;
            });
            return { a, off };
        }

        lvalue(p) {
            const tk = p.next();
            if (tk.t !== 'id' || FUNCS[tk.v]) err('SYNTAX');
            if (p.is('op', '(') || p.is('op', '[')) return { name: tk.v, idx: this.indices(p) };
            return { name: tk.v };
        }

        assign(lv, v) {
            if (lv.name.endsWith('$') !== (typeof v === 'string')) err('TYPE MISMATCH');
            if (lv.idx) {
                const { a, off } = this.element(lv.name, lv.idx);
                a.data[off] = v;
            } else {
                this.vars[lv.name] = v;
            }
        }

        truthy(v) { return v !== 0 && v !== ''; }

        // ---- statements ----------------------------------------------------

        s_REM() {}
        s_DATA() {}
        s_RANDOMIZE() {}

        s_LET(p) {
            const lv = this.lvalue(p);
            p.expect('op', '=');
            const v = this.expr(p);
            p.end();
            this.assign(lv, v);
        }

        s_PRINT(p) {
            let newline = true;
            if (p.accept('kw', 'AT')) {
                const row = N(this.expr(p));
                p.expect('op', ',');
                const col = N(this.expr(p));
                if (!p.accept('op', ',')) p.accept('op', ';');
                this.term.at(row, col);
                newline = false;
                if (p.atEnd()) return;
            }
            while (!p.atEnd()) {
                if (p.accept('op', ';')) { newline = false; continue; }
                if (p.accept('op', ',')) { this.term.zone(); newline = false; continue; }
                newline = true;
                const tk = p.peek();
                if (tk.t === 'id' && (tk.v === 'TAB' || tk.v === 'SPC') && p.peek(1).v === '(') {
                    p.next(); p.next();
                    const n = N(this.expr(p));
                    p.expect('op', ')');
                    if (tk.v === 'TAB') this.term.tabTo(n); else this.term.write(' '.repeat(Math.max(0, n)));
                    newline = false;
                    continue;
                }
                const v = this.expr(p);
                this.term.write(typeof v === 'number' ? fmt(v) : v);
            }
            if (newline) this.term.newline();
        }

        s_INPUT(p) {
            let prompt = '? ';
            if (p.is('str') && p.peek(1).t === 'op' && (p.peek(1).v === ';' || p.peek(1).v === ',')) {
                const text = p.next().v;
                prompt = p.next().v === ';' ? text + '? ' : text;
            }
            const lvs = [];
            do lvs.push(this.lvalue(p)); while (p.accept('op', ','));
            p.end();
            this.term.write(prompt);
            this.pending = { lvs, i: 0, prompt };
            this.state = 'input';
        }

        s_IF(p, st) {
            const cond = this.truthy(this.expr(p));
            if (p.accept('kw', 'GOTO')) {
                const n = this.lineArg(p);
                p.end();
                if (cond) this.jumpToLine(n); else this.pc = st.lineEnd;
                return;
            }
            p.expect('kw', 'THEN');
            p.end();
            if (cond) return;
            // Look for a matching ELSE on this line, else skip to the next line
            let depth = 0;
            for (let i = this.pc; i < st.lineEnd; i++) {
                const head = this.cur[i].toks[0];
                if (head.t !== 'kw') continue;
                if (head.v === 'IF') depth++;
                else if (head.v === 'ELSE' && depth-- === 0) { this.pc = i + 1; return; }
            }
            this.pc = st.lineEnd;
        }

        s_ELSE(p, st) { this.pc = st.lineEnd; }

        s_GOTO(p) {
            const n = this.lineArg(p);
            p.end();
            this.jumpToLine(n);
        }

        s_GOSUB(p) {
            const n = this.lineArg(p);
            p.end();
            this.gosubs.push({ cur: this.cur, pc: this.pc, loops: this.loops.length });
            this.jumpToLine(n);
        }

        s_RETURN(p) {
            p.end();
            const frame = this.gosubs.pop();
            if (!frame) err('RETURN WITHOUT GOSUB');
            this.cur = frame.cur;
            this.pc = frame.pc;
            this.loops.length = frame.loops;
        }

        s_ON(p) {
            const v = Math.floor(N(this.expr(p)));
            const sub = p.accept('kw', 'GOSUB');
            if (!sub) p.expect('kw', 'GOTO');
            const targets = [];
            do targets.push(this.lineArg(p)); while (p.accept('op', ','));
            p.end();
            if (v < 1 || v > targets.length) return;
            if (sub) this.gosubs.push({ cur: this.cur, pc: this.pc, loops: this.loops.length });
            this.jumpToLine(targets[v - 1]);
        }

        s_FOR(p) {
            const lv = this.lvalue(p);
            if (lv.idx || lv.name.endsWith('$')) err('SYNTAX');
            p.expect('op', '=');
            const start = N(this.expr(p));
            p.expect('kw', 'TO');
            const to = N(this.expr(p));
            const step = p.accept('kw', 'STEP') ? N(this.expr(p)) : 1;
            p.end();
            this.vars[lv.name] = start;
            // Re-entering a FOR for the same variable discards the old loop
            const old = this.loops.findLastIndex(l => l.type === 'for' && l.var === lv.name);
            if (old >= 0) this.loops.length = old;
            if (step >= 0 ? start > to : start < to) {
                this.skipBlock('FOR', 'NEXT');
                return;
            }
            this.loops.push({ type: 'for', var: lv.name, to, step, cur: this.cur, pc: this.pc });
        }

        s_NEXT(p) {
            const names = [];
            if (!p.atEnd()) {
                do {
                    const tk = p.next();
                    if (tk.t !== 'id') err('SYNTAX');
                    names.push(tk.v);
                } while (p.accept('op', ','));
            }
            p.end();
            for (const name of names.length ? names : [null]) {
                const idx = this.loops.findLastIndex(l => l.type === 'for' && (name === null || l.var === name));
                if (idx < 0) err('NEXT WITHOUT FOR');
                this.loops.length = idx + 1;
                const loop = this.loops[idx];
                const v = N(this.vars[loop.var]) + loop.step;
                this.vars[loop.var] = v;
                if (loop.step >= 0 ? v <= loop.to : v >= loop.to) {
                    this.cur = loop.cur;
                    this.pc = loop.pc;
                    return;
                }
                this.loops.pop();
            }
        }

        s_WHILE(p) {
            const cond = this.truthy(this.expr(p));
            p.end();
            if (cond) this.loops.push({ type: 'while', cur: this.cur, pc: this.pc - 1 });
            else this.skipBlock('WHILE', 'WEND');
        }

        s_WEND(p) {
            p.end();
            const idx = this.loops.findLastIndex(l => l.type === 'while');
            if (idx < 0) err('WEND WITHOUT WHILE');
            const loop = this.loops[idx];
            this.loops.length = idx;
            this.cur = loop.cur;
            this.pc = loop.pc;
        }

        s_EXIT(p) {
            let type = null;
            if (p.accept('kw', 'FOR')) type = 'for';
            else if (p.accept('kw', 'WHILE')) type = 'while';
            p.end();
            const idx = this.loops.findLastIndex(l => type === null || l.type === type);
            if (idx < 0) err('EXIT WITHOUT LOOP');
            const loop = this.loops[idx];
            this.loops.length = idx;
            this.cur = loop.cur;
            if (loop.type === 'for') {
                this.pc = loop.pc;
                this.skipBlock('FOR', 'NEXT');
            } else {
                this.pc = loop.pc + 1;
                this.skipBlock('WHILE', 'WEND');
            }
        }

        s_END(p) {
            if (p.accept('kw', 'WHILE')) return this.s_WEND(p);
            p.end();
            this.cur = [];
            this.pc = 0;
        }

        s_STOP(p) {
            p.end();
            this.interrupt();
        }

        s_DIM(p) {
            do {
                const tk = p.next();
                if (tk.t !== 'id' || !(p.is('op', '(') || p.is('op', '['))) err('SYNTAX');
                if (this.arrays[tk.v]) err("REDIM'D ARRAY");
                this.dim(tk.v, this.indices(p));
            } while (p.accept('op', ','));
            p.end();
        }

        s_READ(p) {
            const data = this.ensureProg().data;
            do {
                const lv = this.lvalue(p);
                if (this.dataPtr >= data.length) err('OUT OF DATA');
                let v = data[this.dataPtr++].v;
                if (lv.name.endsWith('$') && typeof v === 'number') v = fmt(v);
                this.assign(lv, v);
            } while (p.accept('op', ','));
            p.end();
        }

        s_RESTORE(p) {
            const data = this.ensureProg().data;
            if (p.atEnd()) { this.dataPtr = 0; return; }
            const n = this.lineArg(p);
            p.end();
            const idx = data.findIndex(d => d.line >= n);
            this.dataPtr = idx < 0 ? data.length : idx;
        }

        s_CLS(p) {
            p.end();
            this.term.cls();
            if (this.cur !== (this.prog && this.prog.stmts)) this.quiet = true;
        }

        s_CLEAR(p) {
            p.end();
            this.clearVars();
        }

        s_RUN(p) {
            const start = p.atEnd() ? null : this.lineArg(p);
            p.end();
            this.clearVars();
            this.prog = null;
            const prog = this.ensureProg();
            this.ranProgram = true;
            this.cur = prog.stmts;
            this.pc = 0;
            if (start !== null) this.jumpToLine(start);
        }

        s_CONT(p) {
            p.end();
            if (!this.cont || !this.prog) err("CAN'T CONTINUE");
            this.cur = this.prog.stmts;
            this.pc = this.cont.pc;
            this.cont = null;
            this.ranProgram = true;
        }

        s_LIST(p) {
            let from = 0, to = Infinity;
            if (p.is('num')) from = to = p.next().v;
            if (p.accept('op', '-')) to = p.is('num') ? p.next().v : Infinity;
            p.end();
            const lines = this.lineNumbers().filter(n => n >= from && n <= to);
            this.term.ensureNewline();
            for (const n of lines) this.term.println(`${n} ${this.program[n]}`);
        }

        s_NEW(p) {
            p.end();
            this.program = {};
            this.clearVars();
            this.changed();
            this.cur = [];
            this.pc = 0;
        }

        fileName(p) {
            let name = 'default';
            if (p.is('str')) name = p.next().v;
            else if (p.is('id') || p.is('kw')) name = p.next().v;
            p.end();
            if (!name) err('MISSING FILE NAME');
            return name;
        }

        s_SAVE(p) {
            const name = this.fileName(p);
            const data = JSON.stringify({ program: this.program, variables: {} });
            if (!this.storage.set(STORAGE_PREFIX + name.toLowerCase(), data)) err('SAVE FAILED');
            this.term.println(`SAVED "${name.toUpperCase()}"`);
        }

        s_LOAD(p) {
            const name = this.fileName(p);
            const raw = this.storage.get(STORAGE_PREFIX + name.toLowerCase());
            if (!raw) err('FILE NOT FOUND');
            let parsed;
            try { parsed = JSON.parse(raw); } catch (e) { err('BAD FILE'); }
            this.program = {};
            for (const [n, text] of Object.entries(parsed.program || {})) {
                if (/^\d+$/.test(n) && String(text).trim()) this.program[+n] = normalize(String(text).trim());
            }
            this.clearVars();
            this.changed();
            this.term.println(`LOADED "${name.toUpperCase()}"`);
            this.cur = [];
            this.pc = 0;
        }

        s_KILL(p) {
            const name = this.fileName(p);
            const key = STORAGE_PREFIX + name.toLowerCase();
            if (!this.storage.get(key)) err('FILE NOT FOUND');
            this.storage.remove(key);
        }

        s_FILES(p) {
            p.end();
            const names = this.storage.keys()
                .filter(k => k.startsWith(STORAGE_PREFIX))
                .map(k => k.slice(STORAGE_PREFIX.length).toUpperCase())
                .sort();
            this.term.ensureNewline();
            if (!names.length) this.term.println('NO SAVED PROGRAMS');
            for (const n of names) this.term.println(n);
        }

        s_HELP(p) {
            p.end();
            this.term.ensureNewline();
            [
                'COMMANDS: RUN LIST NEW CLS CONT CLEAR',
                '  SAVE name  LOAD name  KILL name  FILES',
                'STATEMENTS: PRINT [AT r,c;] INPUT LET',
                '  IF..THEN..ELSE  FOR..TO..STEP..NEXT',
                '  WHILE..WEND  EXIT  GOTO  GOSUB',
                '  RETURN  ON..GOTO  DIM  READ  DATA',
                '  RESTORE  REM  END  STOP',
                'FUNCTIONS: ABS SGN INT SQR SIN COS TAN',
                '  ATN LOG EXP RND PI LEN VAL ASC CHR$',
                '  STR$ LEFT$ RIGHT$ MID$ INSTR UCASE$',
                '  LCASE$ STRING$  PRINT: TAB() SPC()',
                'OPERATORS: + - * / ^ MOD = <> < > <= >=',
                '  AND OR NOT     ESC BREAKS A PROGRAM'
            ].forEach(l => this.term.println(l));
        }
    }

    const EXAMPLES = {
        hello: { title: 'Hello World', src: `
10 REM HELLO WORLD
20 CLS
30 PRINT "HELLO, WORLD!"
40 FOR I = 1 TO 8
50 PRINT TAB(I * 2); "BASIC IS FUN"
60 NEXT I` },
        primes: { title: 'Prime Numbers', src: `
10 REM FIRST N PRIME NUMBERS
20 INPUT "HOW MANY PRIMES"; N
30 DIM PR(N)
40 E = 0 : P = 2
50 WHILE E < N
60 F = 0
70 FOR C = 2 TO SQR(P)
80 IF P MOD C = 0 THEN F = 1 : EXIT FOR
90 NEXT C
100 IF F = 0 THEN E = E + 1 : PR(E) = P
110 P = P + 1
120 WEND
130 PRINT "THE FIRST "; N; " PRIMES:"
140 FOR I = 1 TO N : PRINT PR(I); " "; : NEXT I
150 PRINT` },
        factorial: { title: 'Factorial', src: `
10 REM FACTORIAL CALCULATOR
20 INPUT "ENTER A NUMBER (0 TO QUIT)"; N
30 IF N <= 0 THEN END
40 F = 1
50 FOR I = 2 TO N : F = F * I : NEXT I
60 PRINT N; "! = "; F
70 GOTO 20` },
        guess: { title: 'Guess the Number', src: `
10 REM GUESS THE NUMBER
20 S = INT(RND(1) * 100) + 1 : T = 0
30 PRINT "I'M THINKING OF A NUMBER 1-100."
40 INPUT "YOUR GUESS"; G
50 T = T + 1
60 IF G < S THEN PRINT "TOO LOW!" : GOTO 40
70 IF G > S THEN PRINT "TOO HIGH!" : GOTO 40
80 PRINT "CORRECT IN "; T; " TRIES!"` },
        sine: { title: 'Sine Wave', src: `
10 REM SINE WAVE
20 FOR A = 0 TO 6.3 STEP 0.3
30 PRINT TAB(19 + INT(SIN(A) * 18)); "*"
40 NEXT A` },
        mandelbrot: { title: 'Mandelbrot Fractal', src: `
10 REM MANDELBROT SET
20 CLS
30 FOR Y = 0 TO 21
40 FOR X = 0 TO 39
50 CR = X / 13 - 2.2 : CI = Y / 10 - 1.05
60 ZR = 0 : ZI = 0 : K = 0
70 WHILE K < 32 AND ZR * ZR + ZI * ZI < 4
80 T = ZR * ZR - ZI * ZI + CR : ZI = 2 * ZR * ZI + CI : ZR = T : K = K + 1
90 WEND
100 IF K = 32 THEN C$ = "@" ELSE C$ = MID$(" .:-=+*#%", K MOD 9 + 1, 1)
110 PRINT AT Y, X; C$;
120 NEXT X
130 NEXT Y
140 PRINT AT 22, 0;` }
    };

    const api = { Basic, Terminal, BasicError, normalize, tokenize, fmt, EXAMPLES };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.BasicCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
