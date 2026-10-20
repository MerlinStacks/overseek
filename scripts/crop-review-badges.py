"""Extract the supplied 4x3 badge sheet. Run with: uv run --with pillow python scripts/crop-review-badges.py."""

from collections import deque
from pathlib import Path

from PIL import Image, ImageFilter


ASSETS = Path(__file__).resolve().parents[1] / "overseek-wc-plugin/assets/review-badges"
NAMES = [
    "transparency-bronze", "transparency-silver", "transparency-gold", "transparency-platinum",
    "verified-5", "verified-25", "verified-500", "verified-750",
    "verified-1000", "verified-1500", "verified-3000", "verified-5000",
]


def extract(cell):
    """Remove cream fields inside and outside without erasing ribbon lettering."""
    cell = cell.convert("RGBA")
    width, height = cell.size
    pixels = cell.load()
    queue = deque(
        [(x, y) for x in range(width) for y in (0, height - 1)]
        + [(x, y) for y in range(height) for x in (0, width - 1)]
    )
    visited = set()
    while queue:
        x, y = queue.popleft()
        if (x, y) in visited or not (0 <= x < width and 0 <= y < height):
            continue
        visited.add((x, y))
        red, green, blue, alpha = pixels[x, y]
        if min(red, green, blue) < 180:
            continue
        pixels[x, y] = (red, green, blue, 0)
        queue.extend(((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)))
    # Find cream regions separately from the coloured metal. Large enclosed
    # regions are the badge backing; small regions on the ribbon are lettering.
    def cream(x, y):
        red, green, blue, alpha = pixels[x, y]
        return alpha > 0 and min(red, green, blue) >= 200 and max(red, green, blue) - min(red, green, blue) <= 28 and blue <= red + 6

    visited = set()
    for y in range(height):
        for x in range(width):
            if (x, y) in visited or not cream(x, y):
                continue
            region = []
            queue = deque([(x, y)])
            while queue:
                px, py = queue.popleft()
                if not (0 <= px < width and 0 <= py < height) or (px, py) in visited:
                    continue
                visited.add((px, py))
                if not cream(px, py):
                    continue
                region.append((px, py))
                queue.extend(((px - 1, py), (px + 1, py), (px, py - 1), (px, py + 1)))
            for px, py in region:
                # Also remove cream counters inside the main lettering, but
                # retain small cream highlights on the metal and the ribbon.
                in_face = py < height * .70 and ((px - width * .55) / (width * .34)) ** 2 + ((py - height * .47) / (height * .32)) ** 2 < 1
                if len(region) > 400 or in_face:
                    red, green, blue, alpha = pixels[px, py]
                    pixels[px, py] = (red, green, blue, 0)
    # Trim the pale antialiased fringe left by the original cream backdrop.
    cell.putalpha(cell.getchannel("A").filter(ImageFilter.MinFilter(3)))
    cell = cell.crop(cell.getbbox())
    cell.thumbnail((456, 456), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (480, 480))
    canvas.alpha_composite(cell, ((480 - cell.width) // 2, (480 - cell.height) // 2))
    return canvas


def main():
    source = Image.open(ASSETS / "source.png")
    for index, name in enumerate(NAMES):
        row, column = divmod(index, 4)
        cell = source.crop((
            round(column * source.width / 4), round(row * source.height / 3),
            round((column + 1) * source.width / 4), round((row + 1) * source.height / 3),
        ))
        badge = extract(cell)
        assert badge.getpixel((0, 0))[3] == 0, name
        assert badge.getchannel("A").crop((150, 140, 330, 320)).histogram()[0] > 5000, name
        badge.save(ASSETS / f"{name}.webp", quality=90, method=6)
        print(f"Saved {name}.webp")


if __name__ == "__main__":
    main()
