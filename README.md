# Frost — 指尖冰雪粒子

一个用 Vite + 原生 JavaScript 搭的网页互动原型。当前版本用鼠标/触屏模拟指尖：移动留下冰蓝粒子光迹，点击画面或按钮触发星尘绽放。

## 在 VS Code 里运行

需要 Node.js（建议 20.19+ 或 22.12+）。在 VS Code 终端进入这个文件夹，然后运行：

```bash
npm install
npm run dev
```

打开终端显示的本地网址，通常是 `http://localhost:5173`。摄像头功能之后接入时，浏览器需要在本地网页上获得摄像头权限。

## 文件结构

- `index.html`：网页结构
- `src/style.css`：视觉样式
- `src/main.js`：粒子动画和鼠标/触屏交互
- `package.json`：项目脚本与依赖

## 下一步

接入 MediaPipe `@mediapipe/tasks-vision` 的 Hand Landmarker，让摄像头识别到的食指坐标替代鼠标坐标；再用手势开合控制粒子聚拢或绽放。当前原型不上传摄像头画面。
