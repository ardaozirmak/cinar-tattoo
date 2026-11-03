"""Builds the seed images of public/seed/ from the source photos and the shop's logo.

Usage: python -I dev/seed-images.py <srcDir> <cropDir> <publicDir>

  srcDir    the Dergi prototype's folder: s-w01.jpg ... s-w30.jpg, s-k01.jpg, s-k02.jpg and
            logo-yeni.jpg
  cropDir   the folder of the five earlier crops: is-chicano-kol.jpg ... is-gobek-piercing.jpg

Every seed photo (and the logo, the default hero) gets two files:
  <publicDir>/seed/<seed_path>-full.jpg   the image at its own size, quality 85 (the logo: see below)
  <publicDir>/seed/<seed_path>-thumb.jpg  at most 640 px on the long side, quality 80
Both are RGB and progressive, and carry no EXIF; the full file is also optimized. A source whose
size is not the one SEED_PHOTOS / DEFAULT_HERO (functions/_lib/defaults.js) records stops the
script with exit code 1, because the page writes those sizes into width and height.

The logo is the hero, so its full file has a byte budget (LOGO_MAX_BYTES, 330 KiB). It starts at
quality 82 and steps down one at a time until the file fits. The AI-drawn logo is so detailed that
quality 82 gives about 456 KiB; the fitting quality (61) looks the same at 100 % and keeps
every edge sharp, because it is compression, not a resize or a blur.
"""
import io
import os
import sys

from PIL import Image

THUMB_MAX = 640
FULL_QUALITY = 85
LOGO_QUALITY = 82
LOGO_MIN_QUALITY = 50
LOGO_MAX_BYTES = 330 * 1024
THUMB_QUALITY = 80

# The work photos, in the order of SEED_PHOTOS. Each is s-<id>.jpg in srcDir, 400 x 711.
WORKS = ['w03', 'k01', 'w01', 'w04', 'w05', 'w07', 'w06', 'w09', 'w13', 'w10', 'k02', 'w02', 'w08', 'w11', 'w12'] + [
    f'w{n:02d}' for n in range(14, 31)
]

# The five earlier crops: seed_path -> (width, height). Each is is-<seed_path>.jpg in cropDir.
CROPS = {
    'chicano-kol': (475, 797),
    'renkli-gul': (463, 800),
    'kurt': (487, 790),
    'yazi-gogus': (502, 641),
    'gobek-piercing': (477, 811),
}


def sources(src_dir, crop_dir):
    """(seed_path, source file, width, height, full quality) for every seed image."""
    items = [(work, os.path.join(src_dir, f's-{work}.jpg'), 400, 711, FULL_QUALITY) for work in WORKS]
    items += [(name, os.path.join(crop_dir, f'is-{name}.jpg'), w, h, FULL_QUALITY) for name, (w, h) in CROPS.items()]
    items.append(('logo', os.path.join(src_dir, 'logo-yeni.jpg'), 1254, 1254, None))
    return items


def thumb_size(width, height):
    scale = min(1, THUMB_MAX / max(width, height))
    return round(width * scale), round(height * scale)


def jpeg_bytes(image, quality):
    buffer = io.BytesIO()
    image.save(buffer, 'JPEG', quality=quality, progressive=True, optimize=True)
    return buffer.getvalue()


def logo_bytes(image):
    """The logo at the highest quality from LOGO_QUALITY down that fits LOGO_MAX_BYTES, or None."""
    for quality in range(LOGO_QUALITY, LOGO_MIN_QUALITY - 1, -1):
        data = jpeg_bytes(image, quality)
        if len(data) <= LOGO_MAX_BYTES:
            return quality, data
    return None


def main(argv):
    if len(argv) != 4:
        print('usage: python -I dev/seed-images.py <srcDir> <cropDir> <publicDir>', file=sys.stderr)
        return 2
    src_dir, crop_dir, public_dir = argv[1:]
    items = sources(src_dir, crop_dir)

    # Check every size first, so that a wrong file leaves public/seed/ as it was.
    for seed_path, path, width, height, _ in items:
        if not os.path.isfile(path):
            print(f'{path} is missing (needed for {seed_path})', file=sys.stderr)
            return 1
        with Image.open(path) as source:
            if source.size != (width, height):
                print(f'{path} is {source.size[0]}x{source.size[1]}, expected {width}x{height} for {seed_path}', file=sys.stderr)
                return 1

    out_dir = os.path.join(public_dir, 'seed')
    os.makedirs(out_dir, exist_ok=True)
    for seed_path, path, width, height, quality in items:
        with Image.open(path) as source:
            image = source.convert('RGB')
        # A fresh image carries no metadata, so nothing of the source's EXIF reaches the files.
        clean = Image.new('RGB', image.size)
        clean.paste(image)
        if quality is None:
            fitted = logo_bytes(clean)
            if fitted is None:
                print(f'{path} does not fit {LOGO_MAX_BYTES} bytes at quality {LOGO_MIN_QUALITY}', file=sys.stderr)
                return 1
            quality, data = fitted
        else:
            data = jpeg_bytes(clean, quality)
        with open(os.path.join(out_dir, f'{seed_path}-full.jpg'), 'wb') as file:
            file.write(data)
        small = clean.resize(thumb_size(width, height), Image.LANCZOS)
        small.save(os.path.join(out_dir, f'{seed_path}-thumb.jpg'), 'JPEG', quality=THUMB_QUALITY, progressive=True, optimize=True)
        print(f'{seed_path}: {width}x{height} at quality {quality} ({len(data)} bytes), thumb {small.size[0]}x{small.size[1]}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
