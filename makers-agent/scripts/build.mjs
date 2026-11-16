import { mkdir, writeFile } from "node:fs/promises";
await mkdir("dist", { recursive: true });
await writeFile("dist/index.html", "<!doctype html><html lang=zh-CN><meta charset=utf-8><title>Umeet Agent</title><h1>Umeet 预测 Agent</h1><p>POST /forecast，需要服务端鉴权。</p></html>");
