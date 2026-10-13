# 洵记

离线记账 App（Android）。界面是 WebView 里的一个单页应用，数据用 AES-256-GCM 加密后只存在本机（或你指定的目录），不联网。
支持多账本、二级分类、子账户、预算、报表、自定义看板，能导入支付宝 / 微信账单、官方「随手记」备份（.kbf），OCR 版还能识别淘宝 / 京东 / 拼多多 / 抖音的订单截图。

怎么用：[使用说明](docs/使用说明.md)（App 里「我的 → 使用说明」是简版）。

## 两个版本

| | 包名 | 大小 | 说明 |
|---|---|---|---|
| 洵记（lite，正式版） | `com.xunji.app` | ~130 KB | 不带识别导入功能，界面上没有识别入口 |
| 洵记OCR版（ocr） | `com.xunji.app.ocr` | ~30 MB | 内置 PP-OCRv5 极速版模型在手机上离线识别，也可切到「电脑识别」用局域网 OCR 服务 |

两个版本包名不同，可以同时安装，数据互不相通。

## 目录结构

```
web/                 页面（打包时作为 APK 的 assets）
  index.html         按顺序加载下面的脚本
  style.css
  js/
    lib/bill_parser.js   订单截图 OCR 结果 → 订单（与 ocr/bill_parser.py 保持一致）
    lib/bill_file.js     支付宝 CSV / 微信 xlsx 账单文件解析
    util.js              工具：转义、金额 / 日期格式化、时间段
    defaults.js          默认分类、首页模块、时间看板、示例数据
    store.js             读库、数据迁移、紧凑格式编解码、按年份分片保存
    query.js             查询缓存、按时间二分、余额 / 分类 / 账户
    router.js            页面栈与渲染
    ui.js                toast、弹窗、日期选择、流水行、左滑 / 多选
    scrollbar.js         快速滚动条
    vlist.js             虚拟列表（按天分卡片）
    gesture.js           通用长按编辑 / 拖动排序
    pages/               各页面：home、board（自定义看板）、list、add（记一笔）、report、
                         me、tags、accounts、manage（预算 / 分类 / 账本）、help（使用说明，
                         改功能时和 docs/使用说明.md 一起改）
    merge.js             合并分类 / 账户 / 账本 / 标签，批量改所有相关流水和引用
    security.js          密码、启动锁、指纹、数据库位置
    io.js                备份恢复、导入导出
    import/              ocr（截图识别）、bill（支付宝 / 微信账单）、kbf（随手记备份）
    stress.js            压力测试
    main.js              启动
android/
  app/src/main/      公共原生层：MainActivity（WebView + JS 桥）、SecureStore（加密数据库）、KbfReader（随手记备份）
  app/src/lite/      正式版的空 LocalOcr
  app/src/ocr/       OCR 版：LocalOcr、OcrEngine（ONNX Runtime 实现的 PP-OCR 检测 + 识别）、assets/models
  build_apk.bat/.ps1     打包两个版本，复制到 dist/
  build_apk_emu.bat      打包带 x86_64 库的 OCR 版，给 MuMu 等模拟器用
  phone_test.bat/.ps1    连真机：读机型、装最新 OCR 包、推测试截图、打开 App
  phone_log.bat/.ps1     抓 App 的 WebView 控制台日志到 phone_log.txt
  ocrtest/           OCR 模型的测速、量化、对比测试（见下文）
ocr/                 电脑端局域网 OCR 服务（RapidOCR + OpenVINO）
  server.py          FastAPI 服务：POST /ocr、GET /health、GET / 测试页
  bill_parser.py     订单解析规则
  ocr_config.ini     端口、口令、是否保存上传图片等（首次运行自动生成）
  start.bat          用 .venv-rapid 启动服务
  samples/           4 张测试截图（淘宝 / 京东 / 拼多多 / 抖音）
  tools/             check_samples.py、post_test.py、reparse.py
  packaging/         打包成 洵记OCR.exe（PyInstaller）
docs/使用说明.md     给用户看的使用说明
dist/                打好的 APK（不进仓库）
```

## 打包 APK

需要 JDK 17、Gradle 8.7、Android SDK（路径写在 `android/build_apk.ps1` 和 `android/local.properties` 里，默认 `D:\dev\...`）。

```bash
android\build_apk.bat
```

**签名**：release 包用 `android/keystore.properties` 指向的密钥签名（格式如下，文件和密钥都不进仓库）；没有这个文件时自动改用 debug 签名，可以直接编译，但装不上覆盖正式发布的版本。

```properties
storeFile=xunji-release.jks
storePassword=...
keyAlias=xunji
keyPassword=...
```

会同时打正式版和 OCR 版，按 `洵记_<版本>.apk`、`洵记OCR版_<版本>-ocr.apk` 复制到 `dist/`，正式版另存一份 `洵记_latest.apk`。版本号是打包时间（`yyyyMMdd.HHmm`）。日志写在 `android/build_apk.log`。

页面代码直接取自 `web/`（`build.gradle` 里 `assets.srcDirs = ['../../web']`），改完 `web/` 重新打包即可。

`web/js/` 下都是普通脚本（不是 ES 模块），共享全局作用域、按 `index.html` 里的顺序加载，页面里的 `onclick="..."` 直接调用全局函数，所以不需要打包工具。新增文件时记得加到 `index.html`；只在调用时才用到的函数可以放在任何文件里，但**脚本加载时就要执行的代码**（顶层语句）只能用到排在它前面的文件里定义的东西。
调试页面也可以直接在电脑浏览器里打开 `web/index.html`：这时数据存在 localStorage、**不加密**，指纹、加密备份、本机识别等原生功能不可用。

## 电脑 OCR 服务

给 OCR 版的「电脑识别」模式用（手机和电脑连同一个 WiFi）：

```bash
ocr\start.bat
```

窗口里会打印局域网地址（如 `http://192.168.1.10:8866`），填到 App「识别账单导入 → 电脑识别」里。配置见 `ocr/ocr_config.ini`：
`token` 设了之后请求要带 `X-Token` 头；`save_uploads = 1` 会把收到的截图和识别结果存到 `ocr/uploads/`（最多 30 组），方便排查识别问题。

不想装 Python 的电脑可以用打包好的 exe：运行 `ocr\packaging\build_exe.bat`（首次会在 `packaging/.venv` 建打包环境），输出到 `dist/洵记OCR/洵记OCR.exe`。

Python 环境：`ocr/.venv-rapid`（Python 3.10，依赖见 `ocr/requirements.txt`）。重建：

```bash
python -m venv ocr\.venv-rapid
```

```bash
ocr\.venv-rapid\Scripts\python -m pip install -r ocr\requirements.txt
```

## 测试

| 测试 | 命令 / 方法 | 看什么 |
|---|---|---|
| 识别准确率 | `ocr\.venv-rapid\Scripts\python ocr\tools\check_samples.py` | 4 张样例截图的平台和金额全部 ✓ |
| 服务接口 | 先 `ocr\start.bat`，再 `ocr\.venv-rapid\Scripts\python ocr\tools\post_test.py` | 每张图的识别结果和往返耗时 |
| JS / Python 解析一致 | `android\ocrtest` 下运行 `..\..\ocr\.venv-rapid\Scripts\python parser_cases.py` 生成用例，在仓库根目录起 http 服务（如 `python -m http.server`）后打开 `/android/ocrtest/parser_test.html` | 显示「N/N 一致」 |
| 本机识别测速（电脑上） | `android\ocrtest\run_ocr_bench.bat` / `bench.ps1`（Java + `lib/onnxruntime-1.20.0.jar`） | 每张图检测 / 识别耗时 |
| 本机识别测速（手机上） | `adb shell am start -n com.xunji.app.ocr/com.xunji.app.MainActivity --es ocrbench v5f` | 结果在手机 `Android/data/com.xunji.app.ocr/files/ocrbench.txt` |
| 模型量化 | `run_quant.bat`、`run_quant_fold.bat`、`ocrtest/q_fold/*.py`、`ocrtest/paddle/` | 量化脚本和历次结果记录（`*_result.txt`） |
| 大数据量 | OCR 版或电脑浏览器里「我的 → 压力测试」（正式版不显示） | 追加 1~20 万条随机流水，显示各页渲染耗时 |
| 示例数据 | OCR 版或电脑浏览器里「我的 → 重新生成示例数据」（正式版不显示；首次打开都是空账本） | 生成 150 天的演示流水和带余额的账户 |
| 真机 | `android\phone_test.bat`、`android\phone_log.bat` | 设备信息、安装结果 / WebView 报错日志 |

电脑上测速要用的 `android/ocrtest/lib/onnxruntime-1.20.0.jar`（89 MB）不在仓库里，从 Maven Central 下载 `com.microsoft.onnxruntime:onnxruntime:1.20.0` 的 jar 放到这个位置即可。

`parser_cases.py` 优先用 `ocr/uploads/` 里保存的真实识别结果做用例；没有时直接识别 `ocr/samples/`。

## OCR 模型

APK 只用 `android/app/src/ocr/assets/models/` 里的 `v5_det.onnx` + `v5f_rec.onnx` + `v5f_keys.txt`（约 11 MB），仓库里也只有这三个。其余对比测试用的模型（v5 / v5q / v6）不进仓库，需要时 v5 / v6 用 `android/ocrtest/prepare_models.py` 从 RapidOCR 复制，v5q 用 `quant_static.py` 量化生成，放在同一目录也不会被打进 APK（`build.gradle` 的 `ignoreAssetsPattern`）。
`v5f` 是 PP-OCRv5 识别模型的加速版：常数乘加并入卷积、只量化卷积的 INT8、裁成常用 7111 字、直接输出字号（生成脚本在 `ocrtest/q_fold/`）。手机端参数固定为 2 线程、检测短边 640、识别最小宽 160。
首次加载后，ONNX Runtime 优化过的模型缓存在 App 私有目录 `files/ortopt/`，之后启动更快；换 App 版本会自动重建。

## 数据与安全

- 数据库文件 `xunji.db`：默认在 App 私有目录，可在「我的 → 数据库位置」改放到任意目录（如网盘同步目录）。
- 加密方式：随机 256 位数据密钥做 AES-256-GCM。这把密钥由 Android Keystore 保护后存在本机（所以本机打开不用输密码），设了密码后还会用 PBKDF2-HMAC-SHA256（12 万次）派生的密钥再加密一份写进文件，换机 / 重装时凭密码解开。**密码无法找回。**
- 自动备份：App 内 `files/backups/`，保留最近 5 份，卸载会一起删除。手动导出的加密备份和 CSV 在 `Download/XunJi/`。
- 存储格式：流水按年份切片、按列存，字符串走字典（20 万条约 13 MB）；只重写有变化的年份，由原生层后台线程加密写盘。

## 许可证

[GPL-3.0](LICENSE)。可以自由使用、修改和再发布，但基于本项目修改后发布的版本也必须以 GPL-3.0 开源。
