"""生成 INT8 动态量化的识别/检测模型，供速度实验对比。输出到 app/src/ocr/assets/models"""
import os
import sys

from onnxruntime.quantization import QuantType, quantize_dynamic

DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app', 'src', 'ocr', 'assets', 'models')
ops = sys.argv[1].split(',') if len(sys.argv) > 1 else ['MatMul']
suffix = sys.argv[2] if len(sys.argv) > 2 else 'int8'
for name in sys.argv[3:] or ['v6_rec', 'v5_rec']:
    src, dst = os.path.join(DIR, f'{name}.onnx'), os.path.join(DIR, f'{name}_{suffix}.onnx')
    quantize_dynamic(src, dst, op_types_to_quantize=ops, weight_type=QuantType.QInt8)
    print(f'{name}: {os.path.getsize(src) / 1048576:.1f} MB -> {os.path.getsize(dst) / 1048576:.1f} MB ({",".join(ops)})')
