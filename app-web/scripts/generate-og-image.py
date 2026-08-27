"""
Regenerates public/og-image.png — the link-preview card LINE/Slack/etc. show
when someone shares a link to this app.

Composited as a plain static PNG rather than a Next.js opengraph-image route
(next/og's ImageResponse): the card is identical for every page, so a static
file avoids an edge function and, more importantly, avoids fetching a Thai
font over the network on every request. The Sarabun font used here is
already vendored in assets/fonts/ for exactly this kind of offline build.

Run from the app-web/ directory: python3 scripts/generate-og-image.py
Requires Pillow (pip install pillow).
"""
from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
BG = (250, 250, 249)       # zinc-50, matches the app's own background
GREEN = (6, 95, 70)        # emerald-800, brand
GRAY = (113, 113, 122)     # zinc-500

canvas = Image.new("RGB", (W, H), BG)
draw = ImageDraw.Draw(canvas)

# Soft mint accent panel so the illustration doesn't float on bare background.
draw.rounded_rectangle([40, 60, 560, H - 60], radius=32, fill=(209, 250, 229))

ledger = Image.open("assets/ledger-illustration.png").convert("RGBA")
target_w = 460
target_h = round(ledger.height * target_w / ledger.width)
ledger = ledger.resize((target_w, target_h), Image.LANCZOS)
lx = 40 + (520 - target_w) // 2
ly = 60 + ((H - 120) - target_h) // 2
canvas.paste(ledger, (lx, ly), ledger)

bold = ImageFont.truetype("assets/fonts/Sarabun-Bold.ttf", 56)
reg = ImageFont.truetype("assets/fonts/Sarabun-Regular.ttf", 28)

tx = 610
draw.text((tx, 220), "TDFB Expense", font=bold, fill=GREEN)
draw.text((tx, 285), "Tracking", font=bold, fill=GREEN)
draw.text((tx, 375), "ระบบบันทึกและติดตามค่าใช้จ่าย", font=reg, fill=GRAY)
draw.text((tx, 412), "เงินสดย่อย / เงินทดรองจ่าย ของทีม", font=reg, fill=GRAY)

canvas.save("public/og-image.png", optimize=True)
print("wrote public/og-image.png", canvas.size)
