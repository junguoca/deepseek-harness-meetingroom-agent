# DSH Remote（Android 一键直连 Windows 端 Harness）

一个极简 Android App：**打开即连** Windows 端 DeepSeek Harness（通过 cpolar 公网隧道），
连不上就显示「连接失败」。

## 工作原理

```
App 启动
  → 读已保存的公网 URL（首次弹输入框粘贴）
  → 健康检查 GET /（4 秒超时）
       ├─ 2xx → WebView 全屏加载（DSH 界面，实时同步）
       ├─ 502/503 → 「Windows 端未开启」
       └─ 超时/拒连/无网 → 「无法连接 Windows 端」
  → WebView 加载失败 → 兜底显示失败页
```

## 前置条件（Windows 端）

1. `dsh web` 运行中（dsh-pocket 插件会自动起 3081 代理）
2. cpolar 隧道指向 **3081**（不是 3080），公网 URL 形如 `https://xxxx.r24.cpolar.top`

Windows 端一键启动脚本见上一级目录的 `dsh-remote-start.ps1` / `dsh-remote-start.bat`。

## 构建打包

用 **Android Studio** 打开本目录（`dsh-android-app`）：

1. 等待 Gradle sync 完成（首次会自动下载依赖）
2. 菜单 **Build → Build Bundle(s) / APK(s) → Build APK(s)**
3. 产物在 `app/build/outputs/apk/debug/app-debug.apk`，传到手机安装

> 首次运行手机需允许「安装未知来源应用」。

### 命令行打包（可选，需已装 Android SDK）

```bash
cd dsh-android-app
./gradlew assembleDebug
```

## 项目结构

```
dsh-android-app/
├── settings.gradle.kts          # 项目名 + 模块声明
├── build.gradle.kts             # 根构建（AGP 8.5.2 / Kotlin 1.9.24）
├── gradle.properties
├── gradle/wrapper/gradle-wrapper.properties   # Gradle 8.7
└── app/
    ├── build.gradle.kts         # 模块构建（minSdk 24 / target 34）
    ├── proguard-rules.pro
    └── src/main/
        ├── AndroidManifest.xml  # INTERNET 权限 + cleartext 允许
        ├── java/com/dsh/remote/MainActivity.kt   # 核心：健康检查 + WebView + 失败页
        └── res/
            ├── layout/activity_main.xml          # WebView + 覆盖层布局
            ├── values/{strings,colors,themes}.xml
            └── drawable/ic_launcher.xml          # 矢量图标
```

## 关键配置说明

| 配置 | 值 | 为什么 |
|---|---|---|
| `javaScriptEnabled` | true | DSH 是 SPA |
| `domStorageEnabled` | true | localStorage/sessionStorage |
| WebSocket | 默认支持 | DSH 实时同步走 WS，WebView 原生支持 wss:// |
| `usesCleartextTraffic` | true | 兼容以后连局域网 http://IP:3081 |
| `mixedContentMode` | ALWAYS_ALLOW | 兼容 http 页面里的资源 |

## 免费版 cpolar 注意事项

- 免费版公网 URL **每次重启 cpolar 会变**，需在 App 里点「修改地址」重新粘贴一次
- 升级付费版固定域名后，URL 填一次永久有效，无需再改
