"""Build retention must preserve flavors, unrelated files and the previous release."""
import subprocess
import tempfile
import unittest
from pathlib import Path


class RetentionTests(unittest.TestCase):
    def test_dist_retention(self):
        script = Path(__file__).resolve().parents[2] / 'tools' / 'prune_dist.ps1'
        with tempfile.TemporaryDirectory(prefix='xunji-retention-') as directory:
            dist = Path(directory)
            names = ['README.md', 'unrelated.exe']
            for version in ['20261013.1000', '20261014.1000', '20261015.1000']:
                names += [f'xunji-desktop-{version}.exe', f'xunji-desktop-{version}.sha256.txt']
            for name in names:
                (dist / name).touch()
            (dist / 'standalone').mkdir()
            (dist / 'standalone' / 'old.exe').touch()

            def prune(*args):
                subprocess.run(['powershell', '-NoProfile', '-File', str(script),
                                '-Dist', str(dist), *args], check=True, capture_output=True)

            prune('-Keep', '1', '-WhatIf')
            self.assertEqual(len(list(dist.iterdir())), len(names) + 1)
            prune()
            self.assertFalse(any('20261013' in p.name for p in dist.iterdir()))
            for version in ['20261014.1000', '20261015.1000']:
                self.assertTrue((dist / f'xunji-desktop-{version}.exe').exists())
                self.assertTrue((dist / f'xunji-desktop-{version}.sha256.txt').exists())
            prune('-Keep', '1')
            self.assertFalse(any('20261014' in p.name for p in dist.iterdir()))
            for name in ['README.md', 'unrelated.exe', 'standalone/old.exe']:
                self.assertTrue((dist / name).exists())


if __name__ == '__main__':
    unittest.main()
