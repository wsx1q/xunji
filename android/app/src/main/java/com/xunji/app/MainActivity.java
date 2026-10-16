package com.xunji.app;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.ClipData;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Color;
import android.hardware.biometrics.BiometricPrompt;
import android.hardware.fingerprint.FingerprintManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private static boolean processStarted;
    private final long activityStartedAt = android.os.SystemClock.elapsedRealtime();
    private boolean coldStart;
    private static final int REQ_FILE = 1001, REQ_DIR = 1002;
    static final String EXPORT_DIR = "XunJi";
    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private SecureStore store;
    private CancellationSignal bioCancel;
    private final Executor bioEx = Executors.newSingleThreadExecutor();
    private final Executor ocrEx = Executors.newSingleThreadExecutor();
    /* 离开识别页不马上释放模型：3 分钟内回来不用重新加载；内存紧张时立即释放 */
    private final android.os.Handler ui = new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable ocrRelease = () -> ocrEx.execute(LocalOcr::release);
    private static final long OCR_KEEP_MS = 3 * 60_000;
    /* 后台保存：JS 只传有变化的年份片段，这里攒齐后在单线程里加密写盘；连续保存只写最后一次 */
    private final java.util.concurrent.ExecutorService saveEx = Executors.newSingleThreadExecutor();
    private final java.util.Map<String, String> parts = new java.util.HashMap<>();
    private final Object saveLock = new Object();
    private String pendingMeta;
    private java.util.List<String> pendingParts;
    private boolean saveQueued;
    private String lastSaveError = "";

    private void drainSave() {
        while (true) {
            String meta;
            java.util.List<String> list;
            synchronized (saveLock) {
                meta = pendingMeta;
                list = pendingParts;
                pendingMeta = null;
                pendingParts = null;
                if (meta == null) {
                    saveQueued = false;
                    return;
                }
            }
            String err = store.saveParts(meta, list);
            synchronized (saveLock) {
                lastSaveError = err;
            }
            if (!err.isEmpty()) {
                final String m = err;
                runOnUiThread(() -> web.evaluateJavascript("window.onSaveError && onSaveError(" + JSONObject.quote(m) + ")", null));
            }
        }
    }

    private void cancelPendingSave() {
        synchronized (saveLock) {
            pendingMeta = null;
            pendingParts = null;
        }
    }

    private void waitSaves() {
        try {
            saveEx.submit(() -> {
            }).get();
        } catch (Exception ignored) {
        }
    }
    private String sharedFile;
    private boolean screenOff;
    private final BroadcastReceiver screenRx = new BroadcastReceiver() {
        @Override
        public void onReceive(Context c, Intent i) {
            screenOff = true;
            if (web != null) web.evaluateJavascript("window.lockNow && lockNow()", null);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        coldStart = !processStarted;
        processStarted = true;
        store = new SecureStore(this);
        registerReceiver(screenRx, new IntentFilter(Intent.ACTION_SCREEN_OFF));
        if (LocalOcr.available()) WebView.setWebContentsDebuggingEnabled(true);
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#F4F5F7"));
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setTextZoom(100);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);

        web.addJavascriptInterface(new Bridge(), "Android");
        web.setWebViewClient(new WebViewClient());
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                boolean image = false;
                for (String t : params.getAcceptTypes()) if (t != null && t.startsWith("image")) image = true;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType(image ? "image/*" : "*/*");
                if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE)
                    i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try {
                    startActivityForResult(Intent.createChooser(i, image ? "选择账单截图" : "选择文件"), REQ_FILE);
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });
        readShared(getIntent());
        maybeBench(getIntent());
        web.loadUrl("file:///android_asset/index.html");
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE && fileCallback != null) {
            Uri[] uris = null;
            if (resultCode == RESULT_OK && data != null && data.getClipData() != null) {
                ClipData clip = data.getClipData();
                uris = new Uri[clip.getItemCount()];
                for (int k = 0; k < uris.length; k++) uris[k] = clip.getItemAt(k).getUri();
            } else {
                uris = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            }
            fileCallback.onReceiveValue(uris);
            fileCallback = null;
            return;
        }
        if (requestCode == REQ_DIR) {
            String res;
            Uri tree = data == null ? null : data.getData();
            if (resultCode != RESULT_OK || tree == null) {
                res = SecureStore.obj("ok", false);
            } else {
                try {
                    getContentResolver().takePersistableUriPermission(tree,
                            Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                    res = store.setPending(tree);
                } catch (Exception e) {
                    res = SecureStore.obj("ok", false, "err", "无法获取该目录的读写权限");
                }
            }
            dirResult(res);
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    private void dirResult(String json) {
        web.evaluateJavascript("window.onDbDirPicked && onDbDirPicked(" + JSONObject.quote(json) + ")", null);
    }

    private void bioResult(boolean ok, String err) {
        runOnUiThread(() -> web.evaluateJavascript(
                "window.onBioResult && onBioResult(" + ok + "," + JSONObject.quote(err == null ? "" : err) + ")", null));
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.appBack ? window.appBack() : false", value -> {
            if (!"true".equals(value)) moveTaskToBack(true);
        });
    }

    @Override
    protected void onPause() {
        web.evaluateJavascript("window.onAppPause && onAppPause()", null);
        if (bioCancel != null) {
            bioCancel.cancel();
            bioCancel = null;
        }
        super.onPause();
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        if (screenOff) {
            screenOff = false;
            web.evaluateJavascript("window.onScreenBack && onScreenBack()", null);
        }
    }

    @Override
    public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        // RUNNING_LOW / RUNNING_CRITICAL（前台内存紧张）或 MODERATE 以上（后台快被杀）时释放；
        // 只是切到后台（UI_HIDDEN / BACKGROUND，比如去截个图）不释放
        if ((level >= TRIM_MEMORY_RUNNING_LOW && level < TRIM_MEMORY_UI_HIDDEN) || level >= TRIM_MEMORY_MODERATE) {
            ui.removeCallbacks(ocrRelease);
            ocrEx.execute(LocalOcr::release);
        }
    }

    @Override
    protected void onDestroy() {
        try {
            unregisterReceiver(screenRx);
        } catch (Exception ignored) {
        }
        // 模型是静态持有的，Activity 销毁后不会再有人来释放，这里直接释放
        ui.removeCallbacks(ocrRelease);
        ocrEx.execute(LocalOcr::release);
        super.onDestroy();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        maybeBench(intent);
        if (readShared(intent)) web.evaluateJavascript("window.onSharedFile && onSharedFile()", null);
    }

    /**
     * OCR 测速：adb shell am start -n com.xunji.app.ocr/com.xunji.app.MainActivity --es ocrbench v5,v5q
     * 结果写 logcat（标签 OCRBENCH）。只在 OCR 版有效；用反射调用，离线版的空实现不用改。
     */
    private void maybeBench(Intent intent) {
        if (intent == null || !LocalOcr.available()) return;
        String models = intent.getStringExtra("ocrbench");
        if (models == null) return;
        intent.removeExtra("ocrbench");
        ocrEx.execute(() -> {
            String r;
            try {
                r = (String) LocalOcr.class.getDeclaredMethod("bench", Context.class, String.class)
                        .invoke(null, getApplicationContext(), models);
            } catch (java.lang.reflect.InvocationTargetException e) {
                r = "BENCH ERROR " + e.getCause() + "\nBENCH DONE";
            } catch (Throwable e) {
                r = "BENCH ERROR " + e + "\nBENCH DONE";
            }
            if (r.contains("ERROR")) android.util.Log.w("OCRBENCH", r);
        });
    }

    /** 「用其他应用打开」/ 分享进来的账单文件，先读到内存，等页面加载完数据后由 JS 取走 */
    private boolean readShared(Intent intent) {
        if (intent == null) return false;
        Uri uri = null;
        if (Intent.ACTION_VIEW.equals(intent.getAction())) uri = intent.getData();
        else if (Intent.ACTION_SEND.equals(intent.getAction())) uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        if (uri == null) return false;
        String name = "";
        try (android.database.Cursor c = getContentResolver().query(uri, new String[]{android.provider.OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) name = c.getString(0);
        } catch (Exception ignored) {
        }
        if (name == null || name.isEmpty()) name = uri.getLastPathSegment();
        try (java.io.InputStream in = getContentResolver().openInputStream(uri)) {
            java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[1 << 16];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                if (out.size() > 30 << 20) throw new java.io.IOException("文件太大");
            }
            sharedFile = SecureStore.obj("name", name, "data", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
        } catch (Exception e) {
            sharedFile = SecureStore.obj("err", "无法读取文件：" + e.getMessage());
        }
        return true;
    }

    @SuppressWarnings("deprecation")
    private String bioStatus() {
        if (Build.VERSION.SDK_INT >= 28) {
            android.hardware.biometrics.BiometricManager bm =
                    getSystemService(android.hardware.biometrics.BiometricManager.class);
            if (bm == null) return SecureStore.obj("ok", false, "reason", "本机不支持指纹解锁");
            int can = bm.canAuthenticate();
            if (can == android.hardware.biometrics.BiometricManager.BIOMETRIC_SUCCESS)
                return SecureStore.obj("ok", true, "reason", "");
            if (can == android.hardware.biometrics.BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED)
                return SecureStore.obj("ok", false, "reason", "请先在系统设置中添加指纹");
            return SecureStore.obj("ok", false, "reason", "本机不支持指纹解锁");
        }
        FingerprintManager fm = getSystemService(FingerprintManager.class);
        if (fm == null || !fm.isHardwareDetected())
            return SecureStore.obj("ok", false, "reason", "本机不支持指纹解锁");
        if (!fm.hasEnrolledFingerprints())
            return SecureStore.obj("ok", false, "reason", "请先在系统设置中添加指纹");
        return SecureStore.obj("ok", true, "reason", "");
    }

    @SuppressWarnings("deprecation")
    private void startBio(String title) {
        if (bioCancel != null) bioCancel.cancel();
        bioCancel = new CancellationSignal();
        final String t = title == null || title.isEmpty() ? "解锁洵记" : title;
        if (Build.VERSION.SDK_INT >= 28) {
            BiometricPrompt prompt = new BiometricPrompt.Builder(this)
                    .setTitle(t)
                    .setSubtitle("使用指纹验证身份")
                    .setNegativeButton("使用密码", getMainExecutor(), (d, w) -> bioResult(false, ""))
                    .build();
            prompt.authenticate(bioCancel, bioEx, new BiometricPrompt.AuthenticationCallback() {
                @Override
                public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                    bioResult(true, "");
                }

                @Override
                public void onAuthenticationError(int errorCode, CharSequence errString) {
                    // 5=CANCELED, 10=USER_CANCELED, 13=NEGATIVE_BUTTON
                    if (errorCode == BiometricPrompt.BIOMETRIC_ERROR_CANCELED
                            || errorCode == BiometricPrompt.BIOMETRIC_ERROR_USER_CANCELED
                            || errorCode == 13) {
                        bioResult(false, "");
                    } else {
                        bioResult(false, errString != null ? errString.toString() : "指纹验证失败");
                    }
                }

                @Override
                public void onAuthenticationFailed() {
                }
            });
            return;
        }
        FingerprintManager fm = getSystemService(FingerprintManager.class);
        if (fm == null) {
            bioResult(false, "本机不支持指纹解锁");
            return;
        }
        fm.authenticate(null, bioCancel, 0, new FingerprintManager.AuthenticationCallback() {
            @Override
            public void onAuthenticationSucceeded(FingerprintManager.AuthenticationResult result) {
                bioResult(true, "");
            }

            @Override
            public void onAuthenticationError(int errorCode, CharSequence errString) {
                bioResult(false, errString != null ? errString.toString() : "指纹验证失败");
            }

            @Override
            public void onAuthenticationFailed() {
            }
        }, null);
    }

    private class Bridge {
        @JavascriptInterface
        public String appVersion() {
            return BuildConfig.VERSION_NAME;
        }

        /** 是否显示压力测试等开发用功能（OCR 版和本地 lite Beta 开启） */
        @JavascriptInterface
        public boolean testTools() {
            return BuildConfig.TEST_TOOLS;
        }

        /** 首次 Activity 从进程启动计时，重建则从本次 Activity 创建计时。 */
        @JavascriptInterface
        public String startupInfo() {
            long start = coldStart ? android.os.Process.getStartElapsedRealtime() : activityStartedAt;
            return "{\"cold\":" + coldStart + ",\"elapsedMs\":"
                    + (android.os.SystemClock.elapsedRealtime() - start) + "}";
        }

        /** 不阻塞 WebView；只有后台压缩、加密和写盘返回后，saving 才会变成 false。 */
        @JavascriptInterface
        public String dbSaveStatus() {
            synchronized (saveLock) {
                return "{\"saving\":" + saveQueued + ",\"error\":" + JSONObject.quote(lastSaveError) + "}";
            }
        }

        @JavascriptInterface
        public String dbOpen() {
            cancelPendingSave();
            return store.open();
        }

        /** 分段取 dbOpen / dbUnlock / restoreBackup / decryptBackup 暂存的明文 */
        @JavascriptInterface
        public String dbChunk(int i) {
            return store.chunk(i);
        }

        @JavascriptInterface
        public void dbChunkDrop() {
            store.dropStaged();
        }

        @JavascriptInterface
        public String dbUnlock(String pwd) {
            cancelPendingSave();
            return store.unlock(pwd);
        }

        @JavascriptInterface
        public String dbCreate() {
            cancelPendingSave();
            return store.create();
        }

        @JavascriptInterface
        public String dbSave(String json) {
            cancelPendingSave();
            return store.save(json);
        }

        @JavascriptInterface
        public void dbPart(String year, String json) {
            synchronized (saveLock) {
                parts.put(year, json);
            }
        }

        /** years：按顺序的年份列表（逗号分隔）。缺片段返回 "missing"，JS 会全部重传。 */
        @JavascriptInterface
        public String dbCommit(String meta, String years) {
            synchronized (saveLock) {
                java.util.List<String> list = new java.util.ArrayList<>();
                java.util.Set<String> keep = new java.util.HashSet<>();
                if (!years.isEmpty()) {
                    for (String y : years.split(",")) {
                        String p = parts.get(y);
                        if (p == null) return "missing";
                        list.add(p);
                        keep.add(y);
                    }
                }
                parts.keySet().retainAll(keep);
                pendingMeta = meta;
                pendingParts = list;
                if (!saveQueued) {
                    saveQueued = true;
                    saveEx.execute(MainActivity.this::drainSave);
                }
            }
            return "";
        }

        @JavascriptInterface
        public void dbWait() {
            waitSaves();
        }

        @JavascriptInterface
        public boolean dbHasPassword() {
            return store.hasPassword();
        }

        @JavascriptInterface
        public String dbSetPassword(String old, String pwd, String json) {
            cancelPendingSave();
            return store.setPassword(old, pwd, json);
        }

        @JavascriptInterface
        public String dbInfo() {
            return store.info();
        }

        @JavascriptInterface
        public void dbPickDir() {
            runOnUiThread(() -> {
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                        | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
                try {
                    startActivityForResult(i, REQ_DIR);
                } catch (Exception e) {
                    dirResult(SecureStore.obj("ok", false, "err", "系统不支持选择目录"));
                }
            });
        }

        @JavascriptInterface
        public String dbUseDir(String mode, String json) {
            cancelPendingSave();
            return store.useDir(mode, json);
        }

        @JavascriptInterface
        public String dbUseDefault(String json) {
            cancelPendingSave();
            return store.useDefault(json);
        }

        /** 排在待写的保存之后执行，不阻塞界面。 */
        @JavascriptInterface
        public String autoBackup(int days) {
            saveEx.execute(() -> store.autoBackup(days));
            return "";
        }

        @JavascriptInterface
        public String forceBackup() {
            waitSaves();
            return store.forceBackup();
        }

        @JavascriptInterface
        public String listBackups() {
            return store.listBackups();
        }

        @JavascriptInterface
        public String restoreBackup(String name) {
            cancelPendingSave();
            return store.restoreBackup(name);
        }

        @JavascriptInterface
        public String bioAvailable() {
            return bioStatus();
        }

        @JavascriptInterface
        public void bioAuth(String title) {
            runOnUiThread(() -> startBio(title));
        }

        /** 读取官方随手记的本地备份 .kbf（data URL 或纯 base64），返回整理好的账户 / 分类 / 流水 JSON */
        @JavascriptInterface
        public String readKbf(String base64) {
            try {
                byte[] data = Base64.decode(base64.substring(base64.indexOf(',') + 1), Base64.DEFAULT);
                return KbfReader.read(MainActivity.this, data);
            } catch (Throwable e) {
                return SecureStore.obj("ok", false, "err", e instanceof OutOfMemoryError ? "内存不足" : "读取失败：" + e.getMessage());
            }
        }

        @JavascriptInterface
        public String takeSharedFile() {
            String s = sharedFile;
            sharedFile = null;
            return s == null ? "" : s;
        }

        @JavascriptInterface
        public boolean ocrLocalAvailable() {
            return LocalOcr.available();
        }

        @JavascriptInterface
        public void ocrLocal(String id, String base64, String opts) {
            ui.removeCallbacks(ocrRelease);
            ocrEx.execute(() -> {
                String res;
                try {
                    byte[] data = Base64.decode(base64.substring(base64.indexOf(',') + 1), Base64.DEFAULT);
                    res = LocalOcr.recognize(MainActivity.this, data, opts);
                } catch (Throwable e) {
                    LocalOcr.release();
                    res = SecureStore.obj("ok", false, "err", e instanceof OutOfMemoryError ? "内存不足" : String.valueOf(e.getMessage()));
                }
                final String json = res;
                runOnUiThread(() -> web.evaluateJavascript(
                        "window.onOcrLocal && onOcrLocal(" + JSONObject.quote(id) + "," + JSONObject.quote(json) + ")", null));
            });
        }

        @JavascriptInterface
        public void ocrLocalRelease() {
            ui.removeCallbacks(ocrRelease);
            ui.postDelayed(ocrRelease, OCR_KEEP_MS);
        }

        @JavascriptInterface
        public boolean dbCheckPassword(String pwd) {
            return store.checkPassword(pwd);
        }

        @JavascriptInterface
        public String dbClearPassword(String old, String json) {
            cancelPendingSave();
            return store.clearPassword(old, json);
        }

        @JavascriptInterface
        public String exportBackup(String name, String json) {
            try {
                return saveBytes(name, store.backupBytes(json));
            } catch (Exception e) {
                return "备份失败：" + e.getMessage();
            }
        }

        @JavascriptInterface
        public String decryptBackup(String text, String pwd) {
            return store.decryptFile(text, pwd);
        }

        @JavascriptInterface
        public String saveFile(String name, String content) {
            return saveBytes(name, content.getBytes(StandardCharsets.UTF_8));
        }
    }

    private String saveBytes(String name, byte[] bytes) {
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.Downloads.DISPLAY_NAME, name);
                // 目录用纯英文：部分文件管理器 / 电脑 MTP / 云盘同步对中文目录名支持不好
                v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/" + EXPORT_DIR);
                Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (uri == null) throw new Exception("insert failed");
                try (OutputStream os = getContentResolver().openOutputStream(uri)) {
                    os.write(bytes);
                }
                return "已保存到 Download/" + EXPORT_DIR + "/" + name;
            } else {
                File dir = getExternalFilesDir(null);
                File f = new File(dir, name);
                try (FileOutputStream os = new FileOutputStream(f)) {
                    os.write(bytes);
                }
                return "已保存到 " + f.getAbsolutePath();
            }
        } catch (Exception e) {
            return "保存失败：" + e.getMessage();
        }
    }
}
