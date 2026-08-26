from PIL import Image, ImageDraw, ImageFont
w, h = 600, 380
img = Image.new('RGB', (w, h), (235, 240, 245))
d = ImageDraw.Draw(img)
d.rectangle([0,0,w-1,h-1], outline=(90,120,150), width=6)
d.rectangle([20,20,w-21,h-21], outline=(150,170,190), width=2)
try:
    font = ImageFont.load_default(size=28)
    font2 = ImageFont.load_default(size=18)
except Exception:
    font = ImageFont.load_default()
    font2 = font
d.text((w/2, h/2-30), 'ตัวอย่างรูปสำเนา', fill=(60,80,100), anchor='mm', font=font)
d.text((w/2, h/2+10), 'บัตรประชาชน (SAMPLE)', fill=(60,80,100), anchor='mm', font=font)
d.text((w/2, h/2+50), 'ภาพจริงจะถูกแทนที่ตรงนี้', fill=(120,130,140), anchor='mm', font=font2)
img.save('sample_id_card.png')
