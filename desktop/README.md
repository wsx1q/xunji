# 洵记 Windows 桌面版 · 使用与构建

功能演示和下载入口见[项目首页](../README.md)。此分支包含桌面版所需源码，不依赖 Android 工程。

## 使用

下载 `xunji-desktop-*.exe` 直接运行。支持 Windows 10 / 11 x64，需要 Microsoft Edge WebView2 Runtime。单文件首次启动会解包，可能需要几秒。

默认账本目录：`%LOCALAPPDATA%\XunJiDesktop`，数据库为 `xunji.db`。数据加密保存在本机，主密钥由 Windows DPAPI 保护。自动备份保留最近 5 份。设置中可更改数据位置、配置密码和 Windows Hello、导出或恢复备份。关闭窗口会等待保存，替换 EXE 不会清除账本。

与手机版交换带密码的加密备份即可迁移数据，两端不会自动同步。恢复会覆盖目标账本，操作前请核对。

报表支持月报、年报和全部时间；全部时间的趋势按年份汇总。分类多选用橙色边框、底色和 ✓ 标记整类选中，用虚线边框与 − 标记部分二级分类选中。

首页收支、日期与自定义看板、预算、分类排行、趋势和资产均可进入对应流水，保留该项的时间与筛选范围。分类管理支持多选，选好后统一查看所选流水；一级分类包含二级分类。首页快捷入口可添加商家与项目；成员、商家、项目列表点击看流水，长按或右键编辑。流水明确显示默认成员“本人”。分类数量和明细按全部账本统计，资产明细也覆盖全部账本，并提示初始余额与流水合计的区别。

搜索历史、记账页和分类选择面板的“最近使用”统一采用历史标签样式，支持“清除”全部及小 × 单独移除。最近分类按收支类型分别管理，保留草稿和账目；列表限定高度，多余分类可滑动查看。

## 截图识别

将截图拖入“识别与导入”，可批量处理长图。支持淘宝、京东、拼多多、抖音和超盒算订单列表。

订单按实际支付总额记一笔，商品名称、规格、数量和标价放入备注，支持 4000 字符。超盒算仅显示图片时记录总件数，不推测名称。不完整订单提示补图。

退款、退款中和关闭订单默认不导入，可批量忽略。每条记录可编辑，误判退款需明确改成正常支出，才能作为支出导入。“可能已记过”可与已有账目并排对比。

本机采用 PP-OCRv6 均衡模型，保留完整字表，按需加载，闲置 3 分钟后释放。进度显示真实加载与分段识别阶段。切换页面后继续处理，右下角任务和左侧入口可以返回结果。未导入的预览只在本次运行中保留，退出前请确认。

分类推荐只使用本机已有分类、商品关键词与确认过的历史，不创建分类或拆分金额。预览中可修改，确认导入后才记住手动选择。

## 源码结构

| 路径 | 内容 |
|---|---|
| `desktop/app.py` | Windows WebView2 宿主、本机 HTTP 桥接 |
| `desktop/native.py` / `storage.py` | 原生操作、加密、保存与备份 |
| `desktop/ui.js` / `style.css` | 桌面布局、拖入和快捷键 |
| `desktop/local_ocr.py` / `fast_rec.py` | 离线识别、长图分段和模型释放 |
| `desktop/prepare_models.py` / `model_proto.py` | 构建模型准备与校验 |
| `web/` | 桌面使用的账务、页面、解析和分类推荐 |
| `tests/` / `desktop/tests/` | 回归测试和公开测试样例 |

宿主仅监听 `127.0.0.1`，请求需通过本次启动令牌与同源校验。

## 运行与构建

需要 Windows x64、Python 3.10 和 PowerShell，在仓库根目录运行：

```powershell
py -3.10 -m venv desktop/.venv
desktop/.venv/Scripts/python.exe -m pip install -r desktop/requirements.txt
desktop/.venv/Scripts/python.exe desktop/prepare_models.py
desktop/.venv/Scripts/python.exe desktop/app.py
```

首次准备模型需要联网，检测模型校验固定 SHA-256，识别模型来自固定版本 RapidOCR。成品离线运行，不需要下载模型。

仅在桌面运行代码、页面、模型、资源或依赖变化且需要交付时构建：

```powershell
desktop/.venv/Scripts/python.exe desktop/build.py
```

默认输出 `dist/xunji-desktop-版本.exe`，不生成固定名称副本。明确需要副本时使用 `--alias`（PowerShell 包装脚本使用 `-Alias`）。每次成功构建只保留最新和前一个桌面版本。仅修改文档、GIF 或发布信息时复用已验证 EXE。

## 验证

```powershell
desktop/.venv/Scripts/python.exe -m unittest discover -s desktop/tests -v
node --test tests/*.test.cjs
desktop/.venv/Scripts/python.exe desktop/tests/check_ocr.py
```

浏览器端到端验证使用 Playwright 与 Edge，可先 `npm install --no-save playwright`。启动隔离测试宿主后执行测试：

```powershell
desktop/.venv/Scripts/python.exe desktop/app.py --headless --data-dir desktop/build/ui-test --port 11649
$env:XUNJI_TEST_URL='http://127.0.0.1:11649/'
node desktop/tests/ocr_compare.cjs
node desktop/tests/refunds.cjs
node tests/home_ledger.cjs
node tests/recent_categories.cjs
```

## 重新录制 GIF

在上述隔离宿主上运行 `node tools/record_demos.cjs`，再运行 `desktop/.venv/Scripts/python.exe tools/render_demos.py`。脚本用虚构订单录制真实拖入、识别、后台进度与重复对比，不使用个人截图或正式账本。输出在 `docs/demos/`。
