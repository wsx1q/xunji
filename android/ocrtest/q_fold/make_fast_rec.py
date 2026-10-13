"""把识别模型改成「快速输出」版：
1) 字表缩到常用字（GB2312 一二级汉字 + 原字表里所有非汉字 + 额外保留的字），最后一层全连接按列裁剪；
2) 模型直接输出每个位置最可能的字号 idx(int64 [N,T]) 和它的概率 prob(float [N,T])，
   Java 端不用再拷贝、遍历 [N,T,18385] 的概率表。
用法：python make_fast_rec.py <原模型.onnx> <原字表.txt> <输出模型.onnx> <输出字表.txt> [额外保留字文件...]
"""
import sys

import numpy as np

import onnx_min as om


def is_cjk(ch):
    o = ord(ch)
    return (0x3400 <= o <= 0x4DBF or 0x4E00 <= o <= 0x9FFF or 0xF900 <= o <= 0xFAFF
            or 0x20000 <= o <= 0x3134F)


KEEP_RANGES = [(0x20, 0x24F), (0x2000, 0x206F), (0x2100, 0x218F), (0x2460, 0x24FF), (0x25A0, 0x25FF),
               (0x3000, 0x303F), (0xFF01, 0xFF5E), (0xFFE0, 0xFFEE)]
KEEP_EXTRA = set('≈≠≤≥∞√∑−∶←↑→↓↔⇒☆★☑☐♀♂€£¥')


def keep_symbol(k):
    """非汉字只留账单里可能出现的：ASCII/拉丁字母、标点、货币、箭头、圈码、几何图形、全角字符；去掉表情、假名、韩文、希腊/西里尔字母和数学符号"""
    if len(k) != 1:
        return False
    o = ord(k)
    return k in KEEP_EXTRA or any(a <= o <= b for a, b in KEEP_RANGES)


def gb2312_hanzi():
    s = set()
    for hi in range(0xB0, 0xF8):
        for lo in range(0xA1, 0xFF):
            try:
                s.add(bytes([hi, lo]).decode('gb2312'))
            except UnicodeDecodeError:
                pass
    return {c for c in s if is_cjk(c)}


def main(src, keys_src, dst, keys_dst, *extra_files):
    keys = open(keys_src, encoding='utf-8').read().split('\n')
    while keys and keys[-1] == '':
        keys.pop()
    keep = gb2312_hanzi()
    for f in extra_files:
        keep |= set(open(f, encoding='utf-8').read())
    kept = [i for i, k in enumerate(keys) if ((k in keep) if (len(k) == 1 and is_cjk(k)) else (keep_symbol(k) or k in keep))]
    new_keys = [keys[i] for i in kept]
    cols = np.array([0] + [i + 1 for i in kept] + [len(keys) + 1], dtype=np.int64)  # blank + 保留字 + 空格
    print(f'字表 {len(keys)} -> {len(new_keys)}（汉字 {sum(1 for k in new_keys if len(k) == 1 and is_cjk(k))}）')

    m = om.load(src)
    g = m.graph
    nodes = list(g.node)
    sm = [n for n in nodes if n.op_type == 'Softmax' and n.output[0] == g.output[0].name]
    assert len(sm) == 1, '没找到末尾的 Softmax'
    sm = sm[0]
    logits = sm.input[0]
    # 找到最后的 MatMul + Add（中间可能隔一个 Identity），裁剪权重列
    producer = {o: n for n in nodes for o in n.output}
    add = producer[logits]
    if add.op_type == 'Identity':
        add = producer[add.input[0]]
    assert add.op_type == 'Add', add.op_type
    mm = next(producer[x] for x in add.input if x in producer)
    assert mm.op_type == 'MatMul', mm.op_type
    inits = {t.name: t for t in g.initializer}
    w = inits[mm.input[1]]
    b = inits[[x for x in add.input if x in inits][0]]
    W = np.frombuffer(w.raw_data, np.float32).reshape(list(w.dims))
    B = np.frombuffer(b.raw_data, np.float32)
    assert W.shape[1] == len(keys) + 2, (W.shape, len(keys))
    W2, B2 = np.ascontiguousarray(W[:, cols]), np.ascontiguousarray(B[cols])
    del w.dims[:]
    w.dims.extend(W2.shape)
    w.raw_data = W2.tobytes()
    del b.dims[:]
    b.dims.extend(B2.shape)
    b.raw_data = B2.tobytes()

    # 去掉 Softmax，换成 ArgMax / ReduceMax - ReduceLogSumExp
    keep_nodes = [n for n in nodes if n is not sm]
    del g.node[:]
    g.node.extend(keep_nodes)

    def node(op, ins, outs, **attrs):
        n = g.node.add(op_type=op, name=outs[0] + '_n')
        n.input.extend(ins)
        n.output.extend(outs)
        for k, v in attrs.items():
            a = n.attribute.add(name=k)
            if isinstance(v, list):
                a.type = om.ATTR_INTS
                a.ints.extend(v)
            else:
                a.type = om.ATTR_INT
                a.i = v
        return n

    # 裁剪后的 7000 多类上做 softmax 很便宜；TopK(k=1) 一次拿到最大概率和字号
    node('Softmax', [logits], ['fast_prob'], axis=2)
    kname = 'fast_k1'
    kt = g.initializer.add(name=kname, data_type=om.INT64)
    kt.dims.append(1)
    kt.raw_data = np.array([1], np.int64).tobytes()
    node('TopK', ['fast_prob', kname], ['fast_val', 'fast_idx'], axis=-1)
    ax = 'fast_ax2'
    at = g.initializer.add(name=ax, data_type=om.INT64)
    at.dims.append(1)
    at.raw_data = np.array([2], np.int64).tobytes()
    node('Squeeze', ['fast_idx', ax], ['idx'])
    node('Squeeze', ['fast_val', ax], ['prob'])

    old_out = g.output[0]
    dims = [(d.dim_value, d.dim_param) for d in old_out.type.tensor_type.shape.dim][:2]
    del g.output[:]
    for name, et in (('idx', om.INT64), ('prob', om.FLOAT)):
        o = g.output.add(name=name)
        o.type.tensor_type.elem_type = et
        for v, p in dims:
            d = o.type.tensor_type.shape.dim.add()
            if p:
                d.dim_param = p
            else:
                d.dim_value = v
    # 去掉可能残留的旧形状信息
    stale = {logits, old_out.name, mm.output[0], add.output[0]}
    vi = [v for v in g.value_info if v.name not in stale]
    del g.value_info[:]
    g.value_info.extend(vi)
    om.save(m, dst)
    open(keys_dst, 'w', encoding='utf-8', newline='\n').write('\n'.join(new_keys))
    print(f'已写出 {dst}')


if __name__ == '__main__':
    main(*sys.argv[1:])
