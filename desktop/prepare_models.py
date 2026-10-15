"""Fetch verified tiny detector and add compact outputs without changing v6 weights/dictionary."""
import hashlib
import sys
import urllib.request
from pathlib import Path

HERE=Path(__file__).resolve().parent
ROOT=HERE.parent
MODELS=HERE/'build/models'
DETECTOR_URL='https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/onnx/PP-OCRv6/det/PP-OCRv6_det_tiny.onnx'
DETECTOR_SHA='f42c0fbd294d95eac1a550e131b277dac97462c8025fa4b6c3cec1b7894bd3d5'

def prepare():
    import rapidocr
    import numpy as np
    import model_proto as om
    MODELS.mkdir(parents=True,exist_ok=True)
    detector=MODELS/'PP-OCRv6_det_tiny.onnx'
    if not detector.exists() or hashlib.sha256(detector.read_bytes()).hexdigest()!=DETECTOR_SHA:
        request=urllib.request.Request(DETECTOR_URL,headers={'User-Agent':'XunJiDesktopBuild/1.0'})
        with urllib.request.urlopen(request,timeout=120) as response: raw=response.read()
        if hashlib.sha256(raw).hexdigest()!=DETECTOR_SHA: raise ValueError('OCR detector checksum mismatch')
        detector.write_bytes(raw)
    source=Path(rapidocr.__file__).parent/'models/PP-OCRv6_rec_small.onnx'
    if hashlib.sha256(source.read_bytes()).hexdigest()!='6f327246b50388f3c176ae304bd95767ea6dc0c9ae92153ef8cbe210b3c14884':
        raise ValueError('Unexpected v6 recognition model checksum')
    target=MODELS/'v6_rec_indexed.onnx'
    model=om.load(source);g=model.graph
    old=g.output[0]
    output=old.name
    shape=[(d.dim_value,d.dim_param) for d in old.type.tensor_type.shape.dim][:2]
    def node(op,inputs,outputs,**attrs):
        n=g.node.add(op_type=op,name='xunji_'+outputs[0]);n.input.extend(inputs);n.output.extend(outputs)
        for key,value in attrs.items():
            if isinstance(value,list): n.attribute.add(name=key,type=om.ATTR_INTS).ints.extend(value)
            else: n.attribute.add(name=key,type=om.ATTR_INT,i=value)
    k=g.initializer.add(name='xunji_k',data_type=om.INT64);k.dims.append(1);k.raw_data=np.array([1],np.int64).tobytes()
    node('TopK',[output,'xunji_k'],['xunji_prob','xunji_idx'],axis=-1)
    opset=next(v.version for v in model.opset_import if not v.domain)
    if opset < 13:
        node('Squeeze',['xunji_idx'],['idx'],axes=[2])
        node('Squeeze',['xunji_prob'],['prob'],axes=[2])
    else:
        axis=g.initializer.add(name='xunji_axis',data_type=om.INT64);axis.dims.append(1);axis.raw_data=np.array([2],np.int64).tobytes()
        node('Squeeze',['xunji_idx','xunji_axis'],['idx'])
        node('Squeeze',['xunji_prob','xunji_axis'],['prob'])
    del g.output[:]
    for name,typ in [('idx',om.INT64),('prob',om.FLOAT)]:
        info=g.output.add(name=name);info.type.tensor_type.elem_type=typ
        for value,param in shape:
            d=info.type.tensor_type.shape.dim.add()
            if param:d.dim_param=param
            else:d.dim_value=value
    om.save(model,target)
    print('CPU OCR models ready',flush=True)

if __name__=='__main__':prepare()
