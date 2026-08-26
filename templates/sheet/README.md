# Google Sheet Templates

โฟลเดอร์นี้เก็บสคริปต์ Python (ใช้ `openpyxl`) สำหรับสร้างไฟล์ Excel/Google Sheet template สองไฟล์:

- **`คุยกับพี่ป๊อป_Expense Tracking.xlsx`** — checklist คำถามที่ต้องเอาไปคุยกับป๊อป (domain expert ผู้คีย์ข้อมูลเข้า Odoo ปัจจุบัน) ก่อนเริ่มออกแบบระบบต่อ มีช่องให้จดคำตอบระหว่างคุย และมีชีทแยกสำหรับจดรายการหมวดหมู่/ผังบัญชี Odoo จริง
- **`TDFB Expense Tracking - Sheet Template.xlsx`** — เลย์เอาต์ Google Sheet จริงที่แอปจะซิงก์ข้อมูลเข้าไป ตรงกับ data schema 25 คอลัมน์ของแอป (ดู [`docs/03-data-schema.md`](../../docs/03-data-schema.md)) แบ่งกลุ่มคอลัมน์ด้วยสี พร้อมแถวตัวอย่างและชีทคำอธิบายกลุ่มคอลัมน์

## วิธี regenerate

```bash
cd templates/sheet
pip install openpyxl
python3 build_pop_checklist.py
python3 build_expense_tracking_sheet.py
```

ไฟล์ `.xlsx` ทั้งสองจะถูกสร้าง/เขียนทับในโฟลเดอร์นี้
