#!/bin/bash
cd "$(dirname "$0")"
echo "== 海拓 1.2.6 macOS 构建 =="
echo "需要: Python3 与 Node.js(已装 Homebrew 的话: brew install python node)"
if ! command -v python3 >/dev/null; then echo "未找到 python3,请先安装"; read -n 1 -s -r -p "按任意键退出"; exit 1; fi
if ! command -v npm >/dev/null; then echo "未找到 npm(Node.js),请先安装"; read -n 1 -s -r -p "按任意键退出"; exit 1; fi
python3 scripts/build.py --target macos
if [ $? -ne 0 ]; then echo "构建失败,把上面的报错发给我"; read -n 1 -s -r -p "按任意键退出"; exit 1; fi
echo "完成: macos/out/海拓-1.2.6-arm64.dmg"
open macos/out
