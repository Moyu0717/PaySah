# Team synthetic receipts

Channel demonstrations use `receipts/images/DEMO-A-TG1.png` (RM45.00), `DEMO-A-TG2.png` (RM62.50), and `DEMO-A-GF1.png` (RM88.00), with matching orders and independent synthetic BOOKED credits from seed 004. These three orders are only for channel demonstrations: each can be confirmed once; **do not confirm them before recording the video**. Re-running seed preserves used states and does not replenish credits. DEMO-A-128/780 are not channel test targets.

Generate only these images with `npx tsx scripts/fixtures/generate-intake.ts`; verify with `npx tsx scripts/fixtures/check.ts` (real local CPU OCR, no GPU/key/network). `receipts/images/expected.json` records expected fields and image SHA-256. The existing generator and old fixture bytes are unchanged. These files contain no bank connection or real payment evidence.
