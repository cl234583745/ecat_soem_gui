from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "build"
SCALE = 4
SIZE = 512


def draw_icon(size: int) -> Image.Image:
    image = Image.new("RGBA", (size * SCALE, size * SCALE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    width = size * SCALE
    draw.rounded_rectangle(
        (0, 0, width - 1, width - 1),
        radius=int(width * 0.16),
        fill="#1B2429",
    )
    bars = [
        (0.255, 0.54, 0.11, 0.22),
        (0.445, 0.29, 0.11, 0.47),
        (0.635, 0.41, 0.11, 0.35),
    ]
    for x, y, bar_width, bar_height in bars:
        draw.rounded_rectangle(
            (
                int(width * x),
                int(width * y),
                int(width * (x + bar_width)),
                int(width * (y + bar_height)),
            ),
            radius=int(width * 0.018),
            fill="#58C7B9",
        )
    return image.resize((size, size), Image.Resampling.LANCZOS)


OUTPUT.mkdir(parents=True, exist_ok=True)
icon = draw_icon(SIZE)
icon.save(OUTPUT / "icon.png")
icon.save(
    OUTPUT / "icon.ico",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)
print(f"Generated {OUTPUT / 'icon.png'} and {OUTPUT / 'icon.ico'}")
