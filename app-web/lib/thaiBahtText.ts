/**
 * Converts a number into Thai baht words, e.g. 202 -> "สองร้อยสองบาทถ้วน",
 * 1250 -> "หนึ่งพันสองร้อยห้าสิบบาทถ้วน".
 *
 * Implements the standard Thai digit-reading algorithm:
 * - place values read right-to-left: หน่วย, สิบ, ร้อย, พัน, หมื่น, แสน, (ล้าน groups repeat)
 * - the ones digit is "เอ็ด" instead of "หนึ่ง" whenever there is more than one digit
 * - the tens digit "2" reads as "ยี่สิบ" instead of "สองสิบ", and "1" reads as "สิบ" (no digit word)
 *
 * Correct for any non-negative amount; amounts under 1,000,000 baht (the
 * expected range for expense records) are the primary target but numbers
 * with more than one "ล้าน" group are handled too via recursion.
 */

const DIGIT_TEXT = [
  "ศูนย์",
  "หนึ่ง",
  "สอง",
  "สาม",
  "สี่",
  "ห้า",
  "หก",
  "เจ็ด",
  "แปด",
  "เก้า",
];

// Index = place value counted from the right within a 6-digit group:
// 0 = หน่วย, 1 = สิบ, 2 = ร้อย, 3 = พัน, 4 = หมื่น, 5 = แสน
const PLACE_TEXT = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"];

/** Reads a non-negative integer 0-999999 as Thai text (no "บาท" suffix). */
function readSixDigitGroup(n: number): string {
  if (n === 0) return "";
  const digits = String(n);
  const len = digits.length;
  let result = "";

  for (let i = 0; i < len; i++) {
    const digit = Number(digits[i]);
    const place = len - i - 1; // 0 = units, 1 = tens, ...
    if (digit === 0) continue;

    if (place === 0) {
      result += digit === 1 && len > 1 ? "เอ็ด" : DIGIT_TEXT[digit];
    } else if (place === 1) {
      if (digit === 1) {
        result += "สิบ";
      } else if (digit === 2) {
        result += "ยี่สิบ";
      } else {
        result += DIGIT_TEXT[digit] + "สิบ";
      }
    } else {
      result += DIGIT_TEXT[digit] + PLACE_TEXT[place];
    }
  }

  return result;
}

/** Reads any non-negative integer as Thai text, recursing through ล้าน groups. */
function readInteger(n: number): string {
  if (n === 0) return DIGIT_TEXT[0];

  let result = "";
  let remaining = n;

  if (remaining >= 1_000_000) {
    const millions = Math.floor(remaining / 1_000_000);
    result += readInteger(millions) + "ล้าน";
    remaining = remaining % 1_000_000;
    if (remaining === 0) return result;
  }

  result += readSixDigitGroup(remaining);
  return result;
}

/**
 * Converts a monetary amount (baht, may have satang/decimal part) into Thai
 * baht text, e.g. numberToThaiBahtText(202) -> "สองร้อยสองบาทถ้วน".
 */
export function numberToThaiBahtText(amount: number): string {
  if (!Number.isFinite(amount)) return "";

  const negative = amount < 0;
  // Round to the nearest satang first to avoid floating point drift
  // (e.g. 1250.1 - 1250 producing 0.09999999999).
  const totalSatang = Math.round(Math.abs(amount) * 100);
  const baht = Math.floor(totalSatang / 100);
  const satang = totalSatang % 100;

  let text = readInteger(baht) + "บาท";
  text += satang === 0 ? "ถ้วน" : readInteger(satang) + "สตางค์";

  return (negative ? "ลบ" : "") + text;
}
