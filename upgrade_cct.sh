#!/usr/bin/env bash
#
# upgrade_cct.sh — 更新本机 cct（codex-claude-transfer）到 GitHub 最新 prebuilt release。
#
# 原理：
#   1. 用 GitHub API 查询最新 release tag（如 v2.3.0）
#   2. 与本地 cct 版本比较，没有更新则直接退出
#   3. 下载对应平台的 .tar.gz 资产 + SHA256SUMS.txt，校验 sha256
#   4. 备份旧二进制，替换 ~/.local/bin/cct
#   5. 运行 `cct version` 验证
#
# 用法：
#   ./upgrade_cct.sh            # 正常更新
#   ./upgrade_cct.sh --dry-run  # 只报告最新版本与本地版本，不下载不安装
#   ./upgrade_cct.sh --force    # 即使版本相同也重新下载安装

set -euo pipefail

# ---------- 配置 ----------
REPO="ahmojo/codex-claude-transfer"
# 目标平台（可选：linux_amd64 / linux_arm64 / darwin_amd64 / darwin_arm64 / windows_amd64）
PLATFORM="darwin_arm64"
BIN_DIR="$HOME/.local/bin"
INSTALL_PATH="$BIN_DIR/cct"
# 下载临时目录
TMP_DIR="$(mktemp -d /tmp/cct-update.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

DRY_RUN=0
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --force)   FORCE=1 ;;
    *) echo "未知参数: $arg（支持: --dry-run, --force）" >&2; exit 2 ;;
  esac
done

# ---------- 工具函数 ----------
# 把 "v2.0.0" 归一化成可比较的四段版本号 "020000"，剥离非数字部分
ver_sort_key() {
  printf '%s' "$1" | sed -E 's/^v//' | awk -F. '{ printf "%03d%03d%03d%03d\n", $1, $2, $3, $4 }'
}

echo "==> 检查 $REPO 的最新版本…"

# ---------- 1. 查询最新版本 ----------
LATEST_TAG="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
if [[ -z "$LATEST_TAG" ]]; then
  echo "!! 无法从 GitHub API 获取最新版本（网络或限流问题）。" >&2
  exit 1
fi
LATEST_VERSION="${LATEST_TAG#v}"   # 去掉前导 v，如 "2.0.0"

# ---------- 2. 本地版本 ----------
LOCAL_VERSION=""
if [[ -x "$INSTALL_PATH" ]]; then
  LOCAL_VERSION="$("$INSTALL_PATH" version 2>/dev/null | sed -E 's/.*v([0-9]+\.[0-9]+\.[0-9]+).*/\1/')" || true
fi

echo "    最新版本 : $LATEST_TAG"
echo "    本地版本 : ${LOCAL_VERSION:-（未安装）}"

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "--dry-run: 已是最新或仅预览，不执行下载/安装。"
  if [[ "$LOCAL_VERSION" == "$LATEST_VERSION" ]]; then
    echo "    结论: 本地已是最新 ($LATEST_VERSION)。"
  else
    echo "    结论: 需要更新 → $LATEST_TAG"
  fi
  exit 0
fi

if [[ "$FORCE" -ne 1 && "$LOCAL_VERSION" == "$LATEST_VERSION" ]]; then
  echo "已是最新版本 ($LATEST_VERSION)，无需更新。（用 --force 可强制重装）"
  exit 0
fi

# ---------- 3. 下载并校验 ----------
ASSET="cct_${LATEST_VERSION}_${PLATFORM}.tar.gz"
URL="https://github.com/$REPO/releases/download/$LATEST_TAG/$ASSET"
SHA_URL="https://github.com/$REPO/releases/download/$LATEST_TAG/SHA256SUMS.txt"

echo "==> 下载 $ASSET …"
curl -fsSL -o "$TMP_DIR/$ASSET" "$URL"
echo "==> 下载 SHA256SUMS.txt …"
curl -fsSL -o "$TMP_DIR/SHA256SUMS.txt" "$SHA_URL"

EXPECTED="$(awk -v a="$ASSET" '$2 == a {print $1}' "$TMP_DIR/SHA256SUMS.txt")"
if [[ -z "$EXPECTED" ]]; then
  echo "!! SHA256SUMS.txt 中找不到 $ASSET 的校验和。" >&2
  exit 1
fi
ACTUAL="$(shasum -a 256 "$TMP_DIR/$ASSET" | awk '{print $1}')"
if [[ "$ACTUAL" != "$EXPECTED" ]]; then
  echo "!! sha256 校验失败：期望 $EXPECTED，实际 $ACTUAL" >&2
  echo "    已中止，未做任何修改。" >&2
  exit 1
fi
echo "    sha256 校验通过 ✓"

# ---------- 4. 解压并替换 ----------
echo "==> 解压并安装到 $INSTALL_PATH …"
tar -xzf "$TMP_DIR/$ASSET" -C "$TMP_DIR"

NEW_BIN="$TMP_DIR/${PLATFORM}/cct"
if [[ ! -x "$NEW_BIN" ]]; then
  # 兼容不同目录结构：直接在解压根下找 cct
  NEW_BIN="$(find "$TMP_DIR" -type f -name cct -perm -u+x | head -1)"
fi
if [[ -z "$NEW_BIN" || ! -x "$NEW_BIN" ]]; then
  echo "!! 解压后未找到可执行的 cct。" >&2
  exit 1
fi

# 备份旧版本
if [[ -f "$INSTALL_PATH" ]]; then
  cp "$INSTALL_PATH" "$INSTALL_PATH.bak"
  echo "    旧版本已备份到 $INSTALL_PATH.bak"
fi

# 原子替换
cp "$NEW_BIN" "$INSTALL_PATH"
chmod +x "$INSTALL_PATH"
echo "    已安装: $INSTALL_PATH"

# ---------- 5. 验证 ----------
echo "==> 验证新版本…"
"$INSTALL_PATH" version

# 清理旧备份（保留最新一份）
if [[ -f "$INSTALL_PATH.bak" ]]; then
  rm -f "$INSTALL_PATH.bak"
  echo "    已清理旧备份 $INSTALL_PATH.bak"
fi

echo "==> 完成。cct 已更新到 $LATEST_TAG"
