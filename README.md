# BASIC Interpreter

A classic 8-bit style BASIC interpreter that runs entirely in the browser. It has a 40×24 character CRT screen with green, amber and white phosphor themes.

## Usage

Open `index.html` in a browser. No server or build step is needed.

- Type a numbered line (`10 PRINT "HI"`) to store it. A bare line number (`10`) deletes that line.
- Type a line without a number to run it immediately (`PRINT 2+2`, `FOR I=1 TO 3:PRINT I:NEXT`).
- Use the **Examples** menu to load a sample program, then type `RUN`.
- Press `Esc` or `Ctrl+C`, or click **STOP**, to break a running program. `CONT` resumes it.
- `↑`/`↓` scroll through command history. Pasting a multi-line listing enters every line.
- **OPEN** / **DOWNLOAD** read and write `.bas` files. You can also drop a `.bas` file on the screen.
- The current program is saved automatically and restored on your next visit.

## Language

| Area | Supported |
|------|-----------|
| Commands | `RUN [line]`, `LIST [a-b]`, `NEW`, `CLS`, `CONT`, `CLEAR`, `SAVE name`, `LOAD name`, `KILL name`, `FILES`, `HELP` |
| Statements | `PRINT` (`;` `,` `TAB()` `SPC()`, `PRINT AT row,col;`), `INPUT ["prompt";] a, b$`, `LET` (optional), `IF … THEN … ELSE`, `FOR … TO … STEP` / `NEXT`, `WHILE` / `WEND` (or `END WHILE`), `EXIT [FOR\|WHILE]`, `GOTO`, `GOSUB` / `RETURN`, `ON x GOTO/GOSUB`, `DIM`, `READ` / `DATA` / `RESTORE`, `END`, `STOP`, `REM` / `'`, `?` (short for `PRINT`) |
| Functions | `ABS SGN INT SQR SIN COS TAN ATN LOG EXP RND PI LEN VAL ASC CHR$ STR$ LEFT$ RIGHT$ MID$ INSTR UCASE$ LCASE$ STRING$` |
| Operators | `+ - * / ^ MOD`, `= == <> < > <= >=`, `AND OR NOT`, `+` joins strings |

- Separate statements on one line with `:`.
- Variables whose names end in `$` hold strings. Arrays can be indexed with `A(i)` or `A[i]`, and an array used without `DIM` gets 0..10.
- `SAVE`/`LOAD` store programs in the browser's localStorage. The name can be quoted or not.

## Layout

- `basic.js` holds the interpreter core: tokenizer, expression parser, statement executor, character-grid terminal and example programs. It does not touch the DOM, so it can also run under Node.
- `index.html` holds the user interface.

## License

MIT License
