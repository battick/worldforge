"""临时：把截图裁一小块放大，用来评细节（Read 工具会去重，整页图看第二遍会被当成同一张）。

用法：python .dev/crop.py <src> <dst> <x> <y> <w> <h> [scale]
坐标按**截图像素**给（截图是 CSS px 乘 0.7）。
"""
import sys
from PIL import Image

src, dst, x, y, w, h = sys.argv[1], sys.argv[2], *map(int, sys.argv[3:7])
scale = float(sys.argv[7]) if len(sys.argv) > 7 else 3.0
im = Image.open(src).crop((x, y, x + w, y + h))
im = im.resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS)
im.save(dst)
print(dst, im.size)
