import java.awt.image.BufferedImage;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

import javax.imageio.ImageIO;

import com.xunji.app.OcrEngine;

/**
 * 桌面验证 OcrEngine：java OcrTest <models目录> <v6|v5> <threads> <outdir> <img...>
 * 可选系统属性：-Ddet=v6_det_int8all -Drec=v6_rec_int8 -DdetShort=736
 */
public class OcrTest {
    public static void main(String[] a) throws Exception {
        long t = System.nanoTime();
        File dir = new File(a[0]);
        String detName = System.getProperty("det", a[1] + "_det"), recName = System.getProperty("rec", a[1] + "_rec");
        try (OcrEngine eng = new OcrEngine(Files.readAllBytes(new File(dir, detName + ".onnx").toPath()),
                Files.readAllBytes(new File(dir, recName + ".onnx").toPath()),
                new String(Files.readAllBytes(new File(dir, a[1] + "_keys.txt").toPath()), StandardCharsets.UTF_8),
                Integer.parseInt(a[2]), Integer.getInteger("recPar", 1))) {
            eng.detShort = Integer.getInteger("detShort", 0);
            eng.recMinW = Integer.getInteger("recMinW", eng.recMinW);
            eng.recBatch = Integer.getInteger("recBatch", eng.recBatch);
            System.out.printf("load %d ms (%s + %s, detShort %d)%n", (System.nanoTime() - t) / 1_000_000, detName, recName, eng.detShort);
            for (int pass = Integer.getInteger("loop", 1); pass > 1; pass--)
                for (int k = 4; k < a.length; k++) {
                    BufferedImage img = ImageIO.read(new File(a[k]));
                    eng.run(img.getRGB(0, 0, img.getWidth(), img.getHeight(), null, 0, img.getWidth()), img.getWidth(), img.getHeight());
                }
            for (int k = 4; k < a.length; k++) {
                BufferedImage img = ImageIO.read(new File(a[k]));
                int w = img.getWidth(), h = img.getHeight();
                int[] px = img.getRGB(0, 0, w, h, null, 0, w);
                eng.run(px, w, h);
                long s = System.nanoTime();
                OcrEngine.Result r = eng.run(px, w, h);
                long total = (System.nanoTime() - s) / 1_000_000;
                System.out.printf("%s: %d boxes, %d lines, det %d ms, rec %d ms, total %d ms%n",
                        new File(a[k]).getName(), r.boxes, r.lines.size(), r.detMs, r.recMs, total);
                StringBuilder sb = new StringBuilder("{\"width\":" + w + ",\"height\":" + h + ",\"lines\":[");
                for (int i = 0; i < r.lines.size(); i++) {
                    OcrEngine.Line l = r.lines.get(i);
                    if (i > 0) sb.append(',');
                    sb.append("{\"text\":\"").append(l.text.replace("\\", "\\\\").replace("\"", "\\\""))
                            .append("\",\"score\":").append(l.score)
                            .append(",\"box\":[").append(l.x1).append(',').append(l.y1).append(',')
                            .append(l.x2).append(',').append(l.y2).append("]}");
                }
                sb.append("]}");
                File out = new File(a[3], new File(a[k]).getName() + ".json");
                try (Writer wr = new OutputStreamWriter(new FileOutputStream(out), StandardCharsets.UTF_8)) {
                    wr.write(sb.toString());
                }
            }
        }
    }
}
