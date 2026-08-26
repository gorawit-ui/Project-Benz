# Design Canvas — UI Mockups

โฟลเดอร์นี้เก็บ**ไฟล์ต้นฉบับ** (source) ของม็อกอัพ UI 10 artboard สำหรับแอป Expense Tracking ซึ่งเป็น design canvas ที่ตีพิมพ์ไว้แล้วที่:

**https://claude.ai/code/artifact/b6b2ba62-e6ce-48a8-b488-3152cca876b9**

เปิดลิงก์ด้านบนเพื่อดู/ลองเล่นม็อกอัพแบบอินเทอร์แอกทีฟ

## ไฟล์ในโฟลเดอร์นี้

- `Login.dc.html`, `LoginWeb.dc.html` — หน้าล็อกอิน (มือถือ/เว็บ)
- `Main.dc.html` — หน้าหลักสำหรับถ่ายรูป/บันทึกรายการ
- `Review.dc.html` — หน้าตรวจทานรายการ
- `Confirmation.dc.html` — หน้ายืนยันรายการ
- `ReportBug.dc.html` — ปุ่ม/หน้าแจ้งบัค
- `CreateReceiptDoc.dc.html`, `CreateReceiptDocDone.dc.html` — หน้าสร้าง "เอกสารรับเงิน" และหน้าเสร็จสิ้น
- `Dashboard.dc.html` — แดชบอร์ดแสดงยอดใช้จ่ายเรียลไทม์
- `Approver.dc.html` — หน้าสำหรับผู้อนุมัติ/ตรวจทาน
- `canvas.json` — เลย์เอาต์ของ artboard ทั้งหมดบน canvas เดียว (ตำแหน่ง, หน้า, launch view)

ไฟล์เหล่านี้ถูกดึงออกมาจาก artifact ที่ตีพิมพ์ไว้แล้วด้วยตัวช่วย `seed-canvas.mjs --extract` ของ `design` skill เพื่อเก็บไว้ใน version control เท่านั้น **repo นี้ไม่ได้ republish หรือ reseed canvas ใหม่**

## หากต้องแก้ไขม็อกอัพในอนาคต

แก้ไขไฟล์ `.dc.html`/`canvas.json` ในโฟลเดอร์นี้ แล้วใช้ `design` skill's `seed-canvas.mjs` helper เพื่อ seed payload ใหม่และ publish อัปเดตไปยัง artifact เดิมข้างต้น (ดูขั้นตอน "Updating an existing canvas" ใน `design` skill)
