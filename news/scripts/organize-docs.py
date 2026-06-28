#!/usr/bin/env python3
"""将 news/ 下散落的 .md 归档到 news/文档/ 对应子目录。"""
from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
import sys

NEWS_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS_ROOT = os.path.join(NEWS_ROOT, "文档")
SKIP_PARTS = {"node_modules", ".venv", "文档", "__pycache__", "uploads"}

# 保留在原位（项目说明）
KEEP_REL = {
    "README.md",
}


def file_hash(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def classify(rel: str) -> str | None:
    """返回相对 news/文档/ 的目标路径；None 表示保留不动。"""
    rel = rel.replace("\\", "/")
    name = os.path.basename(rel)

    if rel in KEEP_REL:
        return None

    if rel.startswith("deploy/"):
        return os.path.join("部署相关", name).replace("\\", "/")

    if rel.startswith("国际集团接口/"):
        return os.path.join("接口相关", "国际集团接口", name).replace("\\", "/")

    if rel == "client/PREVIEW_GUIDE.md":
        return "开发指南/前端预览指南.md"

    if rel.startswith("server/"):
        if name.startswith("README_"):
            return os.path.join("需求说明", name.replace("README_", "", 1)).replace("\\", "/")
        return os.path.join("需求说明", name).replace("\\", "/")

    # --- 文档根目录（部署总览）---
    root_docs = {
        "正常更新部署流程.md",
        "生产环境更新指南.md",
        "运行指南.md",
        "安装指南.md",
        "代码更新部署指南.md",
        "国方生产环境部署说明.md",
        "重试功能部署说明.md",
        "Ubuntu部署指南.md",
    }
    if name in root_docs:
        return name

    # --- AI 模型 ---
    ai_prefixes = ("AI", "API网关")
    if name.startswith(ai_prefixes):
        return os.path.join("AI模型相关", name).replace("\\", "/")

    # --- Docker ---
    docker_keys = (
        "Docker",
        "DOCKER_",
        "Alpine-Linux-Playwright",
        "配置Docker镜像加速器",
        "切换到Debian镜像指南",
    )
    if any(k in name for k in docker_keys):
        return os.path.join("docker部署相关", name).replace("\\", "/")

    # --- 接口 / 企查查 ---
    if name.startswith("企查查"):
        return os.path.join("接口相关", "企查查", name).replace("\\", "/")

    if name in ("大模型新闻分析功能说明.md", "API请求503错误排查.md"):
        return os.path.join("接口相关", name).replace("\\", "/")

    if name == "上海国际集团新闻接口逻辑说明.md":
        return os.path.join("接口相关", "上海国际", name).replace("\\", "/")

    # --- 错误 / 排查 ---
    error_keys = (
        "503",
        "修复",
        "排查",
        "紧急",
        "解决",
        "诊断",
        "错误",
        "问题分析",
        "usage_type",
        "entity_type",
        "HTTP521",
        "Nginx",
        "浏览器",
        "域名访问",
        "登录503",
        "前端页面503",
        "正文提取",
        "未修复",
        "多模块",
        "newsAnalysis",
        "时区问题",
        "空白页面",
        "pip",
        "npm",
        "initPrompts",
        "MySQL",
        "服务器启动",
        "接口使用量",
    )
    if any(k in name for k in error_keys):
        return os.path.join("错误问题", name).replace("\\", "/")

    # --- 集成功能（Playwright / 验证 / 构建）---
    integration_keys = (
        "Playwright",
        "验证",
        "检查构建",
        "检查Pillow",
        "强制更新initPrompts",
        "手动安装Playwright",
        "安装Playwright",
        "测试Playwright",
    )
    if any(k in name for k in integration_keys):
        return os.path.join("集成功能", name).replace("\\", "/")

    # --- 默认：需求 / 功能说明 ---
    return os.path.join("需求说明", name).replace("\\", "/")


def iter_source_mds():
    for dirpath, dirnames, filenames in os.walk(NEWS_ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_PARTS]
        rel_dir = os.path.relpath(dirpath, NEWS_ROOT).replace("\\", "/")
        if rel_dir == "文档" or rel_dir.startswith("文档/"):
            continue
        for fn in filenames:
            if not fn.lower().endswith(".md"):
                continue
            rel = fn if rel_dir == "." else f"{rel_dir}/{fn}"
            rel = rel.replace("\\", "/")
            yield rel


def git_mv(src_abs: str, dst_abs: str):
    os.makedirs(os.path.dirname(dst_abs), exist_ok=True)
    subprocess.run(["git", "mv", src_abs, dst_abs], cwd=os.path.dirname(NEWS_ROOT), check=True)


def git_rm(path_abs: str):
    subprocess.run(["git", "rm", "-f", path_abs], cwd=os.path.dirname(NEWS_ROOT), check=True)


def main():
    repo_root = os.path.dirname(NEWS_ROOT)
    moved = 0
    deduped = 0
    skipped = 0
    actions: list[str] = []

    for rel in sorted(iter_source_mds()):
        name = os.path.basename(rel)
        target_rel = classify(rel)
        if target_rel is None:
            skipped += 1
            continue

        src = os.path.join(NEWS_ROOT, rel.replace("/", os.sep))
        dst = os.path.join(DOCS_ROOT, target_rel.replace("/", os.sep))

        if not os.path.isfile(src):
            continue

        if os.path.isfile(dst):
            try:
                same = file_hash(src) == file_hash(dst)
            except OSError:
                same = False
            if same:
                git_rm(src)
                deduped += 1
                actions.append(f"DEDUP  {rel}  (同内容已存在于 文档/{target_rel})")
            else:
                parent = os.path.dirname(target_rel).replace("\\", "/")
                stem = os.path.splitext(name)[0]
                src_tag = rel.replace("/", "_").removesuffix(".md").removesuffix(".MD")
                alt_name = f"{stem}_from_{src_tag}.md"
                alt_rel = f"{parent}/{alt_name}" if parent else alt_name
                alt_abs = os.path.join(DOCS_ROOT, alt_rel.replace("/", os.sep))
                git_mv(src, alt_abs)
                moved += 1
                actions.append(f"MOVE* {rel} -> 文档/{alt_rel}")
            continue

        git_mv(src, dst)
        moved += 1
        actions.append(f"MOVE  {rel} -> 文档/{target_rel}")

    print(f"完成: 移动 {moved}，去重删除 {deduped}，保留 {skipped}")
    for line in actions:
        print(line)


if __name__ == "__main__":
    main()
