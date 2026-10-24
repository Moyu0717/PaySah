# Synthetic receipt images

Seven original generated PNGs cover normal, partial, wrong recipient, scheduled, money request, missing independent credit and high-value cases. All fields are fictional. Run npm run fixtures:images to regenerate. Run npm run eval:ocr to create a local OCR report; reports are not part of the published source. Screenshot content alone is never payment confirmation.

Channel demonstrations also have DEMO-A-TG1 (RM45.00), DEMO-A-TG2 (RM62.50) and DEMO-A-GF1 (RM88.00), with dedicated synthetic orders and BOOKED credits from seed 004. Each can be confirmed once; do not confirm before recording. Seed replays preserve used states. Run npx tsx scripts/fixtures/check.ts to check these three images with CPU OCR.
