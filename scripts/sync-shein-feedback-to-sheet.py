#!/usr/bin/env python3
"""Sync SHEIN product feedback rows into a MaybeAI spreadsheet."""

from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any


DEFAULT_SHEET_URL = "https://www.maybe.ai/docs/spreadsheets/d/69d8a907505279d17a357c87?gid=9"
DEFAULT_MAYBEAI_BASE_URL = "https://play-be.omnimcp.ai"
DEFAULT_MAYBEAI_API_TIMEOUT = 300
DEFAULT_OPENCLI_CMD = "npm exec -- opencli"
DEFAULT_STORE = "店3"

SHEET_COLUMN_MAPPING = [
    ("店铺", None),
    ("评价时间", "commentTime"),
    ("评论ID", "commentId"),
    ("国家站点", "countrySiteCn"),
    ("SPU", "spu"),
    ("SKC", "skc"),
    ("商品SKU", "sku"),
    ("商品评分", "goodsCommentStar"),
    ("商品评分名称", "goodsCommentStarName"),
    ("商品评价内容", "goodsCommentContent"),
    ("商品评价图片", "goodsCommentImages"),
    ("物流评分", "logisticCommentStar"),
    ("物流评价内容", "logisticCommentContent"),
    ("下单时间", "orderTime"),
    ("订单号", "billNo"),
    ("合身标签", "memberOverallFitLabelList"),
    ("差评标签", "badCommentLabelList"),
]

SHEET_HEADERS = [header for header, _source in SHEET_COLUMN_MAPPING]
SOURCE_BY_SHEET_HEADER = {header: source for header, source in SHEET_COLUMN_MAPPING}
LEGACY_HEADER_BY_SOURCE = {source: source for _header, source in SHEET_COLUMN_MAPPING if source}
LEGACY_HEADER_BY_SOURCE["店铺"] = "店铺"
UNIQUE_KEY_FIELDS = ["店铺", "评价时间", "评论ID"]
COMMENT_TIME_FIELD = "评价时间"


class SyncError(RuntimeError):
    pass


def excel_column_name(index: int) -> str:
    if index <= 0:
        raise ValueError("Excel column index must be positive.")
    name = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        name = chr(ord("A") + remainder) + name
    return name


LAST_COLUMN = excel_column_name(len(SHEET_HEADERS))


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[len("export ") :]
        key, value = line.split("=", 1)
        key = key.strip()
        if key and key not in os.environ:
            os.environ[key] = value.strip().strip('"').strip("'")


def maybeai_token() -> str:
    for name in ("MAYBEAI_API_TOKEN", "MAYBEAI_AUTH_TOKEN", "MAYBEAI_API_KEY"):
        token = os.environ.get(name)
        if token:
            return token
    raise SyncError("Missing MaybeAI token. Set MAYBEAI_API_TOKEN, MAYBEAI_AUTH_TOKEN, or MAYBEAI_API_KEY.")


def parse_sheet_url(url: str) -> tuple[str, str | None]:
    match = re.search(r"/spreadsheets/d/([^/?#]+)", url)
    if not match:
        raise SyncError(f"Cannot parse document id from sheet URL: {url}")
    query = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
    return match.group(1), query.get("gid", [None])[0]


def shell_words(command: str) -> list[str]:
    try:
        return shlex.split(command)
    except ValueError as error:
        raise SyncError(f"Invalid command: {command}") from error


def run_command(command: list[str], cwd: Path, timeout: int) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        cwd=str(cwd),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
        check=False,
    )


def command_output(result: subprocess.CompletedProcess[str]) -> str:
    return "\n".join(part for part in (result.stdout.strip(), result.stderr.strip()) if part)


def looks_auth_required(text: str) -> bool:
    lowered = text.lower()
    needles = [
        "authrequired",
        "auth required",
        "not logged in",
        "login",
        "登录",
        "session is not ready",
        "returned an html/auth page",
        "code=20302",
    ]
    return any(needle in lowered for needle in needles)


def looks_retryable_cli_failure(text: str) -> bool:
    lowered = text.lower()
    needles = [
        "failed to fetch",
        "browser exec command timed out",
        "capture timeout",
        "search button not found",
        "inspected target navigated or closed",
        "target closed",
        "aborterror",
        "networkerror",
        "fetch failed after",
        "http 500",
        "http 502",
        "http 503",
        "http 504",
    ]
    return any(needle in lowered for needle in needles)


def build_opencli_base(args: argparse.Namespace) -> list[str]:
    opencli = shell_words(args.opencli_cmd)
    if args.profile:
        opencli.extend(["--profile", args.profile])
    return opencli


def shein_credentials(args: argparse.Namespace) -> tuple[str, str]:
    username = args.shein_username or os.environ.get("SHEIN_USERNAME") or os.environ.get("SHEIN_USER") or ""
    password = args.shein_password or os.environ.get("SHEIN_PASSWORD") or os.environ.get("SHEIN_PASS") or ""
    return username, password


def build_shein_login_command(opencli: list[str], args: argparse.Namespace) -> list[str]:
    login_cmd = [*opencli, "shein", "login"]
    username, password = shein_credentials(args)
    if username:
        login_cmd.extend(["--username", username])
    if password:
        login_cmd.extend(["--password", password])
    return login_cmd


def ensure_shein_session(args: argparse.Namespace, repo_root: Path, opencli: list[str]) -> None:
    if not args.preflight_login:
        return

    whoami_cmd = [*opencli, "shein", "whoami", "-f", "json"]
    last_output = ""
    for attempt in range(1, args.attempts + 1):
        print(f"Checking SHEIN session with whoami (attempt {attempt}/{args.attempts})...")
        whoami = run_command(whoami_cmd, repo_root, args.login_timeout)
        if whoami.returncode == 0:
            print("SHEIN session is ready.")
            return

        output = command_output(whoami)
        auth_required = looks_auth_required(output)
        retryable = looks_retryable_cli_failure(output)
        if not auth_required and not retryable and not args.login_on_retry:
            raise SyncError(f"SHEIN whoami failed with exit code {whoami.returncode}:\n{output}")

        print("SHEIN session is not ready; running login CLI before fetching feedback...")
        login = run_command(build_shein_login_command(opencli, args), repo_root, args.login_timeout)
        last_output = command_output(login)
        if login.returncode == 0:
            if args.login_wait_seconds > 0:
                time.sleep(args.login_wait_seconds)
            verify = run_command(whoami_cmd, repo_root, args.login_timeout)
            if verify.returncode == 0:
                print("SHEIN session is ready after login.")
                return
            last_output = command_output(verify)
        elif not looks_retryable_cli_failure(last_output) and not looks_auth_required(last_output):
            raise SyncError(f"SHEIN login CLI failed with exit code {login.returncode}:\n{last_output}")

        if attempt < args.attempts and args.retry_delay_seconds > 0:
            print(f"SHEIN session preflight failed; retrying in {args.retry_delay_seconds}s...")
            time.sleep(args.retry_delay_seconds)

    raise SyncError(f"SHEIN login/session preflight failed after {args.attempts} attempts:\n{last_output}")


def extract_json_array(text: str) -> list[dict[str, Any]]:
    stripped = text.strip()
    candidates = [stripped]
    start = stripped.find("[")
    end = stripped.rfind("]")
    if start >= 0 and end > start:
        candidates.append(stripped[start : end + 1])

    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, list):
            if not all(isinstance(item, dict) for item in parsed):
                raise SyncError("SHEIN CLI returned a JSON array, but not all items are objects.")
            return parsed
    raise SyncError(f"SHEIN CLI did not return a JSON array. Output preview:\n{stripped[:1000]}")


def normalize_comment_time(value: Any, *, end_of_day: bool = False) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    match = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?)?$", text)
    if not match:
        return text
    year, month, day, hour, minute, second = match.groups()
    if hour is None and end_of_day:
        hour, minute, second = "23", "59", "59"
    pad = lambda part, default="0": str(int(part or default)).zfill(2)
    return f"{year}-{pad(month)}-{pad(day)} {pad(hour)}:{pad(minute)}:{pad(second)}"


def default_start_time() -> str:
    yesterday = datetime.now() - timedelta(days=1)
    return yesterday.strftime("%Y-%m-%d 00:00:00")


def default_end_time() -> str:
    return datetime.now().strftime("%Y-%m-%d 23:59:59")


def safe_filename_part(value: str) -> str:
    cleaned = re.sub(r"[\\/:*?\"<>|]+", "_", value.strip())
    return cleaned or "shein"


def save_raw_rows(rows: list[dict[str, Any]], store: str, output_dir: Path) -> Path:
    path = output_dir / f"{safe_filename_part(store)}商品评价数据.json"
    path.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def fetch_shein_rows(args: argparse.Namespace, repo_root: Path) -> list[dict[str, Any]]:
    opencli = build_opencli_base(args)
    ensure_shein_session(args, repo_root, opencli)

    feedback_cmd = [*opencli, "shein", "feedback", "-f", "json"]
    if args.limit is not None:
        feedback_cmd.extend(["--limit", str(args.limit)])
    if args.per_page is not None:
        feedback_cmd.extend(["--perPage", str(args.per_page)])
    if args.max_pages is not None:
        feedback_cmd.extend(["--maxPages", str(args.max_pages)])
    if args.start_time:
        feedback_cmd.extend(["--sinceCommentTime", args.start_time])
    if args.end_time:
        feedback_cmd.extend(["--untilCommentTime", args.end_time])
    if args.opencli_timeout is not None:
        feedback_cmd.extend(["--timeout", str(args.opencli_timeout)])
    if args.request_timeout is not None:
        feedback_cmd.extend(["--requestTimeout", str(args.request_timeout)])
    if args.api_retry_attempts is not None:
        feedback_cmd.extend(["--retryAttempts", str(args.api_retry_attempts)])
    if args.api_retry_delay_ms is not None:
        feedback_cmd.extend(["--retryDelayMs", str(args.api_retry_delay_ms)])

    login_cmd = build_shein_login_command(opencli, args)
    last_output = ""
    for attempt in range(1, args.attempts + 1):
        print(
            f"Running SHEIN feedback CLI (attempt {attempt}/{args.attempts}): "
            f"{' '.join(shlex.quote(item) for item in feedback_cmd)}"
        )
        result = run_command(feedback_cmd, repo_root, args.cli_timeout)
        if result.returncode == 0:
            return extract_json_array(result.stdout)

        last_output = command_output(result)
        auth_required = looks_auth_required(last_output)
        retryable = looks_retryable_cli_failure(last_output)
        if not auth_required and not retryable:
            raise SyncError(f"SHEIN feedback CLI failed with exit code {result.returncode}:\n{last_output}")

        if auth_required or args.login_on_retry:
            print("Refreshing SHEIN session with login CLI before retry...")
            login = run_command(login_cmd, repo_root, args.login_timeout)
            if login.returncode != 0:
                login_output = command_output(login)
                if auth_required or attempt >= args.attempts:
                    raise SyncError(f"SHEIN login CLI failed with exit code {login.returncode}:\n{login_output}")
                print(f"SHEIN login refresh failed but retrying feedback later:\n{login_output}")
            elif args.login_wait_seconds > 0:
                time.sleep(args.login_wait_seconds)

        if attempt < args.attempts and args.retry_delay_seconds > 0:
            time.sleep(args.retry_delay_seconds)

    raise SyncError(f"SHEIN feedback CLI failed after {args.attempts} attempts:\n{last_output}")


def normalize_cell(value: Any) -> Any:
    if value is None:
        return ""
    if isinstance(value, list):
        return json.dumps([normalize_cell(item) for item in value if item is not None], ensure_ascii=False)
    if isinstance(value, dict):
        return json.dumps(value, ensure_ascii=False)
    return value


def sheet_value(row: dict[str, Any], store: str, source: str | None) -> Any:
    if source is None:
        return store
    return normalize_cell(row.get(source, ""))


def rows_to_records(rows: list[dict[str, Any]], store: str) -> list[dict[str, Any]]:
    return [
        {header: sheet_value(row, store, source) for header, source in SHEET_COLUMN_MAPPING}
        for row in rows
    ]


def is_blank_record(record: dict[str, Any]) -> bool:
    return all(str(value or "").strip() == "" for value in record.values())


def normalize_sheet_record(record: dict[str, Any]) -> dict[str, Any]:
    normalized = {}
    for header in SHEET_HEADERS:
        value = record.get(header, "")
        if value == "":
            source = SOURCE_BY_SHEET_HEADER.get(header)
            if source:
                value = record.get(source, "")
        normalized[header] = normalize_cell(value)
    return normalized


def header_aliases(header: str) -> list[str]:
    aliases = [header]
    source = SOURCE_BY_SHEET_HEADER.get(header)
    if source:
        aliases.append(source)
    legacy = LEGACY_HEADER_BY_SOURCE.get(header)
    if legacy:
        aliases.append(legacy)
    return aliases


def records_from_sheet_values(values: Any) -> list[dict[str, Any]]:
    if not isinstance(values, list) or not values:
        return []
    raw_headers = values[0]
    if not isinstance(raw_headers, list):
        return []
    headers = [str(header or "").strip() for header in raw_headers]
    index_by_header = {header: index for index, header in enumerate(headers) if header}

    records: list[dict[str, Any]] = []
    for raw_row in values[1:]:
        if not isinstance(raw_row, list):
            continue
        record: dict[str, Any] = {}
        for header in SHEET_HEADERS:
            index = next((index_by_header[alias] for alias in header_aliases(header) if alias in index_by_header), None)
            record[header] = normalize_cell(raw_row[index]) if index is not None and index < len(raw_row) else ""
        records.append(record)
    return records


def record_unique_key(record: dict[str, Any]) -> tuple[str, ...]:
    values = []
    for field in UNIQUE_KEY_FIELDS:
        value = normalize_comment_time(record.get(field)) if field == COMMENT_TIME_FIELD else str(record.get(field, "")).strip()
        values.append(value)
    return tuple(values)


def merge_records_by_unique_key(existing_records: list[dict[str, Any]], fresh_records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged_by_key: dict[tuple[str, ...], dict[str, Any]] = {}
    key_order: list[tuple[str, ...]] = []
    for record in [*existing_records, *fresh_records]:
        normalized = normalize_sheet_record(record)
        if is_blank_record(normalized):
            continue
        key = record_unique_key(normalized)
        if key not in merged_by_key:
            key_order.append(key)
        merged_by_key[key] = normalized
    return [merged_by_key[key] for key in key_order]


def sort_records_by_comment_time_desc(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(records, key=lambda record: normalize_comment_time(record.get(COMMENT_TIME_FIELD)), reverse=True)


class MaybeAIClient:
    def __init__(self, base_url: str, token: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token

    def post(self, path: str, payload: dict[str, Any], timeout: int = DEFAULT_MAYBEAI_API_TIMEOUT) -> dict[str, Any]:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(
            f"{self.base_url}{path}",
            data=data,
            headers={
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.loads(response.read().decode("utf-8", "replace"))
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", "replace")
            raise SyncError(f"MaybeAI API {path} failed with HTTP {error.code}:\n{body}") from error
        except urllib.error.URLError as error:
            raise SyncError(f"MaybeAI API {path} failed: {error}") from error


def resolve_worksheet_name(client: MaybeAIClient, doc_id: str, gid: str | None) -> str | None:
    if gid is None:
        return None
    payload = {"uri": f"https://www.maybe.ai/docs/spreadsheets/d/{doc_id}"}
    data = client.post("/api/v1/excel/list_worksheets", payload, timeout=30)
    for worksheet in data.get("worksheets", []):
        candidates = {
            str(worksheet.get("gid", "")),
            str(worksheet.get("sheet_id", "")),
            str(worksheet.get("index", "")),
        }
        if str(gid) in candidates:
            return (
                worksheet.get("worksheet_name")
                or worksheet.get("title")
                or worksheet.get("name")
                or worksheet.get("sheet_name")
            )
    return None


def build_sheet_target(args: argparse.Namespace, client: MaybeAIClient) -> tuple[dict[str, Any], str | None]:
    doc_id, gid = parse_sheet_url(args.sheet_url)
    worksheet_name = args.worksheet_name or resolve_worksheet_name(client, doc_id, gid)
    uri = f"https://www.maybe.ai/docs/spreadsheets/d/{doc_id}"
    if gid is not None:
        uri = f"{uri}?gid={gid}"
    target: dict[str, Any] = {"uri": uri}
    if worksheet_name:
        target["worksheet_name"] = worksheet_name
    return target, worksheet_name


def read_sheet_records(client: MaybeAIClient, target: dict[str, Any], read_range: str | None = None) -> list[dict[str, Any]]:
    read_payload = {**target}
    if read_range:
        read_payload["range_address"] = read_range
    print(f"Reading existing rows from {read_range or 'entire worksheet'}...")
    read_result = client.post("/api/v1/excel/read_sheet", read_payload)
    if read_result.get("success") is False:
        raise SyncError(f"MaybeAI read_sheet did not succeed:\n{json.dumps(read_result, ensure_ascii=False)}")
    existing_records = records_from_sheet_values(read_result.get("values", []))
    if existing_records:
        return existing_records
    return [
        normalize_sheet_record(record)
        for record in read_result.get("data", [])
        if isinstance(record, dict)
    ]


def write_sheet(args: argparse.Namespace, rows: list[dict[str, Any]]) -> None:
    token = maybeai_token()
    client = MaybeAIClient(args.maybeai_base_url, token)
    target, worksheet_name = build_sheet_target(args, client)
    existing_records = read_sheet_records(client, target, args.read_range)

    if args.ensure_headers:
        header_range = f"A1:{LAST_COLUMN}1"
        header_payload = {**target, "range_address": header_range, "values": [SHEET_HEADERS]}
        print(f"Ensuring header row {header_range}...")
        header_result = client.post("/api/v1/excel/update_range", header_payload)
        if header_result.get("success") is False:
            raise SyncError(f"MaybeAI header update did not succeed:\n{json.dumps(header_result, ensure_ascii=False)}")

    current_store_records = rows_to_records(rows, args.store)
    merged_records = merge_records_by_unique_key(existing_records, current_store_records)
    merged_records = sort_records_by_comment_time_desc(merged_records)
    data_range = f"A2:{LAST_COLUMN}{len(merged_records) + 1}" if merged_records else f"A2:{LAST_COLUMN}2"
    print(
        "Writing merged rows with update_data_keep_headers "
        f"({len(existing_records)} existing rows merged with {len(current_store_records)} fresh rows by "
        f"{' + '.join(UNIQUE_KEY_FIELDS)})..."
    )
    write_payload = {
        **target,
        "data": merged_records,
        "preserve_formulas": True,
        "skip_recalculation": False,
        "start_row": 2,
    }
    write_result = client.post("/api/v1/excel/update_data_keep_headers", write_payload)
    if write_result.get("success") is False:
        raise SyncError(f"MaybeAI update_data_keep_headers did not succeed:\n{json.dumps(write_result, ensure_ascii=False)}")

    print(
        "Done:",
        json.dumps(
            {
                "spreadsheet_url": write_result.get("spreadsheet_url") or args.sheet_url,
                "worksheet": write_result.get("worksheet") or worksheet_name,
                "range": write_result.get("range") or data_range,
                "rows": len(merged_records),
                "fresh_store_rows": len(current_store_records),
                "unique_key": UNIQUE_KEY_FIELDS,
                "sort": f"{COMMENT_TIME_FIELD} desc",
                "write_api": "update_data_keep_headers",
            },
            ensure_ascii=False,
        ),
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Sync SHEIN product feedback into a MaybeAI sheet.")
    parser.add_argument("--start-time", default=default_start_time(), help="Start comment time, exclusive. Default: yesterday 00:00:00")
    parser.add_argument("--end-time", default=default_end_time(), help="End comment time, inclusive. Default: today 23:59:59")
    parser.add_argument("--limit", type=int, help="Optional SHEIN feedback limit.")
    parser.add_argument("--per-page", dest="per_page", type=int, help="Optional SHEIN feedback perPage.")
    parser.add_argument("--max-pages", dest="max_pages", type=int, help="Optional SHEIN feedback maxPages.")
    parser.add_argument("--store", default=DEFAULT_STORE, help=f"Value for the 店铺 column. Default: {DEFAULT_STORE}")
    parser.add_argument("--sheet-url", default=DEFAULT_SHEET_URL, help="MaybeAI spreadsheet URL with gid.")
    parser.add_argument("--worksheet-name", help="Optional worksheet name override.")
    parser.add_argument("--read-range", help="Optional existing data range to read before merging. Omitted by default so MaybeAI returns the whole worksheet.")
    parser.add_argument("--maybeai-base-url", default=DEFAULT_MAYBEAI_BASE_URL, help="MaybeAI API base URL.")
    parser.add_argument("--ensure-headers", action="store_true", help="Rewrite the header row with the script schema before writing data. Off by default.")
    parser.add_argument("--opencli-cmd", default=DEFAULT_OPENCLI_CMD, help=f"Command used to invoke OpenCLI. Default: {DEFAULT_OPENCLI_CMD!r}")
    parser.add_argument("--profile", help="Optional OpenCLI Browser Bridge profile alias/id, e.g. profile1.")
    parser.add_argument("--env-file", action="append", default=[], help="Optional .env file to load before reading tokens.")
    parser.add_argument("--opencli-timeout", type=int, help="Optional SHEIN command total timeout seconds passed as OpenCLI --timeout.")
    parser.add_argument("--request-timeout", type=int, help="Optional single SHEIN page API request timeout seconds passed as --requestTimeout.")
    parser.add_argument("--api-retry-attempts", type=int, help="Optional SHEIN page API retry attempts passed to OpenCLI.")
    parser.add_argument("--api-retry-delay-ms", type=int, help="Optional SHEIN page API retry base delay passed to OpenCLI.")
    parser.add_argument("--attempts", type=int, default=3, help="Whole SHEIN feedback CLI attempts before giving up. Default: 3")
    parser.add_argument("--retry-delay-seconds", type=int, default=10, help="Delay between whole-command retries. Default: 10")
    parser.add_argument("--login-on-retry", action=argparse.BooleanOptionalAction, default=True, help="Run shein login before retrying auth/network failures. Default: true")
    parser.add_argument("--cli-timeout", type=int, default=1800, help="Timeout for the whole feedback CLI subprocess in seconds. Default: 1800")
    parser.add_argument("--login-timeout", type=int, default=600, help="Timeout for login CLI in seconds. Default: 600")
    parser.add_argument("--login-wait-seconds", type=int, default=2, help="Delay before retrying after login. Default: 2")
    parser.add_argument("--preflight-login", action=argparse.BooleanOptionalAction, default=True, help="Run shein whoami before fetching and login first when the session is unavailable. Default: true")
    parser.add_argument("--shein-username", help="Optional SHEIN username for automatic login. Defaults to SHEIN_USERNAME or SHEIN_USER env var.")
    parser.add_argument("--shein-password", help="Optional SHEIN password for automatic login. Defaults to SHEIN_PASSWORD or SHEIN_PASS env var.")
    parser.add_argument("--dry-run", action="store_true", help="Fetch SHEIN data and print a summary without writing to MaybeAI.")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    for env_file in args.env_file:
        load_env_file(Path(env_file).expanduser())

    args.start_time = normalize_comment_time(args.start_time)
    args.end_time = normalize_comment_time(args.end_time, end_of_day=True)

    try:
        rows = fetch_shein_rows(args, repo_root)
        print(f"Fetched {len(rows)} SHEIN feedback rows.")
        raw_path = save_raw_rows(rows, args.store, Path.cwd())
        print(f"Saved raw SHEIN JSON to {raw_path}")
        if args.dry_run:
            print(json.dumps(rows[:3], ensure_ascii=False, indent=2))
            return 0
        write_sheet(args, rows)
        return 0
    except subprocess.TimeoutExpired as error:
        print(f"Timed out while running: {' '.join(error.cmd)}", file=sys.stderr)
        return 1
    except SyncError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
