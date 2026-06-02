#!/usr/bin/env python3
"""Fetch RSS/Atom feeds and emit a weighted markdown digest for daily-brief.

No push/notification behavior by design. This script is a source-discovery and
ranking step; the daily-brief agent still decides what earns a place in the
final brief.
"""
from __future__ import annotations

import argparse
import email.utils
import hashlib
import html
import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass, asdict
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = ROOT / "assets" / "rss-feeds.json"
DEFAULT_USER_CONFIG = Path(".daily-brief") / "config" / "rss-feeds.json"
USER_AGENT = "daily-brief-rss/1.0 (+local topic brief)"

TAG_RE = re.compile(r"<[^>]+>")
WS_RE = re.compile(r"\s+")


@dataclass
class Article:
    title: str
    url: str
    summary: str
    published: str | None
    published_ts: float | None
    feed_name: str
    category: str
    base_weight: float
    score: float
    score_reasons: list[str]


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def merge_configs(base: dict[str, Any], override: dict[str, Any] | None) -> dict[str, Any]:
    if not override:
        return base
    merged = dict(base)
    for key in ("priority_keywords", "downrank_keywords"):
        merged[key] = {**base.get(key, {}), **override.get(key, {})}
    merged["feeds"] = [*base.get("feeds", []), *override.get("feeds", [])]
    return merged


def strip_ns(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower()


def child_text(node: ET.Element, names: tuple[str, ...]) -> str:
    for child in list(node):
        if strip_ns(child.tag) in names:
            text = "".join(child.itertext()).strip()
            if text:
                return clean_text(text)
    return ""


def clean_text(value: str) -> str:
    value = TAG_RE.sub(" ", value)
    value = html.unescape(value)
    return WS_RE.sub(" ", value).strip()


def normalize_url(url: str) -> str:
    url = html.unescape(url or "").strip()
    if not url:
        return ""
    parsed = urllib.parse.urlsplit(url)
    query = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
    query = [(k, v) for k, v in query if not k.lower().startswith("utm_") and k.lower() not in {"ref", "source"}]
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc.lower(), parsed.path.rstrip("/"), urllib.parse.urlencode(query), ""))


def parse_date(value: str | None) -> tuple[str | None, float | None]:
    if not value:
        return None, None
    value = clean_text(value)
    candidates = [value]
    if value.endswith("Z"):
        candidates.append(value[:-1] + "+00:00")
    for candidate in candidates:
        try:
            dt = datetime.fromisoformat(candidate)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            dt = dt.astimezone(timezone.utc)
            return dt.date().isoformat(), dt.timestamp()
        except ValueError:
            pass
    try:
        dt = email.utils.parsedate_to_datetime(value)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        dt = dt.astimezone(timezone.utc)
        return dt.date().isoformat(), dt.timestamp()
    except (TypeError, ValueError):
        return value[:10] if value else None, None


def fetch_url(url: str, timeout: int, retries: int, max_bytes: int = 2_000_000) -> bytes:
    last_error: Exception | None = None
    for attempt in range(retries + 1):
        # Prefer curl because it enforces a hard wall-clock max-time and
        # handles several feeds (Substack, Vercel redirects) more reliably
        # than urllib on macOS. This script is read-only and never posts data.
        try:
            completed = subprocess.run(
                ["curl", "-L", "--fail", "--silent", "--show-error", "--max-time", str(timeout), "-A", USER_AGENT, url],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=timeout + 3,
            )
            if completed.stdout:
                return completed.stdout[:max_bytes]
        except Exception as exc:
            last_error = exc

        if attempt < retries:
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(str(last_error))


def _sanitize_xml_bytes(xml_bytes: bytes) -> str:
    text = xml_bytes.decode("utf-8", errors="replace")
    # Some community feeds contain control characters that are illegal in XML
    # 1.0 and make ElementTree fail with "invalid token". Strip only those.
    return "".join(
        ch for ch in text
        if ch in "\t\n\r" or ord(ch) >= 0x20
    )


def parse_feed(xml_bytes: bytes, feed: dict[str, Any]) -> list[dict[str, Any]]:
    root = ET.fromstring(_sanitize_xml_bytes(xml_bytes))
    root_name = strip_ns(root.tag)
    entries: list[ET.Element]
    if root_name == "feed":
        entries = [n for n in list(root) if strip_ns(n.tag) == "entry"]
    else:
        channel = next((n for n in root.iter() if strip_ns(n.tag) == "channel"), root)
        entries = [n for n in list(channel) if strip_ns(n.tag) == "item"]

    out = []
    for entry in entries[: int(feed.get("max_items", 10))]:
        title = child_text(entry, ("title",)) or "Untitled"
        link = ""
        for child in list(entry):
            if strip_ns(child.tag) == "link":
                link = child.attrib.get("href") or child.text or ""
                if link:
                    break
        url = normalize_url(link)
        if not url:
            continue
        summary = child_text(entry, ("summary", "description", "content", "encoded"))
        published_raw = child_text(entry, ("published", "updated", "pubdate", "date"))
        published, published_ts = parse_date(published_raw)
        out.append({
            "title": title,
            "url": url,
            "summary": summary[:700],
            "published": published,
            "published_ts": published_ts,
            "feed_name": feed.get("name", "Unknown Feed"),
            "category": feed.get("category", "general"),
            "base_weight": float(feed.get("base_weight", 5.0)),
        })
    return out


def load_blacklist(path: Path | None) -> set[str]:
    if not path or not path.exists():
        return set()
    urls = set()
    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            urls.add(normalize_url(line))
    return urls


def score_article(item: dict[str, Any], config: dict[str, Any], now_ts: float) -> Article:
    score = float(item["base_weight"])
    reasons = [f"base {score:.1f}"]
    published_ts = item.get("published_ts")
    if published_ts:
        age_hours = max(0, (now_ts - published_ts) / 3600)
        if age_hours <= 24:
            score += 3.0; reasons.append("fresh <=24h +3")
        elif age_hours <= 48:
            score += 2.0; reasons.append("fresh <=48h +2")
        elif age_hours <= 72:
            score += 1.0; reasons.append("fresh <=72h +1")
        elif age_hours <= 168:
            score -= 1.0; reasons.append("older -1")
        else:
            score -= 3.0; reasons.append("stale -3")
    else:
        score += 0.3; reasons.append("unknown date +0.3")

    text = f"{item['title']} {item.get('summary','')} {item.get('category','')}".lower()
    for keyword, weight in config.get("priority_keywords", {}).items():
        if keyword.lower() in text:
            score += float(weight)
            reasons.append(f"{keyword} +{float(weight):g}")
    for keyword, weight in config.get("downrank_keywords", {}).items():
        if keyword.lower() in text:
            score += float(weight)
            reasons.append(f"{keyword} {float(weight):g}")

    return Article(score=round(score, 2), score_reasons=reasons, **item)


def dedupe_key(article: Article) -> str:
    if article.url:
        return article.url
    return hashlib.sha256(article.title.lower().encode()).hexdigest()


def render_markdown(articles: list[Article], failures: list[str], *, limit: int, generated_at: str) -> str:
    lines = [
        f"# Daily Brief RSS Radar — {generated_at}",
        "",
        "Purpose: source discovery only. Do not auto-include; select items by weight + relevance + corroboration.",
        "",
        "## Top Weighted Items",
    ]
    if not articles:
        lines.append("> No qualifying RSS items found.")
    for idx, article in enumerate(articles[:limit], 1):
        date = article.published or "date unknown"
        reasons = "; ".join(article.score_reasons[:6])
        summary = f" — {article.summary}" if article.summary else ""
        lines.extend([
            f"{idx}. **[{article.title}]({article.url})** — {article.feed_name} / {article.category} / {date} / weight `{article.score}`",
            f"   - Why surfaced: {reasons}",
            f"   - Snippet: {summary[:360].strip() or 'No summary in feed.'}",
        ])
    by_category: dict[str, int] = {}
    for article in articles:
        by_category[article.category] = by_category.get(article.category, 0) + 1
    lines.extend(["", "## Coverage", ""])
    if by_category:
        for category, count in sorted(by_category.items(), key=lambda kv: (-kv[1], kv[0])):
            lines.append(f"- {category}: {count}")
    else:
        lines.append("- none")
    if failures:
        lines.extend(["", "## Feed Fetch Failures", ""])
        lines.extend(f"- {failure}" for failure in failures)
    lines.append("")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build a weighted RSS radar for daily-brief")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--user-config", type=Path, default=DEFAULT_USER_CONFIG, help="Optional extra feeds/keywords JSON")
    parser.add_argument("--blacklist", type=Path, help="File containing URLs to exclude, one per line")
    parser.add_argument("--output", type=Path, help="Write markdown digest here")
    parser.add_argument("--json-output", type=Path, help="Write selected articles as JSON")
    parser.add_argument("--max-age-hours", type=float, default=96)
    parser.add_argument("--min-score", type=float, default=6.0)
    parser.add_argument("--limit", type=int, default=40)
    parser.add_argument("--timeout", type=int, default=12)
    parser.add_argument("--retries", type=int, default=1)
    args = parser.parse_args(argv)

    config = load_json(args.config)
    if args.user_config.exists():
        config = merge_configs(config, load_json(args.user_config))
    blacklist = load_blacklist(args.blacklist)
    now_ts = datetime.now(timezone.utc).timestamp()
    cutoff_ts = now_ts - args.max_age_hours * 3600

    candidates: list[Article] = []
    failures: list[str] = []
    seen: set[str] = set()
    for feed in config.get("feeds", []):
        try:
            max_bytes = int(feed.get("max_download_bytes", 2_000_000))
            feed_timeout = int(feed.get("timeout_seconds", args.timeout))
            raw = fetch_url(feed["url"], timeout=feed_timeout, retries=args.retries, max_bytes=max_bytes)
            items = parse_feed(raw, feed)
        except Exception as exc:  # keep broad: one bad feed must not kill daily brief
            failures.append(f"{feed.get('name', feed.get('url'))}: {exc}")
            continue
        for item in items:
            article = score_article(item, config, now_ts)
            key = dedupe_key(article)
            if key in seen or key in blacklist:
                continue
            seen.add(key)
            if article.published_ts and article.published_ts < cutoff_ts:
                continue
            if article.score < args.min_score:
                continue
            candidates.append(article)

    candidates.sort(key=lambda a: (a.score, a.published_ts or 0), reverse=True)
    selected = candidates[: args.limit]
    generated_at = datetime.now().astimezone().isoformat(timespec="seconds")
    md = render_markdown(selected, failures, limit=args.limit, generated_at=generated_at)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(md, encoding="utf-8")
    else:
        print(md)
    if args.json_output:
        args.json_output.parent.mkdir(parents=True, exist_ok=True)
        args.json_output.write_text(json.dumps([asdict(a) for a in selected], ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"RSS radar: {len(selected)} selected / {len(candidates)} candidates / {len(failures)} feed failures", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
