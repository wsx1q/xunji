package com.xunji.app;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtException;
import ai.onnxruntime.OrtSession;

/**
 * PP-OCR 检测 + 识别，按 RapidOCR 的前后处理实现（与电脑端 OCR 服务结果对齐）。
 * 只依赖 ONNX Runtime，图片以 ARGB int[] 传入，Android 和桌面 Java 都能跑。
 * 截图里的文字都是横排，检测框按轴对齐矩形处理。
 */
public final class OcrEngine implements AutoCloseable {
    public static final class Line {
        public final String text;
        public final float score;
        public final float x1, y1, x2, y2;

        Line(String text, float score, float x1, float y1, float x2, float y2) {
            this.text = text;
            this.score = score;
            this.x1 = x1;
            this.y1 = y1;
            this.x2 = x2;
            this.y2 = y2;
        }
    }

    public static final class Result {
        public final List<Line> lines = new ArrayList<>();
        public int width, height, boxes;
        public long detMs, recMs;
    }

    private static final int MAX_SIDE = 2400;
    private static final int DET_LIMIT_MIN = 736;
    private static final float DET_THRESH = 0.3f, BOX_THRESH = 0.5f, UNCLIP_RATIO = 1.6f;
    private static final int MAX_CANDIDATES = 1000;
    private static final int REC_H = 48, REC_W = 320, REC_BATCH = 6;
    private static final float TEXT_SCORE = 0.5f;

    private final OrtEnvironment env = OrtEnvironment.getEnvironment();
    private final OrtSession det, rec;
    private final String detIn, recIn;
    /** 快速版识别模型：直接输出每个位置的字号 idx(int64 [N,T]) 和概率 prob(float [N,T])，不用在 Java 里遍历整张概率表 */
    private final boolean recFast;
    private final String[] chars;
    /** 检测图短边上限，0 为不缩小。只影响检测，识别仍从原图裁剪。 */
    public int detShort = 0;
    /** 识别输入最小宽度。RapidOCR 固定补到 320，短文字（「×1」「共1件」）也按 320 宽算，调小可省掉补白的计算。 */
    public int recMinW = REC_W;
    /** 识别批大小 */
    public int recBatch = REC_BATCH;

    private final ExecutorService recPool;
    private final int recPar;

    /** 模型来源：原始字节（可顺便把优化后的模型存到 saveTo），或之前存下的已优化模型文件。 */
    public static final class ModelSrc {
        final byte[] bytes;
        final String path, saveTo;

        private ModelSrc(byte[] bytes, String path, String saveTo) {
            this.bytes = bytes;
            this.path = path;
            this.saveTo = saveTo;
        }

        public static ModelSrc bytes(byte[] b, String saveOptimizedTo) {
            return new ModelSrc(b, null, saveOptimizedTo);
        }

        public static ModelSrc optimizedFile(String path) {
            return new ModelSrc(null, path, null);
        }
    }

    /**
     * 建会话。完整图优化（ALL_OPT）在手机上要一两秒，所以第一次把优化结果存成文件，
     * 以后直接读优化好的模型、关掉优化（ORT 文档的离线优化用法）。存下的文件只给本机用。
     */
    private OrtSession open(ModelSrc m, int threads) throws OrtException {
        try (OrtSession.SessionOptions o = options(threads)) {
            if (m.path != null) {
                o.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.NO_OPT);
                return env.createSession(m.path, o);
            }
            if (m.saveTo != null) o.setOptimizedModelFilePath(m.saveTo);
            return env.createSession(m.bytes, o);
        }
    }

    /**
     * @param keys 字符表（每行一个字符）。不能用模型元数据里的：ORT Java 读元数据时会把 4 字节 UTF-8（表尾的 emoji）连同换行一起读坏。
     * @param recPar 识别时同时跑几批。批内多线程在手机上同步开销大，几批并行、每批少线程往往更快；识别会话线程数为 threads / recPar
     */
    public OcrEngine(byte[] detModel, byte[] recModel, String keys, int threads, int recPar) throws OrtException {
        this(ModelSrc.bytes(detModel, null), ModelSrc.bytes(recModel, null), keys, threads, recPar);
    }

    public OcrEngine(ModelSrc detModel, ModelSrc recModel, String keys, int threads, int recPar) throws OrtException {
        this.recPar = Math.max(1, recPar);
        det = open(detModel, threads);
        try {
            rec = open(recModel, Math.max(1, threads / this.recPar));
        } catch (OrtException e) {
            det.close();
            throw e;
        }
        recPool = this.recPar > 1 ? Executors.newFixedThreadPool(this.recPar) : null;
        detIn = det.getInputNames().iterator().next();
        recIn = rec.getInputNames().iterator().next();
        String[] list = keys.split("\r?\n", -1);
        int n = list.length;
        while (n > 0 && list[n - 1].isEmpty()) n--;
        chars = new String[n + 2];
        chars[0] = "";
        System.arraycopy(list, 0, chars, 1, n);
        chars[n + 1] = " ";
        recFast = rec.getOutputNames().size() == 2;
        long classes = recFast ? -1
                : ((ai.onnxruntime.TensorInfo) rec.getOutputInfo().values().iterator().next().getInfo()).getShape()[2];
        if (classes > 0 && classes != chars.length)
            throw new IllegalArgumentException("字符表与识别模型不匹配：" + n + " 字 / 模型 " + classes + " 类");
    }

    /** 输入尺寸每次都不同，关掉按尺寸缓存的内存计划和不回收的内存池，否则原生内存只涨不降 */
    private static OrtSession.SessionOptions options(int threads) throws OrtException {
        OrtSession.SessionOptions o = new OrtSession.SessionOptions();
        o.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT);
        o.setIntraOpNumThreads(threads);
        o.setMemoryPatternOptimization(false);
        o.setCPUArenaAllocator(false);
        return o;
    }

    /** 复用的直接内存输入缓冲。传堆数组时 ORT 每次另申请直接内存，要等 GC 才释放，连续识别会把原生内存撑爆。 */
    private static FloatBuffer direct(FloatBuffer[] holder, float[] data, int n) {
        FloatBuffer b = holder[0];
        if (b == null || b.capacity() < n) {
            b = ByteBuffer.allocateDirect(n * 4).order(ByteOrder.nativeOrder()).asFloatBuffer();
            holder[0] = b;
        }
        b.clear();
        b.put(data, 0, n);
        b.flip();
        return b;
    }

    private final FloatBuffer[] detBuf = new FloatBuffer[1];
    /* 检测用的大数组每张图都要 20 多 MB，复用起来，避免每张图都触发一轮垃圾回收 */
    private float[] detInput, detProb;
    private boolean[] segBuf, maskBuf;
    private int[] labelBuf, stackBuf;
    private final ThreadLocal<FloatBuffer[]> recBuf = ThreadLocal.withInitial(() -> new FloatBuffer[1]);

    @Override
    public void close() throws OrtException {
        if (recPool != null) {
            recPool.shutdownNow();
            try {
                recPool.awaitTermination(30, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
        detBuf[0] = null;
        detInput = detProb = null;
        segBuf = maskBuf = null;
        labelBuf = stackBuf = null;
        recBuf.remove();
        det.close();
        rec.close();
    }

    /**
     * 只测模型本身（不含前后处理）：固定形状的随机输入跑 warm + n 次，返回平均毫秒。
     * 用来和 Paddle Lite 的 benchmark_bin 同形状对比。
     */
    public synchronized double benchModel(boolean useDet, long[] shape, int warm, int n) throws OrtException {
        int len = 1;
        for (long s : shape) len *= (int) s;
        float[] data = new float[len];
        java.util.Random rnd = new java.util.Random(1);
        for (int i = 0; i < len; i++) data[i] = rnd.nextFloat() * 2 - 1;
        FloatBuffer[] holder = new FloatBuffer[1];
        OrtSession s = useDet ? det : rec;
        String in = useDet ? detIn : recIn;
        long total = 0;
        for (int i = 0; i < warm + n; i++) {
            long t = System.nanoTime();
            try (OnnxTensor x = OnnxTensor.createTensor(env, direct(holder, data, len), shape);
                 OrtSession.Result ignored = s.run(Collections.singletonMap(in, x))) {
                if (i >= warm) total += System.nanoTime() - t;
            }
        }
        return total / 1e6 / n;
    }

    public synchronized Result run(int[] argb, int srcW, int srcH) throws OrtException {
        Result res = new Result();
        res.width = srcW;
        res.height = srcH;

        int[] img = argb;
        int w = srcW, h = srcH;
        if (Math.max(w, h) > MAX_SIDE) {
            double r = (double) MAX_SIDE / Math.max(w, h);
            int nw = round32((int) (w * r)), nh = round32((int) (h * r));
            img = resize(argb, w, h, nw, nh);
            w = nw;
            h = nh;
        }
        float sx = (float) srcW / w, sy = (float) srcH / h;

        long t0 = System.nanoTime();
        List<int[]> boxes = skipStatusBar(detect(img, w, h), w, h);
        res.detMs = (System.nanoTime() - t0) / 1_000_000;
        res.boxes = boxes.size();

        t0 = System.nanoTime();
        String[] texts = new String[boxes.size()];
        float[] scores = new float[boxes.size()];
        recognize(img, w, h, boxes, texts, scores);
        res.recMs = (System.nanoTime() - t0) / 1_000_000;

        for (int i = 0; i < boxes.size(); i++) {
            if (scores[i] < TEXT_SCORE) continue;
            int[] b = boxes.get(i);
            res.lines.add(new Line(texts[i], scores[i], b[0] * sx, b[1] * sy, b[2] * sx, b[3] * sy));
        }
        return res;
    }

    /** 整屏截图左上角状态栏的时间（如 14:33）对记账没用，不送去识别。只认左上角的小框，避免误伤居中的「拼多多」标题 */
    private static List<int[]> skipStatusBar(List<int[]> boxes, int w, int h) {
        if (h < w * 1.6) return boxes; // 不是整屏竖截图
        List<int[]> out = new ArrayList<>(boxes.size());
        for (int[] b : boxes)
            if (!(b[3] < h * 0.05 && b[2] < w * 0.25 && b[0] < w * 0.15)) out.add(b);
        return out;
    }

    /* ---------------- 检测 ---------------- */

    private List<int[]> detect(int[] img, int w, int h) throws OrtException {
        int s = Math.min(w, h);
        double ratio = s < DET_LIMIT_MIN ? (double) DET_LIMIT_MIN / s
                : detShort > 0 && s > detShort ? (double) detShort / s : 1.0;
        int dw = round32((int) (w * ratio)), dh = round32((int) (h * ratio));
        int[] px = (dw == w && dh == h) ? img : resize(img, w, h, dw, dh);

        int plane = dw * dh;
        if (detInput == null || detInput.length < 3 * plane) detInput = new float[3 * plane];
        if (detProb == null || detProb.length < plane) detProb = new float[plane];
        float[] input = detInput;
        for (int i = 0; i < plane; i++) {
            int p = px[i];
            input[i] = norm(p & 0xff);
            input[plane + i] = norm((p >> 8) & 0xff);
            input[2 * plane + i] = norm((p >> 16) & 0xff);
        }
        float[] prob = detProb;
        try (OnnxTensor t = OnnxTensor.createTensor(env, direct(detBuf, input, 3 * plane), new long[]{1, 3, dh, dw});
             OrtSession.Result out = det.run(Collections.singletonMap(detIn, t))) {
            ((OnnxTensor) out.get(0)).getFloatBuffer().get(prob, 0, plane);
        }
        return boxesFromProb(prob, dw, dh, w, h);
    }

    private List<int[]> boxesFromProb(float[] prob, int pw, int ph, int destW, int destH) {
        int n = pw * ph;
        if (segBuf == null || segBuf.length < n) {
            segBuf = new boolean[n];
            maskBuf = new boolean[n];
            labelBuf = new int[n];
            stackBuf = new int[n];
        }
        boolean[] seg = segBuf;
        for (int i = 0; i < n; i++) seg[i] = prob[i] > DET_THRESH;
        // cv2.dilate 2x2 核（锚点在右下）：当前点、左、上、左上任一为真即为真
        boolean[] mask = maskBuf;
        for (int y = 0; y < ph; y++) {
            int row = y * pw;
            for (int x = 0; x < pw; x++) {
                int i = row + x;
                mask[i] = seg[i] || (x > 0 && seg[i - 1]) || (y > 0 && (seg[i - pw] || (x > 0 && seg[i - pw - 1])));
            }
        }

        List<int[]> boxes = new ArrayList<>();
        int[] label = labelBuf;
        Arrays.fill(label, 0, n, 0);
        int[] stack = stackBuf;
        int comps = 0;
        for (int start = 0; start < n && comps < MAX_CANDIDATES; start++) {
            if (!mask[start] || label[start] != 0) continue;
            comps++;
            int sp = 0;
            stack[sp++] = start;
            label[start] = comps;
            int xmin = Integer.MAX_VALUE, ymin = Integer.MAX_VALUE, xmax = -1, ymax = -1;
            while (sp > 0) {
                int i = stack[--sp];
                int x = i % pw, y = i / pw;
                if (x < xmin) xmin = x;
                if (x > xmax) xmax = x;
                if (y < ymin) ymin = y;
                if (y > ymax) ymax = y;
                for (int dy = -1; dy <= 1; dy++) {
                    int yy = y + dy;
                    if (yy < 0 || yy >= ph) continue;
                    for (int dx = -1; dx <= 1; dx++) {
                        int xx = x + dx;
                        if (xx < 0 || xx >= pw) continue;
                        int j = yy * pw + xx;
                        if (mask[j] && label[j] == 0) {
                            label[j] = comps;
                            stack[sp++] = j;
                        }
                    }
                }
            }
            int bw = xmax - xmin, bh = ymax - ymin;
            if (Math.min(bw, bh) < 3) continue;

            double sum = 0;
            for (int y = ymin; y <= ymax; y++) {
                int row = y * pw;
                for (int x = xmin; x <= xmax; x++) sum += prob[row + x];
            }
            double score = sum / ((bw + 1) * (bh + 1));
            if (score < BOX_THRESH) continue;

            double d = (double) bw * bh * UNCLIP_RATIO / (2.0 * (bw + bh));
            if (Math.min(bw, bh) + 2 * d < 5) continue;
            int x1 = clip((int) Math.round((xmin - d) / pw * destW), 0, destW - 1);
            int x2 = clip((int) Math.round((xmax + d) / pw * destW), 0, destW - 1);
            int y1 = clip((int) Math.round((ymin - d) / ph * destH), 0, destH - 1);
            int y2 = clip((int) Math.round((ymax + d) / ph * destH), 0, destH - 1);
            if (x2 - x1 <= 3 || y2 - y1 <= 3) continue;
            boxes.add(new int[]{x1, y1, x2, y2});
        }

        // 先按 y 排序，y 相差不到 10 像素视为同一行，行内按 x 排序
        boxes.sort((a, b) -> Integer.compare(a[1], b[1]));
        int[] line = new int[boxes.size()];
        for (int i = 1; i < boxes.size(); i++)
            line[i] = line[i - 1] + (boxes.get(i)[1] - boxes.get(i - 1)[1] >= 10 ? 1 : 0);
        Integer[] order = new Integer[boxes.size()];
        for (int i = 0; i < order.length; i++) order[i] = i;
        Arrays.sort(order, (a, b) -> line[a] != line[b] ? Integer.compare(line[a], line[b])
                : Integer.compare(boxes.get(a)[0], boxes.get(b)[0]));
        List<int[]> sorted = new ArrayList<>(boxes.size());
        for (int i : order) sorted.add(boxes.get(i));
        return sorted;
    }

    /* ---------------- 识别 ---------------- */

    private void recognize(int[] img, int w, int h, List<int[]> boxes, String[] texts, float[] scores) throws OrtException {
        int n = boxes.size();
        int[][] crops = new int[n][];
        int[] cw = new int[n], ch = new int[n];
        Integer[] order = new Integer[n];
        double[] ratio = new double[n];
        for (int i = 0; i < n; i++) {
            int[] b = boxes.get(i);
            int bw = b[2] - b[0], bh = b[3] - b[1];
            int[] c = new int[bw * bh];
            for (int y = 0; y < bh; y++) {
                int sy = Math.min(b[1] + y, h - 1);
                for (int x = 0; x < bw; x++) c[y * bw + x] = img[sy * w + Math.min(b[0] + x, w - 1)];
            }
            if (bh >= bw * 1.5) {
                c = rot90(c, bw, bh);
                int t = bw;
                bw = bh;
                bh = t;
            }
            crops[i] = c;
            cw[i] = bw;
            ch[i] = bh;
            ratio[i] = (double) bw / bh;
            order[i] = i;
        }
        Arrays.sort(order, (a, b) -> Double.compare(ratio[a], ratio[b]));

        if (recPool == null) {
            for (int beg = 0; beg < n; beg += recBatch)
                recBatch(beg, Math.min(n, beg + recBatch), order, ratio, crops, cw, ch, texts, scores);
            return;
        }
        // 从最宽的一批开始提交，各线程负载更均匀
        List<Future<?>> jobs = new ArrayList<>();
        for (int beg = (n - 1) / recBatch * recBatch; beg >= 0; beg -= recBatch) {
            final int b0 = beg, b1 = Math.min(n, beg + recBatch);
            jobs.add(recPool.submit(() -> {
                recBatch(b0, b1, order, ratio, crops, cw, ch, texts, scores);
                return null;
            }));
        }
        // 等所有批都结束再抛错，避免出错后释放引擎时还有批在用会话
        Throwable err = null;
        for (Future<?> f : jobs) {
            try {
                f.get();
            } catch (ExecutionException e) {
                if (err == null) err = e.getCause();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                if (err == null) err = e;
            }
        }
        if (err instanceof OrtException) throw (OrtException) err;
        if (err instanceof Error) throw (Error) err;
        if (err != null) throw new RuntimeException(err);
    }

    private void recBatch(int beg, int end, Integer[] order, double[] ratio, int[][] crops, int[] cw, int[] ch,
                          String[] texts, float[] scores) throws OrtException {
        {
            int bn = end - beg;
            double maxRatio = (double) recMinW / REC_H;
            for (int k = beg; k < end; k++) maxRatio = Math.max(maxRatio, ratio[order[k]]);
            int imgW = recMinW < REC_W ? (int) Math.ceil(REC_H * maxRatio / 8) * 8 : (int) (REC_H * maxRatio);
            int plane = REC_H * imgW;
            float[] input = new float[bn * 3 * plane];
            for (int k = 0; k < bn; k++) {
                int idx = order[beg + k];
                int rw = (int) Math.ceil(REC_H * ratio[idx]);
                if (rw > imgW) rw = imgW;
                int[] r = resize(crops[idx], cw[idx], ch[idx], rw, REC_H);
                int base = k * 3 * plane;
                for (int y = 0; y < REC_H; y++) {
                    for (int x = 0; x < rw; x++) {
                        int p = r[y * rw + x], o = y * imgW + x;
                        input[base + o] = norm(p & 0xff);
                        input[base + plane + o] = norm((p >> 8) & 0xff);
                        input[base + 2 * plane + o] = norm((p >> 16) & 0xff);
                    }
                }
            }
            try (OnnxTensor t = OnnxTensor.createTensor(env, direct(recBuf.get(), input, input.length), new long[]{bn, 3, REC_H, imgW});
                 OrtSession.Result out = rec.run(Collections.singletonMap(recIn, t))) {
                if (recFast) {
                    OnnxTensor oi = (OnnxTensor) out.get(0), op = (OnnxTensor) out.get(1);
                    int steps = (int) oi.getInfo().getShape()[1];
                    java.nio.LongBuffer ib = oi.getLongBuffer();
                    FloatBuffer pb = op.getFloatBuffer();
                    for (int k = 0; k < bn; k++) {
                        StringBuilder sb = new StringBuilder();
                        double conf = 0;
                        int kept = 0, prev = -1;
                        for (int s = 0; s < steps; s++) {
                            int best = (int) ib.get();
                            float bp = pb.get();
                            if (best != 0 && best != prev && best < chars.length) {
                                sb.append(chars[best]);
                                conf += bp;
                                kept++;
                            }
                            prev = best;
                        }
                        int idx = order[beg + k];
                        texts[idx] = sb.toString();
                        scores[idx] = kept == 0 ? 0f : (float) (conf / kept);
                    }
                    return;
                }
                OnnxTensor o = (OnnxTensor) out.get(0);
                long[] shape = o.getInfo().getShape();
                int steps = (int) shape[1], classes = (int) shape[2];
                FloatBuffer fb = o.getFloatBuffer();
                float[] row = new float[classes];
                for (int k = 0; k < bn; k++) {
                    StringBuilder sb = new StringBuilder();
                    double conf = 0;
                    int kept = 0, prev = -1;
                    for (int s = 0; s < steps; s++) {
                        fb.get(row);
                        int best = 0;
                        float bp = row[0];
                        for (int c = 1; c < classes; c++) if (row[c] > bp) { bp = row[c]; best = c; }
                        if (best != 0 && best != prev && best < chars.length) {
                            sb.append(chars[best]);
                            conf += bp;
                            kept++;
                        }
                        prev = best;
                    }
                    int idx = order[beg + k];
                    texts[idx] = sb.toString();
                    scores[idx] = kept == 0 ? 0f : (float) (conf / kept);
                }
            }
        }
    }

    /* ---------------- 图像工具 ---------------- */

    private static float norm(int v) {
        return (v / 255f - 0.5f) / 0.5f;
    }

    private static int round32(int v) {
        return Math.max(32, Math.round(v / 32f) * 32);
    }

    private static int clip(int v, int lo, int hi) {
        return v < lo ? lo : Math.min(v, hi);
    }

    private static int[] rot90(int[] src, int w, int h) {
        // np.rot90：逆时针旋转 90°
        int[] dst = new int[w * h];
        for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++) dst[(w - 1 - x) * h + y] = src[y * w + x];
        return dst;
    }

    /** 双线性缩放，坐标映射与 cv2.INTER_LINEAR 一致（像素中心对齐、不做抗锯齿）。 */
    static int[] resize(int[] src, int sw, int sh, int dw, int dh) {
        int[] x0 = new int[dw], x1 = new int[dw];
        float[] fx = new float[dw];
        axis(sw, dw, x0, x1, fx);
        int[] y0 = new int[dh], y1 = new int[dh];
        float[] fy = new float[dh];
        axis(sh, dh, y0, y1, fy);
        int[] dst = new int[dw * dh];
        for (int y = 0; y < dh; y++) {
            int r0 = y0[y] * sw, r1 = y1[y] * sw;
            float wy = fy[y];
            for (int x = 0; x < dw; x++) {
                int a = src[r0 + x0[x]], b = src[r0 + x1[x]], c = src[r1 + x0[x]], d = src[r1 + x1[x]];
                float wx = fx[x];
                int out = 0xff000000;
                for (int sh2 = 0; sh2 <= 16; sh2 += 8) {
                    float top = ((a >> sh2) & 0xff) * (1 - wx) + ((b >> sh2) & 0xff) * wx;
                    float bot = ((c >> sh2) & 0xff) * (1 - wx) + ((d >> sh2) & 0xff) * wx;
                    int v = Math.round(top * (1 - wy) + bot * wy);
                    out |= (v < 0 ? 0 : Math.min(v, 255)) << sh2;
                }
                dst[y * dw + x] = out;
            }
        }
        return dst;
    }

    private static void axis(int s, int d, int[] i0, int[] i1, float[] f) {
        double scale = (double) s / d;
        for (int i = 0; i < d; i++) {
            double p = (i + 0.5) * scale - 0.5;
            int a = (int) Math.floor(p);
            float t = (float) (p - a);
            if (a < 0) {
                a = 0;
                t = 0;
            }
            if (a >= s - 1) {
                a = s - 1;
                t = 0;
            }
            i0[i] = a;
            i1[i] = Math.min(a + 1, s - 1);
            f[i] = t;
        }
    }
}
