"""Minimal ONNX protobuf schema (subset of onnx.proto, proto2). Unknown fields are preserved on re-serialize."""
from google.protobuf import descriptor_pb2, descriptor_pool, message_factory

F = descriptor_pb2.FieldDescriptorProto
OPT, REP = F.LABEL_OPTIONAL, F.LABEL_REPEATED
T = {'i64': F.TYPE_INT64, 'i32': F.TYPE_INT32, 'str': F.TYPE_STRING, 'bytes': F.TYPE_BYTES,
     'f': F.TYPE_FLOAT, 'd': F.TYPE_DOUBLE, 'u64': F.TYPE_UINT64, 'msg': F.TYPE_MESSAGE}

MSGS = {
    'StringStringEntryProto': [('key', 1, OPT, 'str'), ('value', 2, OPT, 'str')],
    'OperatorSetIdProto': [('domain', 1, OPT, 'str'), ('version', 2, OPT, 'i64')],
    'TensorProto': [('dims', 1, REP, 'i64'), ('data_type', 2, OPT, 'i32'), ('float_data', 4, REP, 'f'),
                    ('int32_data', 5, REP, 'i32'), ('string_data', 6, REP, 'bytes'), ('int64_data', 7, REP, 'i64'),
                    ('name', 8, OPT, 'str'), ('raw_data', 9, OPT, 'bytes'), ('double_data', 10, REP, 'd'),
                    ('uint64_data', 11, REP, 'u64'), ('doc_string', 12, OPT, 'str'),
                    ('external_data', 13, REP, 'msg:StringStringEntryProto'), ('data_location', 14, OPT, 'i32')],
    'Dimension': [('dim_value', 1, OPT, 'i64'), ('dim_param', 2, OPT, 'str'), ('denotation', 3, OPT, 'str')],
    'TensorShapeProto': [('dim', 1, REP, 'msg:Dimension')],
    'TensorTypeProto': [('elem_type', 1, OPT, 'i32'), ('shape', 2, OPT, 'msg:TensorShapeProto')],
    'TypeProto': [('tensor_type', 1, OPT, 'msg:TensorTypeProto'), ('denotation', 6, OPT, 'str')],
    'ValueInfoProto': [('name', 1, OPT, 'str'), ('type', 2, OPT, 'msg:TypeProto'), ('doc_string', 3, OPT, 'str')],
    'AttributeProto': [('name', 1, OPT, 'str'), ('f', 2, OPT, 'f'), ('i', 3, OPT, 'i64'), ('s', 4, OPT, 'bytes'),
                       ('t', 5, OPT, 'msg:TensorProto'), ('g', 6, OPT, 'msg:GraphProto'), ('floats', 7, REP, 'f'),
                       ('ints', 8, REP, 'i64'), ('strings', 9, REP, 'bytes'), ('tensors', 10, REP, 'msg:TensorProto'),
                       ('graphs', 11, REP, 'msg:GraphProto'), ('doc_string', 13, OPT, 'str'), ('type', 20, OPT, 'i32'),
                       ('ref_attr_name', 21, OPT, 'str')],
    'NodeProto': [('input', 1, REP, 'str'), ('output', 2, REP, 'str'), ('name', 3, OPT, 'str'),
                  ('op_type', 4, OPT, 'str'), ('attribute', 5, REP, 'msg:AttributeProto'),
                  ('doc_string', 6, OPT, 'str'), ('domain', 7, OPT, 'str')],
    'GraphProto': [('node', 1, REP, 'msg:NodeProto'), ('name', 2, OPT, 'str'), ('initializer', 5, REP, 'msg:TensorProto'),
                   ('doc_string', 10, OPT, 'str'), ('input', 11, REP, 'msg:ValueInfoProto'),
                   ('output', 12, REP, 'msg:ValueInfoProto'), ('value_info', 13, REP, 'msg:ValueInfoProto')],
    'ModelProto': [('ir_version', 1, OPT, 'i64'), ('producer_name', 2, OPT, 'str'), ('producer_version', 3, OPT, 'str'),
                   ('domain', 4, OPT, 'str'), ('model_version', 5, OPT, 'i64'), ('doc_string', 6, OPT, 'str'),
                   ('graph', 7, OPT, 'msg:GraphProto'), ('opset_import', 8, REP, 'msg:OperatorSetIdProto'),
                   ('metadata_props', 14, REP, 'msg:StringStringEntryProto')],
}

fdp = descriptor_pb2.FileDescriptorProto(name='onnx_min.proto', package='onnxmin', syntax='proto2')
for mname, fields in MSGS.items():
    m = fdp.message_type.add(name=mname)
    for fname, num, label, typ in fields:
        f = m.field.add(name=fname, number=num, label=label)
        if typ.startswith('msg:'):
            f.type = F.TYPE_MESSAGE
            f.type_name = '.onnxmin.' + typ[4:]
        else:
            f.type = T[typ]
        if label == REP and typ in ('i64', 'i32', 'f', 'd', 'u64'):
            f.options.packed = True
pool = descriptor_pool.DescriptorPool()
pool.Add(fdp)
_cls = {n: message_factory.GetMessageClass(pool.FindMessageTypeByName('onnxmin.' + n)) for n in MSGS}
ModelProto = _cls['ModelProto']
NodeProto = _cls['NodeProto']
TensorProto = _cls['TensorProto']
AttributeProto = _cls['AttributeProto']
ValueInfoProto = _cls['ValueInfoProto']

FLOAT, INT64 = 1, 7
ATTR_INT, ATTR_INTS = 2, 7


def load(path):
    m = ModelProto()
    m.ParseFromString(open(path, 'rb').read())
    return m


def save(m, path):
    open(path, 'wb').write(m.SerializeToString())
