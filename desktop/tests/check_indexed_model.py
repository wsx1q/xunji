"""Indexed v6 output must preserve the full model's character IDs/confidence."""
from pathlib import Path
import numpy as np
import onnxruntime as ort
import rapidocr
ROOT=Path(__file__).resolve().parents[2]
options=ort.SessionOptions();options.intra_op_num_threads=2;options.log_severity_level=4
standard=ort.InferenceSession(str(Path(rapidocr.__file__).parent/'models/PP-OCRv6_rec_small.onnx'),options,providers=['CPUExecutionProvider'])
indexed=ort.InferenceSession(str(ROOT/'desktop/build/models/v6_rec_indexed.onnx'),options,providers=['CPUExecutionProvider'])
rng=np.random.default_rng(42)
assert standard.get_modelmeta().custom_metadata_map['character']==indexed.get_modelmeta().custom_metadata_map['character']
for batch,width in [(1,160),(4,320),(1,640)]:
    images=rng.uniform(-1,1,(batch,3,48,width)).astype(np.float32)
    probabilities=standard.run(None,{standard.get_inputs()[0].name:images})[0]
    ids,confidence=indexed.run(['idx','prob'],{indexed.get_inputs()[0].name:images})
    np.testing.assert_array_equal(ids,probabilities.argmax(axis=2))
    np.testing.assert_allclose(confidence,probabilities.max(axis=2),rtol=1e-5,atol=1e-6)
    print('PASS: full dictionary indexed output equivalence',batch,width,flush=True)
