package com.xunji.app;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * 读取官方「随手记」的本地备份 .kbf：它是一个 zip，里面是 mymoney.sqlite，
 * 只是把 SQLite 文件头前 16 字节抹成了 0（不是加密）。补回文件头后用系统 SQLite 只读打开，
 * 把账户 / 分类 / 成员 / 项目 / 商家 / 流水整理成 JSON 交给页面导入。
 *
 * 随手记 t_transaction.type：0 支出（buyerAccount 付款、sellerCategory 分类）；1 收入（buyerCategory 分类、sellerAccount 收款）；
 * 2 / 3 转账的两条（relation 相同，buyerAccount 转出、sellerAccount 转入）；8 余额变更（sellerAccount，金额带正负号）。
 * 用一份真实备份（6137 条、16 个账户）核对过：按这个规则重算的每个账户余额与随手记里记录的余额完全一致。
 */
final class KbfReader {
    private KbfReader() {
    }

    private static final byte[] SQLITE_MAGIC = "SQLite format 3\0".getBytes(StandardCharsets.US_ASCII);

    static String read(Context ctx, byte[] kbf) throws Exception {
        File tmp = new File(ctx.getCacheDir(), "kbf_" + System.nanoTime() + ".sqlite");
        try {
            if (!unzipDb(kbf, tmp)) return SecureStore.obj("ok", false, "err", "不是随手记备份文件（.kbf 里没有 mymoney.sqlite）");
            SQLiteDatabase db;
            try {
                db = SQLiteDatabase.openDatabase(tmp.getPath(), null, SQLiteDatabase.OPEN_READONLY);
            } catch (Exception e) {
                return SecureStore.obj("ok", false, "err", "无法打开随手记数据库：" + e.getMessage());
            }
            try {
                return parse(db).toString();
            } finally {
                db.close();
            }
        } finally {
            //noinspection ResultOfMethodCallIgnored
            tmp.delete();
            //noinspection ResultOfMethodCallIgnored
            new File(tmp.getPath() + "-journal").delete();
        }
    }

    private static boolean unzipDb(byte[] kbf, File out) throws Exception {
        try (ZipInputStream zin = new ZipInputStream(new ByteArrayInputStream(kbf))) {
            ZipEntry e;
            while ((e = zin.getNextEntry()) != null) {
                if (e.isDirectory() || !e.getName().toLowerCase().endsWith(".sqlite")) continue;
                try (FileOutputStream fo = new FileOutputStream(out)) {
                    byte[] buf = new byte[1 << 16];
                    int n, pos = 0;
                    while ((n = zin.read(buf)) > 0) {
                        if (pos < 16) { // 补回被抹掉的 SQLite 文件头
                            for (int i = 0; i < n && pos + i < 16; i++) buf[i] = SQLITE_MAGIC[pos + i];
                        }
                        fo.write(buf, 0, n);
                        pos += n;
                    }
                }
                return true;
            }
        }
        return false;
    }

    private static JSONObject parse(SQLiteDatabase db) throws Exception {
        // 账户及其分组（分组决定账户类型：现金 / 储蓄卡 / 在线支付 / 信用卡 / 负债 / 债权 / 投资…）
        Map<Long, String[]> groups = new HashMap<>(); // id -> {name, type, parent}
        try (Cursor c = db.rawQuery("SELECT accountGroupPOID, name, type, parentAccountGroupPOID FROM t_account_group", null)) {
            while (c.moveToNext()) groups.put(c.getLong(0), new String[]{c.getString(1), c.getString(2), c.getString(3)});
        }
        JSONArray accounts = new JSONArray();
        Set<Long> accIds = new HashSet<>();
        try (Cursor c = db.rawQuery("SELECT accountPOID, name, accountGroupPOID, memo, hidden, currencyType FROM t_account ORDER BY ordered", null)) {
            while (c.moveToNext()) {
                String[] g = groups.get(c.getLong(2));
                String[] pg = g == null ? null : groups.get(parseLong(g[2]));
                accounts.put(new JSONObject().put("id", String.valueOf(c.getLong(0))).put("name", trim(c.getString(1)))
                        .put("group", g == null ? "" : trim(g[0])).put("pgroup", pg == null ? "" : trim(pg[0]))
                        .put("gtype", g == null ? 0 : parseLong(g[1])).put("memo", trim(c.getString(3)))
                        .put("hidden", c.getInt(4) == 1).put("cur", trim(c.getString(5))));
                accIds.add(c.getLong(0));
            }
        }
        // 分类：depth 1 一级、depth 2 二级；type 0 支出、1 收入
        JSONArray cats = new JSONArray();
        Map<Long, Integer> catDepth = new HashMap<>();
        try (Cursor c = db.rawQuery("SELECT categoryPOID, name, parentCategoryPOID, type, depth FROM t_category WHERE depth IN (1,2) AND type IN (0,1) ORDER BY depth, ordered", null)) {
            while (c.moveToNext()) {
                cats.put(new JSONObject().put("id", String.valueOf(c.getLong(0))).put("name", trim(c.getString(1)))
                        .put("pid", c.getInt(4) == 2 ? String.valueOf(c.getLong(2)) : "").put("type", c.getInt(3) == 1 ? "income" : "expense"));
                catDepth.put(c.getLong(0), c.getInt(4));
            }
        }
        // 成员（tagType 2）/ 项目（tagType 1）
        Map<Long, String> tagName = new HashMap<>();
        try (Cursor c = db.rawQuery("SELECT tagPOID, name FROM t_tag", null)) {
            while (c.moveToNext()) tagName.put(c.getLong(0), trim(c.getString(1)));
        }
        Map<Long, String> members = new HashMap<>(), projects = new HashMap<>();
        try (Cursor c = db.rawQuery("SELECT transactionPOID, projectCategoryPOID, type FROM t_transaction_projectcategory_map", null)) {
            while (c.moveToNext()) {
                String n = tagName.get(c.getLong(1));
                if (n == null || n.isEmpty()) continue;
                Map<Long, String> m = c.getInt(2) == 2 ? members : projects;
                String old = m.get(c.getLong(0));
                m.put(c.getLong(0), old == null ? n : old + "、" + n);
            }
        }
        // 商家
        Map<Long, String> entity = new HashMap<>();
        try (Cursor c = db.rawQuery("SELECT tradingEntityPOID, name FROM t_tradingEntity", null)) {
            while (c.moveToNext()) entity.put(c.getLong(0), trim(c.getString(1)));
        }

        // 流水：[类型, 时间ms, 金额, 账户, 转入账户, 分类, 备注, 商家, 成员, 项目, 去重键]
        JSONArray txns = new JSONArray();
        Set<String> seenRel = new HashSet<>();
        int skipped = 0;
        long minT = Long.MAX_VALUE, maxT = 0;
        try (Cursor c = db.rawQuery("SELECT transactionPOID, createdTime, tradeTime, memo, type, buyerAccountPOID, buyerCategoryPOID, buyerMoney, "
                + "sellerAccountPOID, sellerCategoryPOID, sellerMoney, relationUnitPOID, relation FROM t_transaction ORDER BY tradeTime", null)) {
            while (c.moveToNext()) {
                long poid = c.getLong(0), created = c.getLong(1), t = c.getLong(2);
                int type = c.getInt(4);
                long ba = c.getLong(5), bc = c.getLong(6), sa = c.getLong(8), sc = c.getLong(9);
                double bm = c.getDouble(7), sm = c.getDouble(10);
                String kind, acc, to = "", cat = "";
                double amt;
                if (type == 0) {
                    kind = "expense"; acc = id(ba); cat = catDepth.containsKey(sc) ? id(sc) : ""; amt = bm;
                } else if (type == 1) {
                    kind = "income"; acc = id(sa); cat = catDepth.containsKey(bc) ? id(bc) : ""; amt = sm;
                } else if (type == 2 || type == 3) {
                    String rel = c.getString(12);
                    if (rel != null && !rel.isEmpty() && !seenRel.add(rel)) continue; // 转账两条只取一条
                    kind = "transfer"; acc = id(ba); to = id(sa); amt = bm;
                } else if (type == 8) {
                    kind = "adjust"; acc = id(sa); amt = sm;
                } else {
                    skipped++;
                    continue;
                }
                minT = Math.min(minT, t);
                maxT = Math.max(maxT, t);
                long ru = c.getLong(11);
                String merchant = ru != 0 ? entity.get(ru) : null;
                txns.put(new JSONArray().put(kind).put(t).put(amt).put(acc).put(to).put(cat).put(trim(c.getString(3)))
                        .put(merchant == null ? "" : merchant).put(nz(members.get(poid))).put(nz(projects.get(poid)))
                        .put(poid + "-" + Long.toString(created, 36)));
            }
        }
        return new JSONObject().put("ok", true).put("accounts", accounts).put("cats", cats).put("txns", txns)
                .put("skipped", skipped).put("from", minT == Long.MAX_VALUE ? 0 : minT).put("to", maxT);
    }

    private static String id(long v) {
        return v == 0 ? "" : String.valueOf(v);
    }

    private static long parseLong(String s) {
        try {
            return Long.parseLong(s);
        } catch (Exception e) {
            return 0;
        }
    }

    private static String trim(String s) {
        return s == null ? "" : s.trim();
    }

    private static String nz(String s) {
        return s == null ? "" : s;
    }
}
