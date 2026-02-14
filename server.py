#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import os
import re
import sqlite3
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from uuid import uuid4


WORKSPACE_ROOT = Path(__file__).resolve().parent
DEFAULT_PORT = 19792
DEFAULT_DATA_DIR = Path(os.environ.get("WEBNAV_DATA_DIR", "/data"))
DEFAULT_REMOTE_ASSET_MAX_BYTES = 30 * 1024 * 1024
DEFAULT_REMOTE_TEXT_MAX_BYTES = 1024 * 1024
REMOTE_FETCH_TIMEOUT_SECONDS = 12

EXT_BY_MIME = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/avif": "avif",
    "image/gif": "gif",
    "image/svg+xml": "svg",
    "image/x-icon": "ico",
    "image/vnd.microsoft.icon": "ico",
}


def now_ts() -> int:
    return int(time.time())


def normalize_area(area: str | None) -> str:
    if area == "sync":
        return "sync"
    return "local"


def normalize_ext(ext: str | None) -> str:
    if not ext:
        return "bin"
    clean = ext.lower().strip().lstrip(".")
    if clean == "jpeg":
        return "jpg"
    if clean == "svg+xml":
        return "svg"
    if not re.fullmatch(r"[a-z0-9]{1,8}", clean):
        return "bin"
    return clean


def split_content_type(content_type: str | None) -> str:
    if not content_type:
        return "application/octet-stream"
    return content_type.split(";", 1)[0].strip().lower() or "application/octet-stream"


def ext_from_filename(filename: str | None) -> str | None:
    if not filename:
        return None
    base = filename.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    if "." not in base:
        return None
    return normalize_ext(base.rsplit(".", 1)[-1])


def ext_from_url(url: str | None) -> str | None:
    if not url:
        return None
    try:
        parsed = urllib.parse.urlparse(url)
        name = parsed.path.rsplit("/", 1)[-1]
    except Exception:
        return None
    return ext_from_filename(name)


def resolve_asset_ext(
    mime: str, filename: str | None = None, source_url: str | None = None
) -> str:
    from_name = ext_from_filename(filename)
    if from_name:
        return from_name
    from_url = ext_from_url(source_url)
    if from_url:
        return from_url
    if mime in EXT_BY_MIME:
        return EXT_BY_MIME[mime]
    guessed = mimetypes.guess_extension(mime or "") or ""
    return normalize_ext(guessed)


class Database:
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.lock = threading.Lock()
        self._init_schema()

    def _init_schema(self) -> None:
        with self.lock:
            self.conn.executescript(
                """
                PRAGMA journal_mode = WAL;
                CREATE TABLE IF NOT EXISTS storage (
                    area TEXT NOT NULL,
                    key TEXT NOT NULL,
                    value TEXT NOT NULL,
                    updated_at INTEGER NOT NULL,
                    PRIMARY KEY (area, key)
                );
                CREATE TABLE IF NOT EXISTS assets (
                    id TEXT PRIMARY KEY,
                    ext TEXT NOT NULL,
                    mime TEXT NOT NULL,
                    content BLOB NOT NULL,
                    sha256 TEXT NOT NULL UNIQUE,
                    source_url TEXT NOT NULL DEFAULT '',
                    created_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_assets_created_at ON assets(created_at DESC);
                """
            )
            self.conn.commit()

    def close(self) -> None:
        with self.lock:
            self.conn.close()

    def get_storage(self, area: str, keys: list[str] | None) -> dict[str, Any]:
        with self.lock:
            if keys is None:
                rows = self.conn.execute(
                    "SELECT key, value FROM storage WHERE area = ?",
                    (area,),
                ).fetchall()
            elif not keys:
                return {}
            else:
                placeholders = ",".join("?" for _ in keys)
                rows = self.conn.execute(
                    f"SELECT key, value FROM storage WHERE area = ? AND key IN ({placeholders})",
                    [area, *keys],
                ).fetchall()

        result: dict[str, Any] = {}
        for row in rows:
            try:
                result[row["key"]] = json.loads(row["value"])
            except json.JSONDecodeError:
                result[row["key"]] = None
        return result

    def set_storage(self, area: str, items: dict[str, Any]) -> None:
        ts = now_ts()
        with self.lock:
            for key, value in items.items():
                payload = json.dumps(value, ensure_ascii=False)
                self.conn.execute(
                    """
                    INSERT INTO storage(area, key, value, updated_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(area, key) DO UPDATE SET
                        value = excluded.value,
                        updated_at = excluded.updated_at
                    """,
                    (area, key, payload, ts),
                )
            self.conn.commit()

    def remove_storage(self, area: str, keys: list[str]) -> None:
        if not keys:
            return
        placeholders = ",".join("?" for _ in keys)
        with self.lock:
            self.conn.execute(
                f"DELETE FROM storage WHERE area = ? AND key IN ({placeholders})",
                [area, *keys],
            )
            self.conn.commit()

    def store_asset(
        self,
        content: bytes,
        mime: str,
        ext: str,
        source_url: str = "",
    ) -> dict[str, str]:
        digest = hashlib.sha256(content).hexdigest()
        with self.lock:
            existed = self.conn.execute(
                "SELECT id, ext, mime, sha256 FROM assets WHERE sha256 = ?",
                (digest,),
            ).fetchone()
            if existed:
                return {
                    "id": existed["id"],
                    "ext": existed["ext"],
                    "mime": existed["mime"],
                    "sha256": existed["sha256"],
                }

            asset_id = uuid4().hex
            self.conn.execute(
                """
                INSERT INTO assets(id, ext, mime, content, sha256, source_url, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (asset_id, ext, mime, content, digest, source_url, now_ts()),
            )
            self.conn.commit()
            return {"id": asset_id, "ext": ext, "mime": mime, "sha256": digest}

    def get_asset(self, asset_id: str) -> sqlite3.Row | None:
        with self.lock:
            return self.conn.execute(
                "SELECT id, ext, mime, content, sha256 FROM assets WHERE id = ?",
                (asset_id,),
            ).fetchone()


def fetch_remote_binary(url: str, max_bytes: int) -> tuple[bytes, str, str]:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError("只允许 http/https 地址")

    import ssl

    ssl_ctx = ssl.create_default_context()

    req = urllib.request.Request(
        url,
        method="GET",
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; WebNav/1.0)",
            "Accept": "image/*,*/*;q=0.8",
            "Accept-Encoding": "identity",
        },
    )
    with urllib.request.urlopen(
        req, timeout=REMOTE_FETCH_TIMEOUT_SECONDS, context=ssl_ctx
    ) as resp:
        content_type = split_content_type(resp.headers.get("Content-Type"))
        chunks: list[bytes] = []
        size = 0
        while True:
            chunk = resp.read(64 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > max_bytes:
                raise ValueError(f"远程文件超过限制（>{max_bytes} bytes）")
            chunks.append(chunk)
        body = b"".join(chunks)
        if not body:
            raise ValueError("远程文件为空")
        final_url = resp.geturl() or url
        return body, content_type, final_url


def fetch_remote_text(url: str, max_bytes: int) -> tuple[str, str, str]:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError("只允许 http/https 地址")

    import ssl

    ssl_ctx = ssl.create_default_context()

    req = urllib.request.Request(
        url,
        method="GET",
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; WebNav/1.0)",
            "Accept": (
                "text/html,application/xhtml+xml,application/xml;q=0.9,"
                "application/json;q=0.8,text/plain;q=0.7,*/*;q=0.5"
            ),
            "Accept-Encoding": "identity",
        },
    )
    with urllib.request.urlopen(
        req, timeout=REMOTE_FETCH_TIMEOUT_SECONDS, context=ssl_ctx
    ) as resp:
        content_type_header = resp.headers.get("Content-Type")
        content_type = split_content_type(content_type_header)
        chunks: list[bytes] = []
        size = 0
        while True:
            chunk = resp.read(64 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > max_bytes:
                raise ValueError(f"远程文本超过限制（>{max_bytes} bytes）")
            chunks.append(chunk)
        body = b"".join(chunks)
        if not body:
            raise ValueError("远程文本为空")
        charset = resp.headers.get_content_charset() or "utf-8"
        try:
            text = body.decode(charset, errors="replace")
        except LookupError:
            text = body.decode("utf-8", errors="replace")
        final_url = resp.geturl() or url
        return text, content_type, final_url


class WebNavHandler(BaseHTTPRequestHandler):
    db: Database
    static_root: Path

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A003
        super().log_message(format, *args)

    def handle(self) -> None:
        try:
            super().handle()
        except (BrokenPipeError, ConnectionError, ConnectionResetError, OSError):
            self.close_connection = True

    def handle_one_request(self) -> None:
        try:
            super().handle_one_request()
        except (BrokenPipeError, ConnectionError, ConnectionResetError):
            self.close_connection = True

    def finish(self) -> None:
        try:
            super().finish()
        except (BrokenPipeError, ConnectionError, ConnectionResetError, OSError):
            pass

    def _add_cors_headers(self) -> None:
        origin = self.headers.get("Origin", "*")
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "86400")

    def do_OPTIONS(self) -> None:  # noqa: N802
        try:
            self.send_response(HTTPStatus.NO_CONTENT)
            self._add_cors_headers()
            self.send_header("Content-Length", "0")
            self.end_headers()
        except (BrokenPipeError, ConnectionError, OSError):
            pass

    def do_GET(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/health":
            self._send_json(HTTPStatus.OK, {"ok": True, "ts": now_ts()})
            return

        if parsed.path.startswith("/assets/"):
            self._handle_get_asset(parsed.path)
            return

        self._handle_static(parsed.path)

    def do_POST(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/storage/get":
            self._handle_storage_get()
            return
        if parsed.path == "/api/storage/set":
            self._handle_storage_set()
            return
        if parsed.path == "/api/storage/remove":
            self._handle_storage_remove()
            return
        if parsed.path == "/api/assets":
            self._handle_assets_create(parsed)
            return
        if parsed.path == "/api/assets/fetch":
            self._handle_assets_fetch()
            return
        if parsed.path == "/api/fetch/text":
            self._handle_text_fetch()
            return

        self._send_error_json(HTTPStatus.NOT_FOUND, "接口不存在")

    def _read_body(self) -> bytes:
        raw_len = self.headers.get("Content-Length", "0").strip()
        try:
            content_len = int(raw_len)
        except ValueError:
            content_len = 0
        if content_len <= 0:
            return b""
        return self.rfile.read(content_len)

    def _read_json(self) -> dict[str, Any]:
        body = self._read_body()
        if not body:
            return {}
        try:
            return json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ValueError("无效的 JSON 请求体")

    def _send_json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self._add_cors_headers()
            self.end_headers()
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionError, OSError):
            pass

    def _send_error_json(self, status: HTTPStatus, message: str) -> None:
        self._send_json(status, {"ok": False, "error": message})

    def _absolute_url(self, path: str) -> str:
        proto = (self.headers.get("X-Forwarded-Proto") or "").split(",")[0].strip()
        if not proto:
            proto = "http"
        host = (
            (self.headers.get("X-Forwarded-Host") or "").split(",")[0].strip()
            or self.headers.get("Host")
            or f"127.0.0.1:{DEFAULT_PORT}"
        )
        return f"{proto}://{host}{path}"

    def _handle_storage_get(self) -> None:
        try:
            payload = self._read_json()
            area = normalize_area(payload.get("area"))
            keys_raw = payload.get("keys")
            if keys_raw is None:
                keys = None
            elif isinstance(keys_raw, list):
                keys = [str(k) for k in keys_raw]
            elif isinstance(keys_raw, str):
                keys = [keys_raw]
            else:
                keys = []
            items = self.db.get_storage(area, keys)
            self._send_json(HTTPStatus.OK, {"ok": True, "items": items})
        except ValueError as error:
            self._send_error_json(HTTPStatus.BAD_REQUEST, str(error))
        except Exception as error:
            self._send_error_json(
                HTTPStatus.INTERNAL_SERVER_ERROR, f"读取存储失败: {error}"
            )

    def _handle_storage_set(self) -> None:
        try:
            payload = self._read_json()
            area = normalize_area(payload.get("area"))
            items = payload.get("items") or {}
            if not isinstance(items, dict):
                raise ValueError("items 必须是对象")
            self.db.set_storage(area, items)
            self._send_json(HTTPStatus.OK, {"ok": True})
        except ValueError as error:
            self._send_error_json(HTTPStatus.BAD_REQUEST, str(error))
        except Exception as error:
            self._send_error_json(
                HTTPStatus.INTERNAL_SERVER_ERROR, f"写入存储失败: {error}"
            )

    def _handle_storage_remove(self) -> None:
        try:
            payload = self._read_json()
            area = normalize_area(payload.get("area"))
            keys = payload.get("keys") or []
            if not isinstance(keys, list):
                raise ValueError("keys 必须是数组")
            self.db.remove_storage(area, [str(k) for k in keys])
            self._send_json(HTTPStatus.OK, {"ok": True})
        except ValueError as error:
            self._send_error_json(HTTPStatus.BAD_REQUEST, str(error))
        except Exception as error:
            self._send_error_json(
                HTTPStatus.INTERNAL_SERVER_ERROR, f"删除存储失败: {error}"
            )

    def _handle_assets_create(self, parsed: urllib.parse.ParseResult) -> None:
        body = self._read_body()
        if not body:
            self._send_error_json(HTTPStatus.BAD_REQUEST, "请求体为空")
            return

        qs = urllib.parse.parse_qs(parsed.query or "")
        filename = (qs.get("filename") or [None])[0]
        source_url = (qs.get("source_url") or [""])[0]
        mime = split_content_type(self.headers.get("Content-Type"))
        ext = resolve_asset_ext(mime, filename=filename, source_url=source_url)
        if mime == "application/octet-stream":
            mime = mimetypes.types_map.get(f".{ext}", mime) or mime

        try:
            record = self.db.store_asset(body, mime, ext, source_url=source_url)
            asset_path = f"/assets/{record['id']}.{record['ext']}"
            asset_url = self._absolute_url(asset_path)
            self._send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "id": record["id"],
                    "ext": record["ext"],
                    "mime": record["mime"],
                    "path": asset_path,
                    "url": asset_url,
                },
            )
        except Exception as error:
            self._send_error_json(
                HTTPStatus.INTERNAL_SERVER_ERROR, f"保存资源失败: {error}"
            )

    def _handle_assets_fetch(self) -> None:
        try:
            payload = self._read_json()
            source_url = (payload.get("url") or "").strip()
            if not source_url:
                raise ValueError("url 不能为空")
            max_bytes = int(payload.get("maxBytes") or DEFAULT_REMOTE_ASSET_MAX_BYTES)
            if max_bytes <= 0:
                max_bytes = DEFAULT_REMOTE_ASSET_MAX_BYTES

            body, mime, final_url = fetch_remote_binary(source_url, max_bytes=max_bytes)
            ext = resolve_asset_ext(mime, filename=None, source_url=final_url)
            image_exts = {"jpg", "jpeg", "png", "webp", "avif", "gif", "svg", "ico"}
            if not mime.startswith("image/") and ext not in image_exts:
                raise ValueError("远程资源不是图片文件")
            record = self.db.store_asset(body, mime, ext, source_url=source_url)
            asset_path = f"/assets/{record['id']}.{record['ext']}"
            asset_url = self._absolute_url(asset_path)
            self._send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "id": record["id"],
                    "ext": record["ext"],
                    "mime": record["mime"],
                    "path": asset_path,
                    "url": asset_url,
                    "sourceUrl": source_url,
                    "finalUrl": final_url,
                },
            )
        except ValueError as error:
            self._send_error_json(HTTPStatus.BAD_REQUEST, str(error))
        except urllib.error.HTTPError as error:
            self._send_error_json(
                HTTPStatus.BAD_GATEWAY, f"远程请求失败: HTTP {error.code}"
            )
        except urllib.error.URLError as error:
            self._send_error_json(
                HTTPStatus.BAD_GATEWAY, f"远程请求失败: {error.reason}"
            )
        except Exception as error:
            self._send_error_json(
                HTTPStatus.INTERNAL_SERVER_ERROR, f"拉取远程资源失败: {error}"
            )

    def _handle_text_fetch(self) -> None:
        try:
            payload = self._read_json()
            source_url = (payload.get("url") or "").strip()
            if not source_url:
                raise ValueError("url 不能为空")
            max_bytes = int(payload.get("maxBytes") or DEFAULT_REMOTE_TEXT_MAX_BYTES)
            if max_bytes <= 0:
                max_bytes = DEFAULT_REMOTE_TEXT_MAX_BYTES

            text, content_type, final_url = fetch_remote_text(
                source_url, max_bytes=max_bytes
            )
            self._send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "text": text,
                    "contentType": content_type,
                    "sourceUrl": source_url,
                    "finalUrl": final_url,
                },
            )
        except ValueError as error:
            self._send_error_json(HTTPStatus.BAD_REQUEST, str(error))
        except urllib.error.HTTPError as error:
            self._send_error_json(
                HTTPStatus.BAD_GATEWAY, f"远程请求失败: HTTP {error.code}"
            )
        except urllib.error.URLError as error:
            self._send_error_json(
                HTTPStatus.BAD_GATEWAY, f"远程请求失败: {error.reason}"
            )
        except Exception as error:
            self._send_error_json(
                HTTPStatus.INTERNAL_SERVER_ERROR, f"拉取远程文本失败: {error}"
            )

    def _handle_get_asset(self, path: str) -> None:
        match = re.fullmatch(r"/assets/([0-9a-f]{32})(?:\.([a-z0-9]{1,8}))?", path)
        if not match:
            self._send_error_json(HTTPStatus.NOT_FOUND, "资源不存在")
            return
        asset_id = match.group(1)
        row = self.db.get_asset(asset_id)
        if not row:
            self._send_error_json(HTTPStatus.NOT_FOUND, "资源不存在")
            return

        content: bytes = row["content"]
        mime = row["mime"] or "application/octet-stream"
        try:
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
            self.send_header("ETag", row["sha256"])
            self._add_cors_headers()
            self.end_headers()
            self.wfile.write(content)
        except (BrokenPipeError, ConnectionError, OSError):
            pass

    def _handle_static(self, request_path: str) -> None:
        path = request_path or "/"
        if path == "/":
            rel = "newtab.html"
        else:
            rel = urllib.parse.unquote(path.lstrip("/"))
            if not rel:
                rel = "newtab.html"

        candidate = (self.static_root / rel).resolve()
        if not str(candidate).startswith(str(self.static_root.resolve())):
            self._send_error_json(HTTPStatus.FORBIDDEN, "禁止访问")
            return
        if not candidate.exists() or not candidate.is_file():
            self._send_error_json(HTTPStatus.NOT_FOUND, "文件不存在")
            return

        try:
            data = candidate.read_bytes()
        except OSError as error:
            self._send_error_json(
                HTTPStatus.INTERNAL_SERVER_ERROR, f"读取文件失败: {error}"
            )
            return

        mime, _ = mimetypes.guess_type(str(candidate))
        content_type = mime or "application/octet-stream"
        try:
            self.send_response(HTTPStatus.OK)
            self.send_header(
                "Content-Type",
                (
                    f"{content_type}; charset=utf-8"
                    if content_type.startswith("text/")
                    else content_type
                ),
            )
            self.send_header("Content-Length", str(len(data)))
            if candidate.suffix.lower() == ".html":
                self.send_header("Cache-Control", "no-store")
            else:
                self.send_header("Cache-Control", "public, max-age=3600")
            self.end_headers()
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionError, OSError):
            pass


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="WebNav local web server with SQLite persistence"
    )
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--data-dir", default=str(DEFAULT_DATA_DIR))
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    data_dir = Path(args.data_dir).resolve()
    db = Database(data_dir / "webnav.db")

    WebNavHandler.db = db
    WebNavHandler.static_root = WORKSPACE_ROOT

    server = ThreadingHTTPServer((args.host, args.port), WebNavHandler)
    print(f"WebNav server listening on http://{args.host}:{args.port}")
    print(f"SQLite DB: {(data_dir / 'webnav.db')}")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        db.close()


if __name__ == "__main__":
    main()
