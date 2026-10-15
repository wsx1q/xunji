import sys
import unittest
import tempfile
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fast_rec import IndexedDecoder

class FastDecoderTests(unittest.TestCase):
    def test_compact_dictionary_ctc_amount_and_chinese(self):
        with tempfile.TemporaryDirectory() as directory:
            keys=Path(directory)/'keys.txt'
            keys.write_text('支\n出\n1\n.\n8\n0\n',encoding='utf-8')
            decoder=IndexedDecoder(keys)
        chars=decoder.decoder.character
        # CTC removes repeated tokens only when they are adjacent, and ignores
        # blank tokens. The compact dictionary must agree with the model's IDs.
        text='支出11.80'
        tokens=[0]
        for char in text:
            index=chars.index(char)
            tokens.extend([index,index,0])
        result,_=decoder((np.array([tokens]),np.full((1,len(tokens)),.9)))
        self.assertEqual(result[0][0],text)
        self.assertAlmostEqual(result[0][1],.9,places=4)

if __name__=='__main__':unittest.main()
