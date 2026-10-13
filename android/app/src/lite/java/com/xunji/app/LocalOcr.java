package com.xunji.app;

import android.content.Context;

/** 正式版不内置 OCR 模型；available() 为 false 时页面不显示任何识别导入入口。 */
final class LocalOcr {
    private LocalOcr() {
    }

    static boolean available() {
        return false;
    }

    static String recognize(Context ctx, byte[] image, String optsJson) {
        throw new UnsupportedOperationException("此版本不支持本机识别");
    }

    static void release() {
    }
}
