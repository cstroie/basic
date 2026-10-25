'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Basic, Terminal, EXAMPLES } = require('../basic.js');

function memoryStorage() {
    const m = new Map();
    return { get: k => m.get(k) ?? null, set: (k, v) => (m.set(k, v), true), remove: k => m.delete(k), keys: () => [...m.keys()] };
}

/** A terminal that also records everything written to it. */
function recordingTerminal() {
    const t = new Terminal(40, 24, 5000);
    t.log = '';
    const write = t.write.bind(t), newline = t.newline.bind(t);
    t.write = s => { t.log += s; write(s); };
    t.newline = () => { t.log += '\n'; newline(); };
    return t;
}

/**
 * Run commands like a user at the prompt; `inputs` answer INPUT statements.
 * Returns the screen text after the commands, without the echoed commands.
 */
function run(cmds, inputs = [], basic = new Basic(recordingTerminal(), memoryStorage())) {
    const start = basic.term.log.length;
    for (const c of cmds) {
        basic.enter(c);
        for (let guard = 0; ; guard++) {
            const state = basic.runSlice(1000);
            if (state === 'idle') break;
            if (state === 'input') {
                if (!inputs.length) { basic.interrupt(); break; }
                const v = inputs.shift();
                basic.term.println(v);
                basic.provideInput(v);
            }
            if (guard > 1000) { basic.interrupt(); break; }
        }
    }
    return basic.term.log.slice(start).trim();
}

function program(src, inputs) {
    const b = new Basic(recordingTerminal(), memoryStorage());
    b.loadText(src);
    return run(['RUN'], inputs, b);
}

test('arithmetic and precedence', () => {
    assert.equal(run(['PRINT 2+3*4; " "; (2+3)*4; " "; -2^2; " "; 2^-1; " "; 7 MOD 3']), '14 20 -4 0.5 1\nOK');
    assert.equal(run(['A=-3:PRINT 5-A']), '8\nOK');
    assert.equal(run(['PRINT 1/3']), '0.333333333\nOK');
});

test('strings and functions', () => {
    assert.equal(run(['PRINT MID$("HELLO",2,3);LEFT$("ABC",2);RIGHT$("ABC",2);CHR$(65);ASC("A")']), 'ELLABBCA65\nOK');
    assert.equal(run(['A$="AB"+"CD":PRINT A$;LEN(A$);INSTR(A$,"C")']), 'ABCD43\nOK');
    assert.equal(run(['PRINT "A"+1']), '?TYPE MISMATCH ERROR\nREADY.');
});

test('zero-trip FOR skips the body', () => {
    assert.equal(run(['FOR I=5 TO 1:PRINT "BAD":NEXT I:PRINT "DONE"']), 'DONE\nOK');
});

test('nested FOR with NEXT J,I', () => {
    assert.equal(run(['FOR I=1 TO 2:FOR J=1 TO 2:PRINT I*10+J;" ";:NEXT J,I:PRINT']), '11 12 21 22 \nOK');
});

test('IF THEN ELSE only runs one branch, including after colons', () => {
    assert.equal(run(['A=0:IF A THEN PRINT "T":PRINT "T2" ELSE PRINT "F"']), 'F\nOK');
    assert.equal(run(['IF 1 THEN PRINT "Y" ELSE PRINT "N"']), 'Y\nOK');
});

test('GOSUB / RETURN and END', () => {
    assert.equal(program('10 GOSUB 100\n20 PRINT "BACK"\n30 END\n100 PRINT "SUB"\n110 RETURN'), 'SUB\nBACK\nREADY.');
});

test('WHILE / WEND and EXIT', () => {
    assert.equal(program('10 I=0\n20 WHILE I<10\n30 I=I+1\n40 IF I=4 THEN EXIT\n50 WEND\n60 PRINT I'), '4\nREADY.');
});

test('READ / DATA / RESTORE', () => {
    assert.equal(program('10 DATA 1,"HI, YOU",3.5\n20 READ A,B$,C:PRINT A;B$;C\n30 RESTORE:READ D:PRINT D'), '1HI, YOU3.5\n1\nREADY.');
});

test('errors report the line number', () => {
    assert.equal(program('10 PRINT 1/0'), '?DIVISION BY ZERO ERROR IN 10\nREADY.');
    assert.equal(run(['GOTO 999']), "?UNDEF'D STATEMENT ERROR\nREADY.");
});

test('INPUT re-prompts on bad numbers', () => {
    assert.equal(run(['INPUT "NAME";N$,A', 'PRINT N$;A'], ['bob', 'x', 'bob, 4']),
        'NAME? bob\n?? x\n?REDO FROM START\nNAME? bob, 4\nOK\nPRINT N$;A\nbob4\nOK'.replace('PRINT N$;A\n', ''));
});

test('STOP and CONT', () => {
    const b = new Basic(recordingTerminal(), memoryStorage());
    b.loadText('10 PRINT 1\n20 STOP\n30 PRINT 2');
    assert.equal(run(['RUN', 'CONT'], [], b), '1\nBREAK IN 20\nREADY.\n2\nREADY.');
});

test('SAVE, NEW, LOAD round trip', () => {
    const b = new Basic(recordingTerminal(), memoryStorage());
    run(['10 PRINT "X"', 'SAVE demo', 'NEW', 'LOAD "demo"'], [], b);
    assert.equal(b.listing(), '10 PRINT "X"');
});

test('primes.bas (WHILE/END WHILE, EXIT, [] arrays, ==)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../examples/primes.bas'), 'utf8');
    assert.equal(program(src, ['10']).split('\n').slice(2, 12).join(' '), '2 3 5 7 11 13 17 19 23 29');
});

test('every built-in example runs without error', () => {
    const inputs = { primes: ['5'], factorial: ['5', '0'], strings: ['level'], guess: Array.from({ length: 100 }, (_, i) => String(i + 1)) };
    for (const [id, ex] of Object.entries(EXAMPLES)) {
        const b = new Basic(recordingTerminal(), memoryStorage());
        b.keys = ['a', 's', 'x', 'q'];
        b.loadText(ex.src);
        const out = run(['RUN'], [...(inputs[id] || [])], b);
        assert.ok(out.endsWith('READY.'), `${id} did not finish`);
        assert.ok(!out.includes('ERROR'), `${id} failed:\n${out}`);
    }
});

test('example files in examples/ run without error', () => {
    const dir = path.join(__dirname, '../examples');
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.bas'))) {
        const out = program(fs.readFileSync(path.join(dir, f), 'utf8'), Array.from({ length: 100 }, (_, i) => String(i + 1)));
        assert.ok(!out.includes('ERROR'), `${f} failed:\n${out}`);
    }
});

test('DEF FN with one and several parameters', () => {
    assert.equal(run(['DEF FNSQ(X) = X * X : X = 5 : PRINT FNSQ(3); X']), '95\nOK');
    assert.equal(run(['DEF FNH(A, B) = SQR(A * A + B * B) : PRINT FNH(3, 4)']), '5\nOK');
    assert.equal(run(['DEF FNG$(N$) = "HI " + N$ : PRINT FNG$("BOB")']), 'HI BOB\nOK');
    assert.equal(run(['DEF FNA = 42 : PRINT FNA']), '42\nOK');
});

test('INKEY$ is non-blocking; GET waits for a key', () => {
    const b = new Basic(recordingTerminal(), memoryStorage());
    assert.equal(run(['PRINT "[" + INKEY$ + "]"'], [], b), '[]\nOK');
    b.keys.push('Z');
    assert.equal(run(['PRINT INKEY$'], [], b), 'Z\nOK');
    b.enter('GET K$ : PRINT "GOT "; K$');
    assert.equal(b.runSlice(), 'key');
    b.provideKey('m');
    while (b.runSlice() === 'running');
    assert.match(b.term.log, /GOT m/);
    b.keys.push('A');
    assert.equal(run(['GET K : PRINT K'], [], b), '65\nOK');
});

test('SLEEP pauses without blocking', () => {
    const b = new Basic(recordingTerminal(), memoryStorage());
    b.enter('SLEEP 0.02 : PRINT "AWAKE"');
    assert.equal(b.runSlice(), 'sleep');
    const until = Date.now() + 30;
    while (Date.now() < until);
    while (b.runSlice() === 'running');
    assert.match(b.term.log, /AWAKE/);
});

test('RENUM rewrites line references', () => {
    const b = new Basic(recordingTerminal(), memoryStorage());
    b.loadText('5 GOSUB 7\n7 IF A THEN 9 ELSE 5\n9 ON X GOTO 5, 7, 9 : PRINT "GOTO 5" : REM GOTO 7\n11 RESTORE 9');
    run(['RENUM 100, 10'], [], b);
    assert.equal(b.listing(), [
        '100 GOSUB 110',
        '110 IF A THEN 120 ELSE 100',
        '120 ON X GOTO 100, 110, 120 : PRINT "GOTO 5" : REM GOTO 7',
        '130 RESTORE 120'
    ].join('\n'));
});

test('AUTO numbers lines until an empty line', () => {
    const b = new Basic(recordingTerminal(), memoryStorage());
    run(['AUTO 100, 5'], [], b);
    assert.deepEqual(b.auto, { next: 100, step: 5 });
    b.enter('100 PRINT 1');
    assert.equal(b.auto.next, 105);
    b.enter('');
    assert.equal(b.auto, null);
});

test('EDIT puts a line back in the input box', () => {
    const b = new Basic(recordingTerminal(), memoryStorage());
    run(['10 PRINT "HI"', 'EDIT 10'], [], b);
    assert.equal(b.prefill, '10 PRINT "HI"');
});

test('COLOR records per-cell colours', () => {
    const b = new Basic(recordingTerminal(), memoryStorage());
    run(['COLOR 2, 6 : PRINT "RED"; : COLOR -1, -1 : PRINT "X"'], [], b);
    const line = b.term.runs().find(r => r.some(([t]) => t.includes('RED')));
    assert.deepEqual(line[0], ['RED', 2, 6]);
    assert.deepEqual(line[1], ['X', -1, -1]);
    assert.match(run(['COLOR 99'], [], b), /ILLEGAL QUANTITY/);
});

test('graphics and sound call the UI hooks', () => {
    const b = new Basic(recordingTerminal(), memoryStorage());
    const calls = [];
    b.gfx = {
        clear: () => calls.push('clear'),
        plot: (x, y, c) => calls.push(`plot ${x},${y},${c}`),
        line: (a, b2, c, d, col) => calls.push(`line ${a},${b2}-${c},${d},${col}`),
        circle: (x, y, r, c) => calls.push(`circle ${x},${y},${r},${c}`)
    };
    b.audio = { tone: (f, ms) => calls.push(`tone ${f},${ms}`) };
    run(['COLOR 5 : PLOT 10, 20 : DRAW 30, 40 : CIRCLE 50, 60, 7 : GCLS : SOUND 440, 100 : BEEP'], [], b);
    assert.deepEqual(calls, ['plot 10,20,5', 'line 10,20-30,40,5', 'circle 50,60,7,5', 'clear', 'tone 440,100', 'tone 880,150']);
});

test('OPTION CLASSIC pads numbers like MS BASIC', () => {
    assert.equal(run(['OPTION CLASSIC : PRINT 1; -2; "X"']), '1 -2 X\nOK');
});
