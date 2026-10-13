package com.xunji.app;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Debug;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/** 本机 OCR：模型放在 assets/models，首次识别时加载，离开识别页时释放。 */
final class LocalOcr {
    private static OcrEngine engine;

    private LocalOcr() {
    }

    static boolean available() {
        return true;
    }

    /*
     * 固定用 PP-OCRv5 极速版：v5 检测模型 + v5f 识别模型（常数乘加并入卷积、INT8、常用 7111 字表、直接输出字号）。
     * 参数按手机实测固定：2 线程、批量 1、不并行、检测短边 640、识别最小宽度 160。前端传来的参数不再使用。
     */
    static final String MODEL = "v5f";
    static final int THREADS = 2, PAR = 1, BATCH = 1, DET = 640, REC_W = 160;

    /**
     * image 为空表示预加载：进识别页时就在后台把模型加载好（并跑一次检测预热），选完截图直接识别。
     */
    static synchronized String recognize(Context ctx, byte[] image, String optsJson) throws Exception {
        String m = MODEL;
        int threads = THREADS, par = PAR;
        long loadMs = 0;
        boolean cached = false;
        if (engine == null) {
            long t = System.nanoTime();
            cached = load(ctx, m, threads, par);
            loadMs = (System.nanoTime() - t) / 1_000_000;
        }
        engine.detShort = DET;
        engine.recMinW = REC_W;
        engine.recBatch = BATCH;

        if (image == null || image.length == 0) {
            long w0 = System.nanoTime();
            if (loadMs > 0) engine.run(new int[360 * 200], 360, 200); // 预热检测
            return new JSONObject().put("ok", true).put("warm", true).put("load_ms", loadMs).put("cached", cached)
                    .put("warm_ms", (System.nanoTime() - w0) / 1_000_000).toString();
        }

        BitmapFactory.Options bo = new BitmapFactory.Options();
        bo.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(image, 0, image.length, bo);
        int w = bo.outWidth, h = bo.outHeight;
        if (w <= 0 || h <= 0) throw new IllegalArgumentException("无法解析图片");

        long t = System.nanoTime();
        OcrEngine.Result r = h > w * TALL ? runTall(image, w, h) : runWhole(image);
        long total = (System.nanoTime() - t) / 1_000_000;
        w = r.width;
        h = r.height;

        JSONArray lines = new JSONArray();
        for (OcrEngine.Line l : r.lines) {
            lines.put(new JSONObject().put("text", l.text).put("score", Math.round(l.score * 1000) / 1000.0)
                    .put("box", new JSONArray().put(l.x1).put(l.y1).put(l.x2).put(l.y2)));
        }
        return new JSONObject().put("ok", true).put("model", m).put("threads", threads)
                .put("cores", Runtime.getRuntime().availableProcessors())
                .put("par", par).put("det", engine.detShort).put("recW", engine.recMinW)
                .put("batch", engine.recBatch).put("mem", Debug.getPss() / 1024)
                .put("native_mb", Debug.getNativeHeapAllocatedSize() >> 20)
                .put("java_mb", (Runtime.getRuntime().totalMemory() - Runtime.getRuntime().freeMemory()) >> 20)
                .put("width", w).put("height", h).put("boxes", r.boxes)
                .put("load_ms", loadMs).put("cached", cached).put("det_ms", r.detMs).put("rec_ms", r.recMs).put("total_ms", total)
                .put("lines", lines).toString();
    }

    /** 高度超过宽度的这个倍数就当长截图，切成一屏一屏识别（普通手机截图约 2.2 倍） */
    private static final double TALL = 2.6;

    private static OcrEngine.Result runWhole(byte[] image) throws Exception {
        BitmapFactory.Options o = new BitmapFactory.Options();
        o.inPreferredConfig = Bitmap.Config.ARGB_8888;
        Bitmap bmp = BitmapFactory.decodeByteArray(image, 0, image.length, o);
        if (bmp == null) throw new IllegalArgumentException("无法解析图片");
        int w = bmp.getWidth(), h = bmp.getHeight();
        int[] px = new int[w * h];
        bmp.getPixels(px, 0, w, 0, 0, w, h);
        bmp.recycle();
        return engine.run(px, w, h);
    }

    /**
     * 长截图（淘宝等 App 自带的长截图，高度可达宽度的 20 倍）：整张缩到 2400 以内字就糊了，
     * 所以按原分辨率切成高 = 2 倍宽的段、相邻段重叠 1/4 宽，逐段解码（BitmapRegionDecoder，不把整张图读进内存）逐段识别。
     * 重叠区里的文字两段都会认到：每段只保留中心落在「自己负责的那一截」里的行，坐标加回段的起点。
     */
    private static OcrEngine.Result runTall(byte[] image, int w, int h) throws Exception {
        int sample = w > 1600 ? 2 : 1; // 平板等超宽截图先缩一半
        int sw = w / sample, sh = h / sample;
        int seg = sw * 2, ov = Math.max(160, sw / 4), step = seg - ov;
        android.graphics.BitmapRegionDecoder dec = android.graphics.BitmapRegionDecoder.newInstance(image, 0, image.length, false);
        if (dec == null) throw new IllegalArgumentException("无法解析图片");
        OcrEngine.Result all = new OcrEngine.Result();
        all.width = sw;
        all.height = sh;
        try {
            BitmapFactory.Options o = new BitmapFactory.Options();
            o.inPreferredConfig = Bitmap.Config.ARGB_8888;
            o.inSampleSize = sample;
            for (int y0 = 0; ; y0 += step) {
                int y1 = Math.min(sh, y0 + seg);
                Bitmap bmp = dec.decodeRegion(new android.graphics.Rect(0, y0 * sample, w, y1 * sample), o);
                if (bmp == null) throw new IllegalArgumentException("长截图第 " + (y0 / step + 1) + " 段解码失败");
                int bw = bmp.getWidth(), bh = bmp.getHeight();
                int[] px = new int[bw * bh];
                bmp.getPixels(px, 0, bw, 0, 0, bw, bh);
                bmp.recycle();
                OcrEngine.Result r = engine.run(px, bw, bh);
                double lo = y0 == 0 ? -1 : y0 + ov / 2.0, hi = y1 >= sh ? Double.MAX_VALUE : y1 - ov / 2.0;
                for (OcrEngine.Line l : r.lines) {
                    double cy = y0 + (l.y1 + l.y2) / 2.0;
                    if (cy < lo || cy >= hi) continue;
                    all.lines.add(new OcrEngine.Line(l.text, l.score, l.x1, l.y1 + y0, l.x2, l.y2 + y0));
                }
                all.boxes += r.boxes;
                all.detMs += r.detMs;
                all.recMs += r.recMs;
                if (y1 >= sh) break;
            }
        } finally {
            dec.recycle();
        }
        all.lines.sort((a, b) -> Float.compare(a.y1, b.y1));
        return all;
    }

    /**
     * 测速（adb 触发）：每个模型用 THREADS 个线程，识别 1x3x48x160 / 1x3x48x320，检测 1x3x1440x640。每测完一项就追加写到 Android/data/<包名>/files/ocrbench.txt
     * （adb 能直接读，不受部分系统屏蔽 logcat 的影响），同时打 logcat 警告级日志 OCRBENCH。
     * @param models 逗号分隔，如 "v5,v5q,v6"
     */
    static synchronized String bench(Context ctx, String models) throws Exception {
        release();
        java.io.File dir = ctx.getExternalFilesDir(null);
        java.io.File f = new java.io.File(dir != null ? dir : ctx.getFilesDir(), "ocrbench.txt");
        StringBuilder sb = new StringBuilder();
        try (java.io.PrintWriter w = new java.io.PrintWriter(new java.io.OutputStreamWriter(
                new java.io.FileOutputStream(f, false), StandardCharsets.UTF_8), true)) {
            int threads = THREADS;
            emit(w, sb, "BENCH START ort threads=" + threads + " cores=" + Runtime.getRuntime().availableProcessors());
            long[][] recShapes = {{1, 3, 48, 160}, {1, 3, 48, 320}};
            for (String m : (models == null || models.trim().isEmpty() ? MODEL : models).split(",")) {
                m = m.trim();
                if (m.isEmpty()) continue;
                String base = "v5";
                emit(w, sb, "BENCH ort " + m + " 加载模型...");
                try (OcrEngine e = new OcrEngine(OcrEngine.ModelSrc.bytes(read(ctx, "models/" + base + "_det.onnx"), null),
                        OcrEngine.ModelSrc.bytes(read(ctx, "models/" + m + "_rec.onnx"), null),
                        new String(read(ctx, keysFile(ctx, m, base)), StandardCharsets.UTF_8), threads, 1)) {
                    for (long[] s : recShapes) {
                        double ms = e.benchModel(false, s, 5, 30);
                        emit(w, sb, String.format(java.util.Locale.US, "BENCH ort %s rec %dx%dx%dx%d avg %.2f ms",
                                m, s[0], s[1], s[2], s[3], ms));
                    }
                    {
                        double ms = e.benchModel(true, new long[]{1, 3, 1440, 640}, 2, 10);
                        emit(w, sb, String.format(java.util.Locale.US, "BENCH ort %s det 1x3x1440x640 avg %.2f ms", m, ms));
                    }
                } catch (Throwable t) {
                    emit(w, sb, "BENCH ort " + m + " ERROR " + t);
                }
            }
            emit(w, sb, "BENCH DONE");
        }
        return sb.toString();
    }

    private static void emit(java.io.PrintWriter w, StringBuilder sb, String line) {
        w.println(line);
        sb.append(line).append('\n');
        android.util.Log.w("OCRBENCH", line);
    }

    static synchronized void release() {
        if (engine != null) {
            try {
                engine.close();
            } catch (Exception ignored) {
            }
            engine = null;
        }
    }

    /* ---------- 已优化模型缓存：files/ortopt/<模型>_<版本>.onnx，换版本自动重建 ---------- */

    private static File optDir(Context ctx) {
        File d = new File(ctx.getFilesDir(), "ortopt");
        //noinspection ResultOfMethodCallIgnored
        d.mkdirs();
        return d;
    }

    private static File optFile(Context ctx, String model) {
        return new File(optDir(ctx), model + "_" + BuildConfig.VERSION_NAME + ".onnx");
    }

    /** @return true 表示用的是缓存的已优化模型 */
    private static boolean load(Context ctx, String m, int threads, int par) throws Exception {
        String base = "v5";
        String keys = new String(read(ctx, keysFile(ctx, m, base)), StandardCharsets.UTF_8);
        File det = optFile(ctx, m + "_det"), rec = optFile(ctx, m + "_rec");
        if (det.isFile() && det.length() > 0 && rec.isFile() && rec.length() > 0) {
            try {
                engine = new OcrEngine(OcrEngine.ModelSrc.optimizedFile(det.getPath()),
                        OcrEngine.ModelSrc.optimizedFile(rec.getPath()), keys, threads, par);
                return true;
            } catch (Throwable e) {
                // 缓存坏了或不兼容：删掉，按原始模型重新加载并重新缓存
                //noinspection ResultOfMethodCallIgnored
                det.delete();
                //noinspection ResultOfMethodCallIgnored
                rec.delete();
            }
        }
        // 只清旧版本留下的缓存和半截临时文件；其他模型（如 v5 / v5q 来回切换对比）的缓存保留
        String keep = "_" + BuildConfig.VERSION_NAME + ".onnx";
        File[] old = optDir(ctx).listFiles();
        if (old != null) for (File f : old)
            if (!f.getName().endsWith(keep)) //noinspection ResultOfMethodCallIgnored
                f.delete();
        File detTmp = new File(det.getPath() + ".tmp"), recTmp = new File(rec.getPath() + ".tmp");
        engine = new OcrEngine(OcrEngine.ModelSrc.bytes(read(ctx, "models/" + base + "_det.onnx"), detTmp.getPath()),
                OcrEngine.ModelSrc.bytes(read(ctx, "models/" + m + "_rec.onnx"), recTmp.getPath()), keys, threads, par);
        // 两个都成功写出才启用，避免半截文件
        if (detTmp.isFile() && detTmp.length() > 0 && recTmp.isFile() && recTmp.length() > 0) {
            //noinspection ResultOfMethodCallIgnored
            detTmp.renameTo(det);
            //noinspection ResultOfMethodCallIgnored
            recTmp.renameTo(rec);
        } else {
            //noinspection ResultOfMethodCallIgnored
            detTmp.delete();
            //noinspection ResultOfMethodCallIgnored
            recTmp.delete();
        }
        return false;
    }

    /** 模型自带字表（如 v5f 裁剪过的常用字表）就用自己的，否则用同系列的 */
    private static String keysFile(Context ctx, String m, String base) {
        String own = "models/" + m + "_keys.txt";
        try (InputStream ignored = ctx.getAssets().open(own)) {
            return own;
        } catch (Exception e) {
            return "models/" + base + "_keys.txt";
        }
    }

    private static byte[] read(Context ctx, String name) throws Exception {
        try (InputStream in = ctx.getAssets().open(name)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream(Math.max(in.available(), 1 << 16));
            byte[] buf = new byte[1 << 16];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toByteArray();
        }
    }
}
