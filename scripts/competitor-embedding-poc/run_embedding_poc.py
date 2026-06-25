#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Step 4 Embedding 离线 POC — recall@K 评测

对比：
  - S2 规则 internal_score Top-K
  - S2 LLM 对标池（规则 Top + 标签/赛道补充并集）
  - Embedding cosine Top-K（BGE-M3 或 bigram 基线）

用法:
  python run_embedding_poc.py
  python run_embedding_poc.py --input data/pool.json --top-k 20 --backend bge-m3
  python run_embedding_poc.py --backend bigram   # 无额外依赖，快速 smoke

输出:
  data/report.json
  data/report.md
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DEFAULT_INPUT = ROOT / "data" / "pool.json"
DEFAULT_REPORT_JSON = ROOT / "data" / "report.json"
DEFAULT_REPORT_MD = ROOT / "data" / "report.md"


def char_bigram_cosine(a: str, b: str) -> float:
    """与 S2 textOverlapScore 同族的字符 bigram 余弦（离线基线，非语义向量）。"""
    a, b = (a or "").lower().strip(), (b or "").lower().strip()
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0

    def grams(text: str) -> Counter:
        if len(text) < 2:
            return Counter({text: 1})
        return Counter(text[i : i + 2] for i in range(len(text) - 1))

    ga, gb = grams(a), grams(b)
    keys = set(ga) | set(gb)
    dot = sum(ga[k] * gb[k] for k in keys)
    na = math.sqrt(sum(v * v for v in ga.values()))
    nb = math.sqrt(sum(v * v for v in gb.values()))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def _load_bge_m3_via_fastembed():
    from fastembed import TextEmbedding

    model_name = "BAAI/bge-m3"
    print(f"加载 embedding 模型 (fastembed/ONNX): {model_name} …", file=sys.stderr)
    model = TextEmbedding(model_name=model_name)

    def score(query: str, docs: list[str]) -> list[float]:
        # fastembed query/passage 双塔；对检索用 default 即可
        qv = list(model.embed([query]))[0]
        doc_vecs = list(model.embed(docs))
        return [float(sum(a * b for a, b in zip(qv, dv))) for dv in doc_vecs]

    return "bge-m3-fastembed", score


def _load_bge_m3_via_transformers():
    import torch
    from transformers import AutoModel, AutoTokenizer

    model_name = "BAAI/bge-m3"
    print(f"加载 embedding 模型 (transformers): {model_name} …", file=sys.stderr)
    tokenizer = AutoTokenizer.from_pretrained(model_name, trust_remote_code=True)
    model = AutoModel.from_pretrained(model_name, trust_remote_code=True)
    model.eval()
    batch_size = 16

    def _pool(last_hidden, attention_mask):
        mask = attention_mask.unsqueeze(-1).expand(last_hidden.size()).float()
        summed = (last_hidden * mask).sum(dim=1)
        counts = mask.sum(dim=1).clamp(min=1e-9)
        return summed / counts

    def _encode(texts: list[str], is_query: bool) -> list[list[float]]:
        if is_query:
            texts = [f"Represent this sentence for searching relevant passages: {t}" for t in texts]
        out: list[list[float]] = []
        for i in range(0, len(texts), batch_size):
            chunk = texts[i : i + batch_size]
            with torch.no_grad():
                inputs = tokenizer(
                    chunk, padding=True, truncation=True, max_length=512, return_tensors="pt"
                )
                outputs = model(**inputs)
                pooled = _pool(outputs.last_hidden_state, inputs["attention_mask"])
                pooled = torch.nn.functional.normalize(pooled, p=2, dim=1)
                out.extend(pooled.cpu().tolist())
        return out

    def score(query: str, docs: list[str]) -> list[float]:
        qv = _encode([query], is_query=True)[0]
        doc_vecs = _encode(docs, is_query=False)
        return [sum(a * b for a, b in zip(qv, dv)) for dv in doc_vecs]

    return "bge-m3", score


def load_embedder(backend: str):
    backend = (backend or "auto").lower()
    if backend in ("auto", "bge-m3", "bge"):
        loaders = (_load_bge_m3_via_fastembed, _load_bge_m3_via_sentence_transformers, _load_bge_m3_via_transformers)
        last_err = None
        for loader in loaders:
            try:
                return loader()
            except Exception as exc:
                last_err = exc
                print(f"  跳过 {loader.__name__}: {exc}", file=sys.stderr)
        if backend in ("bge-m3", "bge"):
            raise SystemExit(f"BGE-M3 加载失败: {last_err}")
    if backend in ("auto", "bigram"):

        def score(query: str, docs: list[str]) -> list[float]:
            return [char_bigram_cosine(query, d) for d in docs]

        return "bigram", score
    raise ValueError(f"未知 backend: {backend}")


def _load_bge_m3_via_sentence_transformers():
    from sentence_transformers import SentenceTransformer

    model_name = "BAAI/bge-m3"
    print(f"加载 embedding 模型 (sentence-transformers): {model_name} …", file=sys.stderr)
    model = SentenceTransformer(model_name)

    def score(query: str, docs: list[str]) -> list[float]:
        texts = [query] + docs
        vecs = model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
        qv = vecs[0]
        return [float((qv * dv).sum()) for dv in vecs[1:]]

    return "bge-m3", score


def recall_at_k(ranked: list[dict], positive_keywords: list[str], k: int) -> dict:
    """positive_keywords: IM 标注关键词；ranked 按分数降序。"""
    hit_kw = set()
    missed = list(positive_keywords)
    top = ranked[:k]
    for c in top:
        name = c.get("display_name") or ""
        for kw in positive_keywords:
            if kw in name:
                hit_kw.add(kw)
    missed = [kw for kw in positive_keywords if kw not in hit_kw]
    total = len(positive_keywords)
    return {
        "k": k,
        "hit": len(hit_kw),
        "total": total,
        "rate": (len(hit_kw) / total) if total else None,
        "hit_keywords": sorted(hit_kw),
        "missed_keywords": missed,
    }


def rank_by_score(candidates: list[dict], score_key: str) -> list[dict]:
    return sorted(candidates, key=lambda c: c.get(score_key, 0), reverse=True)


def rank_by_embedding(query: str, candidates: list[dict], score_fn) -> list[dict]:
    docs = [c.get("document") or c.get("display_name") or "" for c in candidates]
    if not docs:
        return []
    scores = score_fn(query, docs)
    ranked = []
    for c, s in zip(candidates, scores):
        ranked.append({**c, "embed_score": float(s)})
    ranked.sort(key=lambda x: x["embed_score"], reverse=True)
    return ranked


def analyze_subject(subject: dict, top_k: int, score_fn, backend: str) -> dict:
    positives = subject.get("positive_keywords") or []
    candidates = subject.get("candidates") or []
    query = subject.get("target_document") or ""

    rule_ranked = rank_by_score(candidates, "internal_score")
    embed_ranked = rank_by_embedding(query, candidates, score_fn)

    llm_pool = [c for c in candidates if c.get("in_llm_pool")]
    llm_ranked = rank_by_score(llm_pool, "internal_score")

    rule_recall = recall_at_k(rule_ranked, positives, top_k)
    embed_recall = recall_at_k(embed_ranked, positives, top_k)
    llm_recall = recall_at_k(llm_ranked, positives, len(llm_ranked))  # 整池

    rescued = []
    for kw in embed_recall["hit_keywords"]:
        if kw in rule_recall["missed_keywords"]:
            for c in embed_ranked[:top_k]:
                if kw in (c.get("display_name") or ""):
                    rescued.append(
                        {
                            "keyword": kw,
                            "display_name": c.get("display_name"),
                            "embed_score": c.get("embed_score"),
                            "rank_rule": c.get("rank_rule"),
                            "internal_score": c.get("internal_score"),
                        }
                    )
                    break

    return {
        "sample_id": subject.get("sample_id"),
        "subject_id": subject.get("subject_id"),
        "subject_display_name": subject.get("subject_display_name"),
        "candidate_count": subject.get("candidate_count"),
        "llm_pool_size": subject.get("llm_pool_size"),
        "positive_count": len(positives),
        "backend": backend,
        "recall_rule_top_k": rule_recall,
        "recall_embed_top_k": embed_recall,
        "recall_llm_pool": llm_recall,
        "embedding_rescued": rescued,
        "delta_embed_vs_rule": (
            (embed_recall["hit"] - rule_recall["hit"]) if positives else 0
        ),
    }


def aggregate(results: list[dict]) -> dict:
    def sum_hits(key: str) -> tuple[int, int]:
        hit = sum(r[key]["hit"] for r in results if r[key]["total"])
        total = sum(r[key]["total"] for r in results if r[key]["total"])
        return hit, total

    rule_h, rule_t = sum_hits("recall_rule_top_k")
    emb_h, emb_t = sum_hits("recall_embed_top_k")
    llm_h, llm_t = sum_hits("recall_llm_pool")
    rescued = sum(len(r["embedding_rescued"]) for r in results)

    return {
        "subjects_with_labels": len([r for r in results if r["positive_count"] > 0]),
        "macro_rule_recall": f"{rule_h}/{rule_t}",
        "macro_embed_recall": f"{emb_h}/{emb_t}",
        "macro_llm_pool_recall": f"{llm_h}/{llm_t}",
        "macro_rule_rate": (rule_h / rule_t) if rule_t else None,
        "macro_embed_rate": (emb_h / emb_t) if emb_t else None,
        "macro_llm_pool_rate": (llm_h / llm_t) if emb_t else None,
        "total_embedding_rescued": rescued,
        "step4b_recommendation": _recommend(step4b_inputs=(emb_h, rule_h, rule_t, rescued)),
    }


def _recommend(step4b_inputs: tuple) -> str:
    emb_h, rule_h, rule_t, rescued = step4b_inputs
    if not rule_t:
        return "无正样本标签，无法评估"
    uplift = (emb_h - rule_h) / rule_t
    if uplift >= 0.15 or rescued >= 3:
        return "建议进入 Step 4b（Embedding 补充通道）：漏召改善 ≥15% 或 rescued≥3"
    if uplift > 0:
        return "有小幅改善，可观察扩样后再定 Step 4b"
    return "当前 POC 未显示明显 recall 提升；优先查 S1 池覆盖或继续 Prompt/规则优化"


def render_markdown(report: dict) -> str:
    agg = report["aggregate"]
    lines = [
        "# Embedding POC 报告",
        "",
        f"- 生成时间: {report['generated_at']}",
        f"- 输入: `{report['input']}`",
        f"- backend: **{report['backend']}**",
        f"- Top-K: {report['top_k']}",
        "",
        "## 宏平均 recall",
        "",
        "| 方法 | 命中 | 比率 |",
        "|------|------|------|",
        f"| S2 规则 Top-{report['top_k']} | {agg['macro_rule_recall']} | "
        f"{_pct(agg['macro_rule_rate'])} |",
        f"| Embedding Top-{report['top_k']} | {agg['macro_embed_recall']} | "
        f"{_pct(agg['macro_embed_rate'])} |",
        f"| LLM 对标池（当前并集） | {agg['macro_llm_pool_recall']} | "
        f"{_pct(agg['macro_llm_pool_rate'])} |",
        "",
        f"**Embedding 补救漏召**: {agg['total_embedding_rescued']} 项",
        "",
        f"**结论**: {agg['step4b_recommendation']}",
        "",
        "## 分主体",
        "",
    ]
    for r in report["subjects"]:
        lines.append(f"### {r['sample_id']} — {r['subject_display_name']}")
        lines.append("")
        lines.append(
            f"- 候选池 {r['candidate_count']} | LLM池 {r['llm_pool_size']} | "
            f"正样本 {r['positive_count']}"
        )
        rr = r["recall_rule_top_k"]
        er = r["recall_embed_top_k"]
        lr = r["recall_llm_pool"]
        lines.append(
            f"- 规则 Top-{rr['k']}: **{rr['hit']}/{rr['total']}** "
            f"（漏: {', '.join(rr['missed_keywords']) or '—'}）"
        )
        lines.append(
            f"- Embedding Top-{er['k']}: **{er['hit']}/{er['total']}** "
            f"（漏: {', '.join(er['missed_keywords']) or '—'}）"
        )
        lines.append(f"- LLM池: **{lr['hit']}/{lr['total']}**")
        if r["embedding_rescued"]:
            lines.append("- **Embedding 补救**:")
            for x in r["embedding_rescued"]:
                lines.append(
                    f"  - {x['keyword']} ← {x['display_name']} "
                    f"(embed={x['embed_score']:.3f}, 规则rank={x['rank_rule']})"
                )
        lines.append("")
    return "\n".join(lines)


def _pct(v) -> str:
    if v is None:
        return "—"
    return f"{v * 100:.1f}%"


def main():
    parser = argparse.ArgumentParser(description="竞品分析 Embedding POC")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--top-k", type=int, default=20)
    parser.add_argument("--backend", default="auto", help="auto | bge-m3 | bigram")
    parser.add_argument("--out-json", type=Path, default=DEFAULT_REPORT_JSON)
    parser.add_argument("--out-md", type=Path, default=DEFAULT_REPORT_MD)
    args = parser.parse_args()

    if args.backend in ("bge-m3", "bge", "auto") and args.out_json == DEFAULT_REPORT_JSON:
        args.out_json = ROOT / "data" / "report-bge-m3.json"
        args.out_md = ROOT / "data" / "report-bge-m3.md"

    if not args.input.exists():
        raise SystemExit(
            f"缺少 {args.input}\n"
            "请先在 news 目录运行: node server/scripts/runEmbeddingPoc.js export"
        )

    payload = json.loads(args.input.read_text(encoding="utf-8"))
    backend_name, score_fn = load_embedder(args.backend)

    results = []
    subjects = payload.get("subjects", [])
    for i, s in enumerate(subjects):
        print(
            f"分析 {i + 1}/{len(subjects)} {s.get('sample_id')} "
            f"({s.get('candidate_count')} 候选) …",
            file=sys.stderr,
        )
        results.append(analyze_subject(s, args.top_k, score_fn, backend_name))
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "input": str(args.input),
        "top_k": args.top_k,
        "backend": backend_name,
        "exported_at": payload.get("exported_at"),
        "subjects": results,
        "aggregate": aggregate(results),
    }

    args.out_json.parent.mkdir(parents=True, exist_ok=True)
    args.out_json.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    args.out_md.write_text(render_markdown(report), encoding="utf-8")

    agg = report["aggregate"]
    print(f"backend={backend_name} top_k={args.top_k}")
    print(f"规则 Top-{args.top_k}: {agg['macro_rule_recall']} ({_pct(agg['macro_rule_rate'])})")
    print(f"Embedding Top-{args.top_k}: {agg['macro_embed_recall']} ({_pct(agg['macro_embed_rate'])})")
    print(f"LLM池: {agg['macro_llm_pool_recall']} ({_pct(agg['macro_llm_pool_rate'])})")
    print(f"结论: {agg['step4b_recommendation']}")
    print(f"\n报告: {args.out_json}\n      {args.out_md}")


if __name__ == "__main__":
    main()
