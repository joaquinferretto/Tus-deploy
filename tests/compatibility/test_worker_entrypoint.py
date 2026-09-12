import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "apps" / "workflow-runtime-python" / "src"))

from worker.main import example_job_payload, run_once  # noqa: E402


def test_worker_entrypoint_runs_example_job_and_preserves_context():
    job = example_job_payload()
    del job["payload"]["assetMetadata"]
    job["trace"]["correlationId"] = "corr-worker-entrypoint"
    job["payload"]["params"] = {"tenantId": "tenant-worker"}

    result = run_once(job)

    assert result["status"] == "succeeded"
    assert result["contractVersion"] == "1.0.0"
    assert result["input"]["params"]["tenantId"] == "tenant-worker"
    assert result["trace"]["correlationId"] == "corr-worker-entrypoint"
