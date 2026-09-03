/**
 * Turns a failed /api/ocr response status into something the person holding
 * the phone can act on.
 *
 * This exists because the failures that actually happen in production don't
 * come back as JSON: a Vercel timeout (504) or an over-4.5MB body (413) is
 * answered by the platform with an HTML error page, so `json.error` is
 * undefined and every one of them used to surface as the same generic
 * "อ่านข้อมูลจากใบเสร็จไม่สำเร็จ". That made a timeout, a too-big photo and a
 * Gemini quota block indistinguishable from each other — both for the user
 * and for whoever had to debug it afterwards.
 */
export function ocrHttpErrorMessage(status: number): string {
  switch (status) {
    case 413:
      return "ไฟล์ใหญ่เกินไป (เกิน 4.5MB) — ลองถ่ายใหม่หรือย่อรูปก่อน";
    case 429:
      return "ระบบอ่านบิลใช้งานเกินโควตาช่วงนี้ — รอสักครู่แล้วลองใหม่ หรือกรอกข้อมูลเอง";
    case 504:
    case 408:
      return "อ่านข้อมูลนานเกินไป (หมดเวลา) — ลองใหม่อีกครั้ง หรือกรอกข้อมูลเอง";
    case 401:
    case 403:
      return "เซสชันหมดอายุ — กรุณาเข้าสู่ระบบใหม่";
    default:
      return `อ่านข้อมูลจากใบเสร็จไม่สำเร็จ (error ${status}) — กรอกข้อมูลเองได้`;
  }
}
