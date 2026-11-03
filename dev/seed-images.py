"""Builds the gallery's seed images in public/seed/ from the photos the owner picked.

Usage: python -I dev/seed-images.py <galleryDir> <publicDir>

  galleryDir  a folder with the three folders the owner filled on 2026-11-03: kalıcı/, geçici/ and
              piercing/, each holding Instagram screenshots named
              "Ekran görüntüsü 2026-11-03 HHMMSS.png"
  publicDir   the site's public/ folder

GALLERY (below) lists every seed photo: its seed_path, its folder, the time stamp in its file name
and how many pixels to cut off its top (a customer's face). Every photo also loses EDGE pixels on
each side: a screenshot carries a thin line of the phone's interface along its edges.

Every seed photo gets two files:
  <publicDir>/seed/<seed_path>-full.jpg   the cropped image at its own size, quality 85
  <publicDir>/seed/<seed_path>-thumb.jpg  at most 640 px on the long side, quality 80
Both are RGB and progressive, and carry no EXIF; the full file is also optimized. The script prints
each photo's final size: SEED_PHOTOS (functions/_lib/defaults.js) must record the same, because
the page writes those sizes into width and height.

The logo (seed/logo-*.jpg, the default hero) is not made here: it is the owner's own logo with the
photo behind it masked out (docs/ILERLEME.md, 2026-11-03).
"""
import io
import os
import sys

from PIL import Image

THUMB_MAX = 640
FULL_QUALITY = 85
THUMB_QUALITY = 80
EDGE = 3
PREFIX = 'Ekran görüntüsü 2026-11-03 '

# (seed_path, folder, time stamp, pixels cut off the top), in the order of SEED_PHOTOS.
GALLERY = [
    ('gecici-06', 'geçici', '153112', 0),
    ('kalici-07', 'kalıcı', '153821', 0),
    ('piercing-08', 'piercing', '154644', 0),
    ('gecici-02', 'geçici', '153011', 0),
    ('kalici-03', 'kalıcı', '153618', 0),
    ('piercing-04', 'piercing', '154307', 0),
    ('gecici-08', 'geçici', '153328', 0),
    ('kalici-08', 'kalıcı', '153903', 0),
    ('piercing-01', 'piercing', '154037', 0),
    ('gecici-10', 'geçici', '154912', 0),
    ('kalici-09', 'kalıcı', '155020', 0),
    ('piercing-05', 'piercing', '154339', 0),
    ('gecici-03', 'geçici', '153021', 0),
    ('kalici-02', 'kalıcı', '153551', 0),
    ('piercing-02', 'piercing', '154056', 0),
    ('gecici-05', 'geçici', '153104', 0),
    ('kalici-01', 'kalıcı', '153544', 0),
    ('piercing-07', 'piercing', '154612', 0),
    ('gecici-07', 'geçici', '153133', 0),
    ('kalici-06', 'kalıcı', '153729', 0),
    ('piercing-09', 'piercing', '154849', 0),
    ('gecici-04', 'geçici', '153051', 0),
    ('kalici-04', 'kalıcı', '153636', 0),
    ('piercing-03', 'piercing', '154253', 0),
    ('gecici-09', 'geçici', '153339', 0),
    ('kalici-05', 'kalıcı', '153701', 0),
    ('piercing-06', 'piercing', '154552', 0),
    ('gecici-01', 'geçici', '152954', 150),
]


def thumb_size(width, height):
    scale = min(1, THUMB_MAX / max(width, height))
    return round(width * scale), round(height * scale)


def jpeg_bytes(image, quality):
    buffer = io.BytesIO()
    image.save(buffer, 'JPEG', quality=quality, progressive=True, optimize=True)
    return buffer.getvalue()


def main(argv):
    if len(argv) != 3:
        print('usage: python -I dev/seed-images.py <galleryDir> <publicDir>', file=sys.stderr)
        return 2
    gallery_dir, public_dir = argv[1:]
    items = [(seed_path, os.path.join(gallery_dir, folder, f'{PREFIX}{stamp}.png'), top) for seed_path, folder, stamp, top in GALLERY]
    missing = [path for _, path, _ in items if not os.path.isfile(path)]
    if missing:
        print('missing: ' + ', '.join(missing), file=sys.stderr)
        return 1

    out_dir = os.path.join(public_dir, 'seed')
    os.makedirs(out_dir, exist_ok=True)
    for seed_path, path, top in items:
        with Image.open(path) as source:
            image = source.convert('RGB')
        width, height = image.size
        image = image.crop((EDGE, EDGE + top, width - EDGE, height - EDGE))
        # A fresh image carries no metadata, so nothing of the source's EXIF reaches the files.
        clean = Image.new('RGB', image.size)
        clean.paste(image)
        data = jpeg_bytes(clean, FULL_QUALITY)
        with open(os.path.join(out_dir, f'{seed_path}-full.jpg'), 'wb') as file:
            file.write(data)
        small = clean.resize(thumb_size(*clean.size), Image.LANCZOS)
        small.save(os.path.join(out_dir, f'{seed_path}-thumb.jpg'), 'JPEG', quality=THUMB_QUALITY, progressive=True, optimize=True)
        print(f'{seed_path} {clean.size[0]} {clean.size[1]}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
