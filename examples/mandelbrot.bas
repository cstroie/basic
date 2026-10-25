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
140 PRINT AT 22, 0;
