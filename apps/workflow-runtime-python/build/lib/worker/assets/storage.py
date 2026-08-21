from __future__ import annotations

import json
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import boto3
from jsonschema import Draft202012Validator

from worker.core.config import RuntimeSettings, get_settings


class AssetStorage(ABC):
    @abstractmethod
    def upload_asset(self, asset_path: Path, metadata: dict[str, Any]) -> str: ...

    @abstractmethod
    def download_asset(self, asset_uri: str, destination: Path) -> Path: ...


class S3AssetStorage(AssetStorage):
    """Storage bridge aligned to asset-metadata.schema.json for image/video pipelines."""

    def __init__(self, settings: RuntimeSettings | None = None) -> None:
        self.settings = settings or get_settings()
        self.client = boto3.client("s3", region_name=self.settings.aws_region)
        schema_path = self.settings.resolved_contracts_root / "asset-metadata.schema.json"
        self.validator = Draft202012Validator(json.loads(schema_path.read_text(encoding="utf-8")))

    def upload_asset(self, asset_path: Path, metadata: dict[str, Any]) -> str:
        self.validator.validate(metadata)
        asset_id = metadata["assetId"]
        suffix = asset_path.suffix.lower() or ".bin"
        key = f"{self.settings.asset_prefix}/{metadata['ownership']['tenantId']}/{asset_id}{suffix}"
        extra_args = {"ContentType": metadata["mimeType"], "Metadata": {"asset-id": asset_id}}
        self.client.upload_file(str(asset_path), self.settings.asset_bucket, key, ExtraArgs=extra_args)
        manifest_key = f"{self.settings.asset_prefix}/{metadata['ownership']['tenantId']}/{asset_id}.metadata.json"
        self.client.put_object(Bucket=self.settings.asset_bucket, Key=manifest_key, Body=json.dumps(metadata).encode("utf-8"))
        return f"s3://{self.settings.asset_bucket}/{key}"

    def download_asset(self, asset_uri: str, destination: Path) -> Path:
        parsed = urlparse(asset_uri)
        if parsed.scheme != "s3":
            raise ValueError(f"Unsupported asset URI: {asset_uri}")
        destination.parent.mkdir(parents=True, exist_ok=True)
        self.client.download_file(parsed.netloc, parsed.path.lstrip("/"), str(destination))
        return destination


def build_storage(settings: RuntimeSettings | None = None) -> AssetStorage:
    return S3AssetStorage(settings or get_settings())
