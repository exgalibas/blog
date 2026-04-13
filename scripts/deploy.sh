#!/bin/bash
set -e

NODE="/Users/joker/Library/Application Support/autoclaw/embedded-gateway-runtime/d99b3723943b3d5f/node/node"
NPM="/tmp/node-v22.15.0-darwin-arm64/lib/node_modules/npm/bin/npm-cli.js"
cd "$(dirname "$0")/.."

echo "🔨 Building..."
PATH="/tmp/bin:$PATH" "$NPM" run build

echo ""
echo "📦 Static files ready in out/"
echo ""
echo "部署选项："
echo "  1. Vercel: 打开 https://vercel.com/new 导入 GitHub 仓库"
echo "  2. Netlify: 打开 https://app.netlify.com/drop 拖入 out/ 文件夹"  
echo "  3. Surge:  运行 $NODE node_modules/.bin/surge out"
echo "  4. GitHub Pages: 推送到 GitHub，开启 Pages"
echo ""
