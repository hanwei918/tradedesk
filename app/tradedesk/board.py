"""Product board: the latest status of every product on every channel.

Statuses (in order): 未生成 → 不能发 / 需人工确认 / 可上架 → 已上架.
"已上架" is set by a person, and code refuses it while the latest check is red.
State lives in state/board.json; the latest full result per cell in state/results/.
"""

import json
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATE_DIR = ROOT / "state"
CHANNELS = ["image", "amazon_us", "tiktok_mx"]
STATUS = {"red": "不能发", "amber": "需人工确认", "green": "可上架"}


class Board:
    def __init__(self, state_dir=STATE_DIR):
        self.dir = Path(state_dir)
        self.path = self.dir / "board.json"
        self.lock = threading.Lock()

    def _read(self):
        if not self.path.exists():
            return {}
        return json.loads(self.path.read_text(encoding="utf-8"))

    def _write(self, data):
        self.dir.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(self.path)

    def record(self, product_id, channel, result, run_id):
        """Store the latest check of one cell (a listing platform or the main image)."""
        findings = result.get("findings", [])
        cell = {"risk": result["risk"], "status": STATUS[result["risk"]], "run_id": run_id,
                "updated": time.strftime("%Y-%m-%d %H:%M"),
                "red": sum(f["severity"] == "red" for f in findings),
                "amber": sum(f["severity"] == "amber" for f in findings),
                "listed": False}
        with self.lock:
            data = self._read()
            data.setdefault(product_id, {})[channel] = cell
            self._write(data)
        results = self.dir / "results"
        results.mkdir(parents=True, exist_ok=True)
        (results / f"{product_id}__{channel}.json").write_text(
            json.dumps(result, ensure_ascii=False), encoding="utf-8")
        return cell

    def mark_listed(self, product_id, channel, listed=True):
        with self.lock:
            data = self._read()
            cell = (data.get(product_id) or {}).get(channel)
            if not cell:
                raise ValueError("这个格子还没有生成和检查，不能标记上架")
            if listed and cell["risk"] == "red":
                raise ValueError("最近一次检查是红色（不能发），不能标记为已上架")
            cell["listed"] = bool(listed)
            cell["status"] = "已上架" if listed else STATUS[cell["risk"]]
            self._write(data)
            return cell

    def save_image(self, product_id, media, raw):
        d = self.dir / "images"
        d.mkdir(parents=True, exist_ok=True)
        for old in d.glob(f"{product_id}.*"):
            old.unlink()
        ext = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif"}[media]
        (d / f"{product_id}.{ext}").write_bytes(raw)

    def image_path(self, product_id):
        d = self.dir / "images"
        hits = sorted(d.glob(f"{product_id}.*")) if d.exists() else []
        return hits[0] if hits else None

    def result(self, product_id, channel):
        p = self.dir / "results" / f"{product_id}__{channel}.json"
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None

    def snapshot(self, product_ids):
        data = self._read()
        rows = []
        for pid in product_ids:
            cells = data.get(pid, {})
            rows.append({"product_id": pid,
                         "cells": {c: cells.get(c) or {"status": "未生成", "risk": None} for c in CHANNELS}})
        return rows

    def forget(self, product_id):
        """Drop every cell, result and image of one product (used when a product added in the app is deleted)."""
        with self.lock:
            data = self._read()
            if data.pop(product_id, None) is not None:
                self._write(data)
            for pattern in (f"results/{product_id}__*.json", f"images/{product_id}.*"):
                for f in self.dir.glob(pattern):
                    f.unlink()

    def reset(self):
        with self.lock:
            if self.path.exists():
                self.path.unlink()
            for sub in ("results", "images"):
                if (self.dir / sub).exists():
                    for p in (self.dir / sub).iterdir():
                        p.unlink()
