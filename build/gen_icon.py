#!/usr/bin/env python3
"""生成 Yuhox Board 应用图标 build/icon.png（512x512，圆角方形 + 看板条形）"""
from PIL import Image, ImageDraw

S = 512
R = 112  # 圆角半径
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# 背景：深蓝渐变（对角 3x3 采样手绘渐变）
c1 = (8, 14, 30)
c2 = (21, 48, 102)
grad = Image.new("RGBA", (S, S))
gd = ImageDraw.Draw(grad)
for y in range(S):
    for_x = y / S
    r = int(c1[0] + (c2[0] - c1[0]) * for_x)
    g = int(c1[1] + (c2[1] - c1[1]) * for_x)
    b = int(c1[2] + (c2[2] - c1[2]) * for_x)
    gd.line([(0, y), (S, y)], fill=(r, g, b, 255))
# 稍微斜向：再叠加一个右下角亮斑
glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
gl = ImageDraw.Draw(glow)
gl.ellipse([S * 0.45, S * 0.5, S * 1.3, S * 1.4], fill=(34, 120, 210, 110))
gl.ellipse([-S * 0.2, -S * 0.25, S * 0.5, S * 0.35], fill=(70, 60, 180, 80))
grad = Image.alpha_composite(grad, glow)

mask = Image.new("L", (S, S), 0)
md = ImageDraw.Draw(mask)
md.rounded_rectangle([8, 8, S - 8, S - 8], radius=R, fill=255)
img.paste(grad, (0, 0), mask)

# 看板三列条形（白 → 青，带层次）
d.rounded_rectangle([96, 118, 152, 394], radius=16, fill=(233, 238, 249, 255))
d.rounded_rectangle([216, 118, 272, 320], radius=16, fill=(120, 200, 255, 255))
d.rounded_rectangle([336, 118, 392, 258], radius=16, fill=(34, 211, 238, 255))
# 底部进度条
d.rounded_rectangle([96, 424, 392, 448], radius=12, fill=(79, 140, 255, 255))
d.rounded_rectangle([96, 424, 280, 448], radius=12, fill=(52, 211, 153, 255))

img.save("build/icon.png")

# electron-builder 的 icns/ico 由 png 自动转换；这里再补一份 256
img.resize((256, 256), Image.LANCZOS).save("build/icon-256.png")
print("icon ok")
