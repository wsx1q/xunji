"""Turn screenshots recorded by record_demos.cjs into README GIFs."""
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
frames = ROOT/'desktop/build/demo-frames'
output = ROOT/'docs/demos'
output.mkdir(parents=True, exist_ok=True)
manifest = json.loads((frames/'manifest.json').read_text('utf-8'))
for name, entries in manifest.items():
    images = []
    for entry in entries:
        with Image.open(frames/name/entry['name']) as image:
            image = image.convert('RGB')
            image.thumbnail((1120, 750), Image.Resampling.LANCZOS)
            images.append(image.quantize(colors=128, method=Image.Quantize.MEDIANCUT))
    target = output/f'{name}.gif'
    images[0].save(target, save_all=True, append_images=images[1:],
                   duration=[entry['duration'] for entry in entries], loop=0,
                   optimize=True, disposal=2)
    print(f'{target.name}: {target.stat().st_size/1024:.0f} KiB, {len(images)} frames')
