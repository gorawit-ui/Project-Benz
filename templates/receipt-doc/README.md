# Receipt Document Generator — เอกสารรับเงิน

โฟลเดอร์นี้สร้างเอกสาร **"เอกสารรับเงิน"** (cash-receipt attestation) ของ TDFB ในรูปแบบไฟล์ Word (`.docx`) จริงที่เปิดได้ปกติ ใช้สำหรับกรณีบิลไม่สมบูรณ์ — เช่น ใบเสร็จจากร้าน 7-Eleven ที่ไม่มีใบกำกับภาษี/ใบเสร็จแบบเป็นทางการ — โดยระบบจะเสนอให้สร้างเอกสารนี้แทนเพื่อเป็นหลักฐานการจ่ายเงิน

## ไฟล์ที่สร้าง

- **`เอกสารรับเงิน - Template (พร้อมแท็ก).docx`** — เทมเพลตที่มีแท็ก `{{payee_name}}`, `{{id_number}}`, `{{expense_detail}}`, `{{amount_number}}`, `{{amount_text}}`, `{{doc_date}}` และ Word **bookmark** ชื่อ `id_card_photo` ที่ทำเครื่องหมายตำแหน่งซึ่งแอปจริงจะแทรกรูปสำเนาบัตรประชาชนของผู้รับเงินเข้าไปแบบโปรแกรม (เช่นผ่าน `python-docx` หรือ Google Docs API) แทนที่แท็กและ bookmark เหล่านี้ด้วยข้อมูลจริง ได้แก่ ชื่อผู้รับเงิน (จาก Google login), เลขบัตรประชาชน, รายละเอียดค่าใช้จ่าย, จำนวนเงินทั้งเป็นตัวเลขและตัวหนังสือไทย (เช่น 202 → "สองร้อยสองบาทถ้วน"), วันที่ปัจจุบัน, และรูปถ่ายบัตรประชาชนที่ตำแหน่ง bookmark
- **`เอกสารรับเงิน - ตัวอย่างกรอกแล้ว.docx`** — ตัวอย่างเอกสารที่กรอกข้อมูลตัวอย่างแล้ว (สาธิตผลลัพธ์การ merge ด้วยข้อมูลจำลอง)

## ข้อจำกัดที่ทราบอยู่แล้ว

โลโก้บริษัท TDFB ในเอกสารยังเป็นกล่อง placeholder เปล่า (`[TDFB LOGO]`) — ต้องแทนที่ด้วยไฟล์รูปโลโก้จริงเมื่อมี (ดู [docs/04-open-items.md](../../docs/04-open-items.md))

## วิธี regenerate

```bash
cd templates/receipt-doc
npm install docx
pip install pillow
python3 generate_sample_id_card.py   # สร้างรูปตัวอย่างบัตร (ใช้แทน ID card จริงเฉพาะตอน build ตัวอย่าง)
node build.js                        # สร้างไฟล์ .docx ทั้งสอง
```

ตรวจสอบไฟล์ที่ได้ด้วย `python-docx`:

```bash
pip install python-docx
python3 -c "import docx; d=docx.Document('เอกสารรับเงิน - ตัวอย่างกรอกแล้ว.docx'); print([p.text for p in d.paragraphs if p.text.strip()])"
```
