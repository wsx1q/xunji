import java.awt.image.BufferedImage;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;

import javax.imageio.ImageIO;

import com.xunji.app.OcrEngine;

/**
 * 模型加载测试：原始模型加载（顺便存优化结果） vs 读已优化模型（关优化），并核对两者识别结果是否完全一致。
 * java LoadTest <models目录> <图片>
 */
public class LoadTest {
    static byte[] read(File f) throws Exception { return Files.readAllBytes(f.toPath()); }

    static List<String> texts(OcrEngine.Result r) {
        List<String> out = new ArrayList<>();
        for (OcrEngine.Line l : r.lines) out.add(l.text);
        return out;
    }

    static void cfg(OcrEngine e) { e.detShort = 736; e.recMinW = 160; e.recBatch = 6; }

    public static void main(String[] a) throws Exception {
        File dir = new File(a[0]);
        BufferedImage img = ImageIO.read(new File(a[1]));
        int w = img.getWidth(), h = img.getHeight();
        int[] px = img.getRGB(0, 0, w, h, null, 0, w);
        for (String m : new String[]{"v5", "v6"}) {
            byte[] det = read(new File(dir, m + "_det.onnx")), rec = read(new File(dir, m + "_rec.onnx"));
            String keys = new String(read(new File(dir, m + "_keys.txt")), StandardCharsets.UTF_8);
            File tmp = Files.createTempDirectory("ortopt").toFile();
            File od = new File(tmp, "det.onnx"), or = new File(tmp, "rec.onnx");

            long t = System.nanoTime();
            OcrEngine e0 = new OcrEngine(det, rec, keys, 4, 2);
            long plain = (System.nanoTime() - t) / 1_000_000;
            cfg(e0);
            OcrEngine.Result r0 = e0.run(px, w, h);
            e0.close();

            t = System.nanoTime();
            OcrEngine e1 = new OcrEngine(OcrEngine.ModelSrc.bytes(det, od.getPath()), OcrEngine.ModelSrc.bytes(rec, or.getPath()), keys, 4, 2);
            long first = (System.nanoTime() - t) / 1_000_000;
            cfg(e1);
            OcrEngine.Result r1 = e1.run(px, w, h);
            e1.close();

            t = System.nanoTime();
            OcrEngine e2 = new OcrEngine(OcrEngine.ModelSrc.optimizedFile(od.getPath()), OcrEngine.ModelSrc.optimizedFile(or.getPath()), keys, 4, 2);
            long cached = (System.nanoTime() - t) / 1_000_000;
            cfg(e2);
            e2.run(px, w, h);
            long s = System.nanoTime();
            OcrEngine.Result r2 = e2.run(px, w, h);
            long run2 = (System.nanoTime() - s) / 1_000_000;
            e2.close();

            boolean same = texts(r0).equals(texts(r1)) && texts(r1).equals(texts(r2));
            System.out.printf("LOAD %s: 原始加载 %d ms | 首次加载+存缓存 %d ms | 读缓存 %d ms | 缓存文件 det %.1fMB rec %.1fMB | 结果一致 %s (%d 行) | 读缓存后识别 %d ms%n",
                    m, plain, first, cached, od.length() / 1048576.0, or.length() / 1048576.0, same ? "是" : "否", r2.lines.size(), run2);
            if (!same) {
                System.out.println("  原始: " + texts(r0));
                System.out.println("  缓存: " + texts(r2));
            }
        }
    }
}
