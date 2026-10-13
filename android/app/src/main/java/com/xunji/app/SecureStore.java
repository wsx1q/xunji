package com.xunji.app;

import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import android.util.Base64;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.zip.GZIPInputStream;
import java.util.zip.GZIPOutputStream;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.Mac;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * 加密数据库文件 xunji.db。
 * 数据用随机的 256 位数据密钥做 AES-GCM 加密；数据密钥有两份保护：
 * 本机由 Android Keystore 加密后存在 SharedPreferences（打开 App 免输密码），
 * 文件内由用户的数据库密码经 PBKDF2 派生的密钥加密（换机 / 重装 / 其他设备打开时用）。
 */
final class SecureStore {
    static final String FILE_NAME = "xunji.db";
    private static final String PREFS = "xj_store", P_DIR = "dir", P_KEY = "dek", P_BACKUP_AT = "backup_at";
    private static final String KS_ALIAS = "xj_dek";
    private static final int ITER = 120000;
    private static final int KEEP_BACKUPS = 5;
    private static final int RW = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;

    private final Context ctx;
    private final SharedPreferences prefs;
    private final SecureRandom rnd = new SecureRandom();
    private byte[] dek;
    private JSONObject kdf;
    private JSONObject lockedEnv;
    private Uri pendingDir;
    private boolean dirty;
    /* 解密后的明文（UTF-8 字节）暂存在这里，JS 用 chunk(i) 分段取走。
       以前把整库明文转成 String 再 JSON 转义一遍返回，20 万条时 Java 端要同时存好几份上百 MB 的字符串，会内存不足白屏。 */
    private static final int CHUNK = 2 << 20;
    private byte[] staged;
    private int[] bounds;

    SecureStore(Context c) {
        ctx = c.getApplicationContext();
        prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /* ---------------- 对外接口（返回给 JS 的 JSON 字符串） ---------------- */

    /** 暂存明文并返回 {"ok":true,"chunks":n}；切点落在 UTF-8 字符边界上，每段都能单独解码。 */
    private String stage(byte[] plain) {
        java.util.ArrayList<Integer> b = new java.util.ArrayList<>();
        b.add(0);
        int pos = 0;
        while (pos < plain.length) {
            int next = Math.min(plain.length, pos + CHUNK);
            while (next < plain.length && (plain[next] & 0xC0) == 0x80) next++;
            b.add(next);
            pos = next;
        }
        staged = plain;
        bounds = new int[b.size()];
        for (int i = 0; i < bounds.length; i++) bounds[i] = b.get(i);
        return obj("ok", true, "chunks", bounds.length - 1);
    }

    /**
     * 解析数据库 / 备份文件外层：把最大的 "data"（几 MB 的 base64）直接截出来，只让 org.json 解析剩下的几百字节。
     * org.json 逐字符解析几 MB 的字符串在手机上要几百毫秒。格式不符合预期时退回完整解析。
     */
    static JSONObject parseEnv(String text) throws JSONException {
        final String key = "\"data\":\"";
        int i = text.indexOf(key);
        if (i >= 0) {
            int from = i + key.length(), to = text.indexOf('"', from);
            if (to > from) {
                String data = text.substring(from, to);
                // org.json 输出时会把 / 写成 \/；base64 里不会有别的转义
                if (data.indexOf('\\') >= 0) data = data.replace("\\/", "/");
                if (data.indexOf('\\') < 0) {
                    JSONObject env = new JSONObject(text.substring(0, i) + "\"data\":\"\"" + text.substring(to + 1));
                    env.put("data", data);
                    return env;
                }
            }
        }
        return new JSONObject(text);
    }

    /** 第 i 段明文；取完最后一段自动释放。 */
    synchronized String chunk(int i) {
        if (staged == null || i < 0 || i >= bounds.length - 1) return "";
        String s = new String(staged, bounds[i], bounds[i + 1] - bounds[i], StandardCharsets.UTF_8);
        if (i == bounds.length - 2) dropStaged();
        return s;
    }

    synchronized void dropStaged() {
        staged = null;
        bounds = null;
    }

    synchronized String open() {
        lockedEnv = null;
        try {
            Uri dir = dir();
            byte[] raw = read(dir);
            if (raw == null) {
                if (dir != null) return fail("在「" + label(dir) + "」中找不到数据库文件 " + FILE_NAME);
                ensureKey();
                kdf = null;
                return obj("ok", true, "data", null);
            }
            JSONObject env = parseEnv(new String(raw, StandardCharsets.UTF_8));
            if (!"xjdb".equals(env.optString("fmt"))) return fail("不是有效的数据库文件");
            raw = null;
            byte[] key = dek != null ? dek : loadLocalKey();
            byte[] plain = key == null ? null : decrypt(env, key);
            if (plain == null) {
                if (env.optJSONObject("kdf") == null) return fail("该数据库没有设置密码，只能在创建它的设备上打开");
                lockedEnv = env;
                return obj("ok", false, "need", "password");
            }
            env.remove("data");
            dek = key;
            kdf = env.optJSONObject("kdf");
            return stage(plain);
        } catch (Exception e) {
            return fail("读取数据库失败：" + msg(e));
        }
    }

    synchronized String unlock(String pwd) {
        if (lockedEnv == null) return fail("没有需要解锁的数据库");
        if (pwd == null || pwd.isEmpty()) return fail("请输入密码");
        try {
            JSONObject k = lockedEnv.getJSONObject("kdf");
            byte[] key = unwrap(k, pwd);
            if (key == null) return fail("密码错误");
            byte[] plain = decrypt(lockedEnv, key);
            if (plain == null) return fail("数据库文件已损坏");
            dek = key;
            kdf = k;
            lockedEnv = null;
            saveLocalKey(key);
            return stage(plain);
        } catch (Exception e) {
            return fail("解锁失败：" + msg(e));
        }
    }

    /** 新建空数据库（覆盖当前位置无法打开的文件），由 JS 随后写入初始数据。 */
    synchronized String create() {
        try {
            lockedEnv = null;
            kdf = null;
            ensureKey();
            return obj("ok", true, "data", null);
        } catch (Exception e) {
            return fail("新建失败：" + msg(e));
        }
    }

    synchronized String save(String json) {
        try {
            write(dir(), seal(json));
            dirty = true;
            return "";
        } catch (Exception e) {
            return msg(e);
        }
    }

    /** days=0：有改动就备份；>0：距上次备份满 N 天才备份。最多保留 5 份。 */
    synchronized String autoBackup(int days) {
        try {
            if (!dirty) return obj("ok", true, "skipped", true, "reason", "nochange");
            long now = System.currentTimeMillis();
            long last = prefs.getLong(P_BACKUP_AT, 0);
            if (days > 0 && now - last < days * 86400000L)
                return obj("ok", true, "skipped", true, "reason", "interval");
            String name = doBackup();
            dirty = false;
            prefs.edit().putLong(P_BACKUP_AT, now).commit();
            return obj("ok", true, "name", name);
        } catch (Exception e) {
            return fail("自动备份失败：" + msg(e));
        }
    }

    synchronized String forceBackup() {
        try {
            String name = doBackup();
            dirty = false;
            prefs.edit().putLong(P_BACKUP_AT, System.currentTimeMillis()).commit();
            return obj("ok", true, "name", name);
        } catch (Exception e) {
            return fail("备份失败：" + msg(e));
        }
    }

    synchronized String listBackups() {
        try {
            File[] files = backupFiles();
            org.json.JSONArray arr = new org.json.JSONArray();
            for (File f : files) {
                arr.put(new JSONObject()
                        .put("name", f.getName())
                        .put("size", f.length())
                        .put("time", f.lastModified()));
            }
            return obj("ok", true, "items", arr, "lastAt", prefs.getLong(P_BACKUP_AT, 0));
        } catch (Exception e) {
            return fail(msg(e));
        }
    }

    /** 用备份文件覆盖当前数据库并返回解密后的明文。 */
    synchronized String restoreBackup(String name) {
        try {
            if (name == null || name.contains("..") || name.contains("/") || name.contains("\\"))
                return fail("无效的备份名");
            File f = new File(backupDir(), name);
            if (!f.isFile()) return fail("找不到该备份");
            byte[] raw;
            try (InputStream in = new java.io.FileInputStream(f)) {
                raw = readAll(in);
            }
            JSONObject env = parseEnv(new String(raw, StandardCharsets.UTF_8));
            if (!"xjdb".equals(env.optString("fmt"))) return fail("不是有效的备份文件");
            byte[] key = dek != null ? dek : loadLocalKey();
            byte[] plain = key == null ? null : decrypt(env, key);
            if (plain == null) {
                if (env.optJSONObject("kdf") != null) {
                    lockedEnv = env;
                    write(dir(), raw);
                    dirty = false;
                    return obj("ok", false, "need", "password");
                }
                return fail("无法解密该备份");
            }
            dek = key;
            kdf = env.optJSONObject("kdf");
            write(dir(), raw);
            dirty = false;
            return stage(plain);
        } catch (Exception e) {
            return fail("恢复失败：" + msg(e));
        }
    }

    private String doBackup() throws Exception {
        byte[] raw = read(dir());
        if (raw == null) throw new IOException("当前没有可备份的数据库文件");
        java.text.SimpleDateFormat fmt = new java.text.SimpleDateFormat("yyyyMMdd_HHmmss", java.util.Locale.US);
        String name = "xunji_" + fmt.format(new java.util.Date()) + ".db";
        File out = new File(backupDir(), name);
        try (FileOutputStream os = new FileOutputStream(out)) {
            os.write(raw);
        }
        pruneBackups();
        return name;
    }

    private File backupDir() {
        File d = new File(ctx.getFilesDir(), "backups");
        //noinspection ResultOfMethodCallIgnored
        d.mkdirs();
        return d;
    }

    private File[] backupFiles() {
        File[] files = backupDir().listFiles((dir, n) -> n.startsWith("xunji_") && n.endsWith(".db"));
        if (files == null) return new File[0];
        java.util.Arrays.sort(files, (a, b) -> Long.compare(b.lastModified(), a.lastModified()));
        return files;
    }

    private void pruneBackups() {
        File[] files = backupFiles();
        for (int i = KEEP_BACKUPS; i < files.length; i++) {
            //noinspection ResultOfMethodCallIgnored
            files[i].delete();
        }
    }

    synchronized boolean hasPassword() {
        return kdf != null;
    }

    synchronized String setPassword(String old, String pwd, String json) {
        try {
            if (dek == null) return "数据库未解锁";
            if (pwd == null || pwd.length() < 6) return "密码至少 6 位";
            if (kdf != null) {
                byte[] k = old == null || old.isEmpty() ? null : unwrap(kdf, old);
                if (k == null || !MessageDigest.isEqual(k, dek)) return "当前密码错误";
            }
            byte[] salt = random(16);
            JSONObject k = new JSONObject()
                    .put("alg", "PBKDF2-HMAC-SHA256")
                    .put("salt", b64(salt))
                    .put("iter", ITER)
                    .put("wk", b64(gcmSeal(pbkdf2(pwd, salt, ITER), dek)));
            JSONObject prev = kdf;
            kdf = k;
            try {
                write(dir(), seal(json));
            } catch (Exception e) {
                kdf = prev;
                throw e;
            }
            return "";
        } catch (Exception e) {
            return "设置失败：" + msg(e);
        }
    }

    /** 解锁 App（启动密码）时校验，和数据库密码是同一个。 */
    synchronized boolean checkPassword(String pwd) {
        try {
            if (kdf == null || dek == null || pwd == null || pwd.isEmpty()) return false;
            byte[] k = unwrap(kdf, pwd);
            return k != null && MessageDigest.isEqual(k, dek);
        } catch (Exception e) {
            return false;
        }
    }

    synchronized String clearPassword(String old, String json) {
        try {
            if (kdf == null) return "";
            if (dir() != null) return "数据库在自定义目录中，必须设置密码，请先改回默认位置";
            if (!checkPassword(old)) return "当前密码错误";
            JSONObject prev = kdf;
            kdf = null;
            try {
                write(dir(), seal(json));
            } catch (Exception e) {
                kdf = prev;
                throw e;
            }
            return "";
        } catch (Exception e) {
            return "取消失败：" + msg(e);
        }
    }

    /** 加密备份文件内容：与数据库文件同格式，用数据库密码可在任何设备上打开。 */
    synchronized byte[] backupBytes(String json) throws Exception {
        if (kdf == null) throw new IllegalStateException("请先设置密码");
        return seal(json);
    }

    /** 解开一个备份文件（.db）：本机的直接解开，其他设备的需要密码。不改变当前数据库。 */
    synchronized String decryptFile(String text, String pwd) {
        JSONObject env;
        try {
            env = parseEnv(text);
            if (!"xjdb".equals(env.optString("fmt"))) throw new IOException();
        } catch (Exception e) {
            return fail("不是有效的洵记备份文件");
        }
        try {
            byte[] plain = dek == null ? null : decrypt(env, dek);
            if (plain == null) {
                JSONObject k = env.optJSONObject("kdf");
                if (k == null) return fail("该备份没有设置密码，只能在创建它的设备上打开");
                if (pwd == null || pwd.isEmpty()) return obj("ok", false, "need", "password");
                byte[] key = unwrap(k, pwd);
                if (key == null) return fail("密码错误");
                plain = decrypt(env, key);
                if (plain == null) return fail("备份文件已损坏");
            }
            return stage(plain);
        } catch (Exception e) {
            return fail("解密失败：" + msg(e));
        }
    }

    synchronized String info() {
        Uri d = dir();
        File db = new File(ctx.getFilesDir(), FILE_NAME);
        String export = android.os.Build.VERSION.SDK_INT >= 29 ? "内部存储/Download/" + MainActivity.EXPORT_DIR
                : String.valueOf(ctx.getExternalFilesDir(null));
        return obj("label", d == null ? "App 内部存储（默认）" : label(d), "custom", d != null,
                "hasPwd", kdf != null, "file", FILE_NAME,
                "path", d == null ? db.getAbsolutePath() : label(d) + "/" + FILE_NAME,
                "defaultPath", db.getAbsolutePath(),
                "backupPath", new File(ctx.getFilesDir(), "backups").getAbsolutePath(),
                "exportPath", export);
    }

    /** 系统目录选择器返回后调用（UI 线程）。 */
    synchronized String setPending(Uri tree) {
        try {
            pendingDir = tree;
            return obj("ok", true, "exists", find(tree) != null, "label", label(tree));
        } catch (Exception e) {
            pendingDir = null;
            return fail("无法访问该目录：" + msg(e));
        }
    }

    /** mode = open：改用目录中已有的数据库；write：把当前数据写到该目录。 */
    synchronized String useDir(String mode, String json) {
        Uri target = pendingDir;
        if (target == null) return fail("请先选择目录");
        try {
            if ("write".equals(mode)) write(target, seal(json));
            else if (find(target) == null) return fail("该目录中没有数据库文件");
            switchDir(target);
            pendingDir = null;
            return obj("ok", true, "label", label(target));
        } catch (Exception e) {
            return fail("切换失败：" + msg(e));
        }
    }

    synchronized String useDefault(String json) {
        try {
            if (json != null && !json.isEmpty()) write(null, seal(json));
            switchDir(null);
            return obj("ok", true);
        } catch (Exception e) {
            return fail("切换失败：" + msg(e));
        }
    }

    /* ---------------- 文件位置 ---------------- */

    private Uri dir() {
        String s = prefs.getString(P_DIR, null);
        return s == null ? null : Uri.parse(s);
    }

    private void switchDir(Uri d) {
        Uri old = dir();
        if (d == null) prefs.edit().remove(P_DIR).commit();
        else prefs.edit().putString(P_DIR, d.toString()).commit();
        if (old != null && !old.equals(d)) {
            try {
                cr().releasePersistableUriPermission(old, RW);
            } catch (Exception ignored) {
            }
        }
    }

    private ContentResolver cr() {
        return ctx.getContentResolver();
    }

    private AtomicFile local() {
        return new AtomicFile(new File(ctx.getFilesDir(), FILE_NAME));
    }

    private byte[] read(Uri tree) throws IOException {
        if (tree == null) {
            try {
                return local().readFully();
            } catch (FileNotFoundException e) {
                return null;
            }
        }
        Uri doc = find(tree);
        if (doc == null) return null;
        try (InputStream in = cr().openInputStream(doc)) {
            if (in == null) throw new IOException("无法读取文件");
            return readAll(in);
        }
    }

    private void write(Uri tree, byte[] data) throws IOException {
        if (tree == null) {
            AtomicFile f = local();
            FileOutputStream os = f.startWrite();
            try {
                os.write(data);
                f.finishWrite(os);
            } catch (IOException e) {
                f.failWrite(os);
                throw e;
            }
            return;
        }
        Uri doc = find(tree);
        if (doc == null) {
            Uri parent = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
            doc = DocumentsContract.createDocument(cr(), parent, "application/octet-stream", FILE_NAME);
            if (doc == null) throw new IOException("无法在该目录创建文件");
        }
        try (OutputStream os = cr().openOutputStream(doc, "wt")) {
            if (os == null) throw new IOException("无法写入文件");
            os.write(data);
        }
    }

    private Uri find(Uri tree) throws IOException {
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
        String[] cols = {DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME};
        try (Cursor c = cr().query(children, cols, null, null, null)) {
            if (c == null) throw new IOException("无法读取目录");
            while (c.moveToNext()) {
                if (FILE_NAME.equals(c.getString(1))) return DocumentsContract.buildDocumentUriUsingTree(tree, c.getString(0));
            }
            return null;
        } catch (SecurityException e) {
            throw new IOException("没有该目录的访问权限，请重新选择", e);
        }
    }

    static String label(Uri tree) {
        try {
            String id = DocumentsContract.getTreeDocumentId(tree);
            int i = id.indexOf(':');
            if (i < 0) return id;
            String vol = id.substring(0, i), path = id.substring(i + 1);
            return ("primary".equals(vol) ? "内部存储" : "存储卡 " + vol) + (path.isEmpty() ? "" : "/" + path);
        } catch (Exception e) {
            return tree.toString();
        }
    }

    /* ---------------- 加密 ---------------- */

    /** 分段保存：meta 是不含 txns 的 JSON 对象，parts 是按年份切好的流水 JSON 片段，拼成 {...meta,"txns":[parts]} 写盘。 */
    synchronized String saveParts(String meta, java.util.List<String> parts) {
        try {
            if (dek == null) throw new IllegalStateException("数据库未解锁");
            ByteArrayOutputStream bo = new ByteArrayOutputStream(1 << 20);
            try (java.io.Writer w = new java.io.BufferedWriter(new java.io.OutputStreamWriter(new GZIPOutputStream(bo, 1 << 16), StandardCharsets.UTF_8), 1 << 16)) {
                w.write(meta, 0, meta.length() - 1);
                w.write(meta.length() > 2 ? ",\"txns\":[" : "\"txns\":[");
                for (int i = 0; i < parts.size(); i++) {
                    if (i > 0) w.write(',');
                    w.write(parts.get(i));
                }
                w.write("]}");
            }
            write(dir(), envelope(bo.toByteArray()));
            dirty = true;
            return "";
        } catch (Exception e) {
            return msg(e);
        }
    }

    private byte[] seal(String json) throws Exception {
        if (dek == null) throw new IllegalStateException("数据库未解锁");
        return envelope(gzip(json.getBytes(StandardCharsets.UTF_8)));
    }

    /** gzip 后的明文 → 加密后的数据库文件内容 */
    private byte[] envelope(byte[] gz) throws Exception {
        JSONObject env = new JSONObject().put("fmt", "xjdb").put("v", 1).put("alg", "AES-256-GCM");
        if (kdf != null) env.put("kdf", kdf);
        env.put("data", b64(gcmSeal(dek, gz)));
        return env.toString().getBytes(StandardCharsets.UTF_8);
    }

    /** 密钥不对时返回 null；返回解压后的明文 UTF-8 字节。 */
    private static byte[] decrypt(JSONObject env, byte[] key) throws Exception {
        byte[] plain;
        try {
            plain = gcmOpen(key, b64d(env.getString("data")));
        } catch (GeneralSecurityException e) {
            return null;
        }
        return gunzip(plain);
    }

    private static byte[] unwrap(JSONObject k, String pwd) throws Exception {
        byte[] kek = pbkdf2(pwd, b64d(k.getString("salt")), k.getInt("iter"));
        try {
            return gcmOpen(kek, b64d(k.getString("wk")));
        } catch (GeneralSecurityException e) {
            return null;
        }
    }

    private byte[] gcmSeal(byte[] key, byte[] plain) throws GeneralSecurityException {
        byte[] iv = random(12);
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, iv));
        byte[] ct = c.doFinal(plain);
        byte[] out = new byte[iv.length + ct.length];
        System.arraycopy(iv, 0, out, 0, iv.length);
        System.arraycopy(ct, 0, out, iv.length, ct.length);
        return out;
    }

    private static byte[] gcmOpen(byte[] key, byte[] blob) throws GeneralSecurityException {
        if (blob.length < 12 + 16) throw new GeneralSecurityException("数据过短");
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, blob, 0, 12));
        return c.doFinal(blob, 12, blob.length - 12);
    }

    /** PBKDF2-HMAC-SHA256，输出 32 字节（单块）。系统的 PBKDF2WithHmacSHA256 要 API 26 才有。 */
    private static byte[] pbkdf2(String pwd, byte[] salt, int iter) throws GeneralSecurityException {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(pwd.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        mac.update(salt);
        mac.update(new byte[]{0, 0, 0, 1});
        byte[] u = mac.doFinal(), t = u.clone();
        for (int i = 1; i < iter; i++) {
            u = mac.doFinal(u);
            for (int j = 0; j < t.length; j++) t[j] ^= u[j];
        }
        return t;
    }

    private SecretKey deviceKey() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        SecretKey k = (SecretKey) ks.getKey(KS_ALIAS, null);
        if (k != null) return k;
        KeyGenerator g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        g.init(new KeyGenParameterSpec.Builder(KS_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return g.generateKey();
    }

    /** 还没有数据密钥时：先取本机保存的，没有就新建一把并存起来 */
    private void ensureKey() throws Exception {
        if (dek == null) dek = loadLocalKey();
        if (dek == null) {
            dek = random(32);
            saveLocalKey(dek);
        }
    }

    private void saveLocalKey(byte[] key) throws Exception {
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, deviceKey());
        byte[] iv = c.getIV(), ct = c.doFinal(key);
        prefs.edit().putString(P_KEY, b64(iv) + ":" + b64(ct)).commit();
    }

    /** 本机没有、或 Keystore 密钥已失效（如备份恢复到新手机）时返回 null。 */
    private byte[] loadLocalKey() {
        String s = prefs.getString(P_KEY, null);
        if (s == null) return null;
        try {
            String[] p = s.split(":");
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, deviceKey(), new GCMParameterSpec(128, b64d(p[0])));
            return c.doFinal(b64d(p[1]));
        } catch (Exception e) {
            return null;
        }
    }

    /* ---------------- 工具 ---------------- */

    private byte[] random(int n) {
        byte[] b = new byte[n];
        rnd.nextBytes(b);
        return b;
    }

    private static String b64(byte[] b) {
        return Base64.encodeToString(b, Base64.NO_WRAP);
    }

    private static byte[] b64d(String s) {
        return Base64.decode(s, Base64.NO_WRAP);
    }

    private static byte[] gzip(byte[] b) throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        try (GZIPOutputStream gz = new GZIPOutputStream(bos)) {
            gz.write(b);
        }
        return bos.toByteArray();
    }

    private static byte[] gunzip(byte[] b) throws IOException {
        try (GZIPInputStream in = new GZIPInputStream(new ByteArrayInputStream(b))) {
            return readAll(in);
        }
    }

    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n;
        while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
        return bos.toByteArray();
    }

    private static String msg(Exception e) {
        return e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
    }

    static String obj(Object... kv) {
        JSONObject o = new JSONObject();
        try {
            for (int i = 0; i < kv.length; i += 2) o.put((String) kv[i], kv[i + 1] == null ? JSONObject.NULL : kv[i + 1]);
        } catch (JSONException ignored) {
        }
        return o.toString();
    }

    private static String fail(String err) {
        return obj("ok", false, "err", err);
    }
}
