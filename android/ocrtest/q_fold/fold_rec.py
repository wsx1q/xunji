"""把 PP-LCNetV3 里卷积后面的「可学习仿射」(Mul 常数 + Add 常数) 和单独的偏置 Add 并进卷积权重：
  Conv -> Mul(a) -> Add(b)             ==> Conv(W*a, bias*a+b)                         （完全等价）
  act  -> Mul(c) -> Add(d) -> Conv1x1  ==> act -> Conv1x1(W*c, bias + d*ΣW)             （无补边的 1x1 卷积，完全等价）
用法：python fold_rec.py <输入.onnx> <输出.onnx>
"""
import sys
from collections import defaultdict

import numpy as np

import onnx_min as om


def arr(t):
    if t.raw_data:
        dt = {1: np.float32, 7: np.int64, 6: np.int32}[t.data_type]
        return np.frombuffer(t.raw_data, dt).reshape(list(t.dims)).copy()
    if t.float_data:
        return np.array(t.float_data, np.float32).reshape(list(t.dims))
    raise ValueError(t.name)


def set_arr(t, a):
    a = np.ascontiguousarray(a.astype(np.float32))
    del t.dims[:]
    t.dims.extend(a.shape)
    del t.float_data[:]
    t.raw_data = a.tobytes()


def attr(n, name, default=None):
    for a in n.attribute:
        if a.name == name:
            return list(a.ints) if a.ints else (a.s.decode() if a.s else a.i)
    return default


def main(src, dst):
    m = om.load(src)
    g = m.graph
    inits = {t.name: t for t in g.initializer}
    graph_out = {o.name for o in g.output}

    # 1. 去掉 Identity（把下游输入直接接到 Identity 的输入）
    ident = {n.output[0]: n.input[0] for n in g.node if n.op_type == 'Identity' and n.output[0] not in graph_out}

    def root(x):
        while x in ident:
            x = ident[x]
        return x
    nodes = [n for n in g.node if not (n.op_type == 'Identity' and n.output[0] in ident)]
    for n in nodes:
        for i, x in enumerate(n.input):
            if x in ident:
                n.input[i] = root(x)

    def rebuild():
        prod = {o: n for n in nodes for o in n.output}
        cons = defaultdict(list)
        for n in nodes:
            for x in n.input:
                cons[x].append(n)
        return prod, cons

    def const_of(n):
        """Mul/Add 的常数输入（标量或 [1,C,1,1]），返回 (常数, 另一个输入名)"""
        a, b = n.input
        if b in inits and a not in inits:
            return arr(inits[b]), a
        if a in inits and b not in inits:
            return arr(inits[a]), b
        return None, None

    removed = set()
    n_a = n_b = 0
    prod, cons = rebuild()

    def conv_wb(conv):
        W = arr(inits[conv.input[1]])
        if len(conv.input) > 2 and conv.input[2]:
            B = arr(inits[conv.input[2]])
        else:
            B = np.zeros(W.shape[0], np.float32)
            name = conv.input[1] + '_foldbias'
            t = g.initializer.add(name=name, data_type=om.FLOAT)
            inits[name] = t
            if len(conv.input) > 2:
                conv.input[2] = name
            else:
                conv.input.append(name)
        return W, B

    def per_out(c, cout):
        c = np.asarray(c, np.float32)
        if c.size == 1:
            return np.full(cout, float(c.reshape(-1)[0]), np.float32)
        if c.size == cout and (c.ndim == 1 or c.shape[1:] == (cout, 1, 1) or c.shape == (1, cout, 1, 1)):
            return c.reshape(-1)
        return None

    # 2. Conv 后面紧跟的 Mul/Add 常数并进卷积
    for conv in [n for n in nodes if n.op_type == 'Conv']:
        while True:
            y = conv.output[0]
            nxt = cons.get(y, [])
            if len(nxt) != 1 or y in graph_out:
                break
            op = nxt[0]
            if op.op_type not in ('Mul', 'Add') or id(op) in removed:
                break
            c, other = const_of(op)
            if c is None or other != y:
                break
            W, B = conv_wb(conv)
            cv = per_out(c, W.shape[0])
            if cv is None:
                break
            if op.op_type == 'Mul':
                W = W * cv[:, None, None, None]
                B = B * cv
            else:
                B = B + cv
            set_arr(inits[conv.input[1]], W)
            set_arr(inits[conv.input[2]], B)
            # 卷积直接输出到 op 的输出名
            conv.output[0] = op.output[0]
            removed.add(id(op))
            nodes = [n for n in nodes if id(n) not in removed]
            prod, cons = rebuild()
            n_a += 1

    # 3. 激活后的 Mul(c) -> Add(d) -> 无补边 1x1 卷积
    for mul in [n for n in nodes if n.op_type == 'Mul']:
        if id(mul) in removed:
            continue
        c, x = const_of(mul)
        if c is None or c.size != 1:
            continue
        nxt = cons.get(mul.output[0], [])
        if len(nxt) != 1 or nxt[0].op_type != 'Add':
            continue
        add = nxt[0]
        d, x2 = const_of(add)
        if d is None or d.size != 1 or x2 != mul.output[0]:
            continue
        convs = cons.get(add.output[0], [])
        if not convs or any(cv.op_type != 'Conv' or cv.input[0] != add.output[0] for cv in convs):
            continue
        ok = True
        for cv in convs:
            k = arr(inits[cv.input[1]]).shape[2:]
            pads = attr(cv, 'pads', [0, 0, 0, 0])
            if tuple(k) != (1, 1) or any(pads) or attr(cv, 'auto_pad', 'NOTSET') not in ('NOTSET', 0):
                ok = False
        if not ok:
            continue
        cval, dval = float(c.reshape(-1)[0]), float(d.reshape(-1)[0])
        for cv in convs:
            W, B = conv_wb(cv)
            B = B + dval * W.sum(axis=(1, 2, 3))
            W = W * cval
            set_arr(inits[cv.input[1]], W)
            set_arr(inits[cv.input[2]], B)
            cv.input[0] = x
        removed.add(id(mul))
        removed.add(id(add))
        nodes = [n for n in nodes if id(n) not in removed]
        prod, cons = rebuild()
        n_b += 1

    # 写回
    del g.node[:]
    g.node.extend(nodes)
    used = {x for n in nodes for x in n.input}
    keep = [t for t in g.initializer if t.name in used]
    del g.initializer[:]
    g.initializer.extend(keep)
    vi = [v for v in g.value_info if v.name in used or v.name in {o for n in nodes for o in n.output}]
    del g.value_info[:]
    g.value_info.extend(vi)
    om.save(m, dst)
    print(f'去掉 Identity {len(ident)} 个；卷积后常数并入 {n_a} 个；激活后仿射并入 1x1 卷积 {n_b} 组；节点 {len(nodes)}')


if __name__ == '__main__':
    main(*sys.argv[1:])
