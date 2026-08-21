from worker.telemetry import InMemoryTelemetry, TelemetryContext


def test_python_telemetry_preserves_correlation_and_redacts_secrets():
    telemetry = InMemoryTelemetry()
    telemetry.log(
        "worker.started",
        TelemetryContext(correlation_id="corr-python", tenant_id="tenant-a"),
        {"authorization": "secret-value", "attempt": 1},
    )
    telemetry.increment("worker.jobs")

    assert telemetry.logs[0]["correlationId"] == "corr-python"
    assert telemetry.logs[0]["tenantId"] == "tenant-a"
    assert telemetry.logs[0]["attributes"]["authorization"] == "[REDACTED]"
    assert telemetry.metrics["worker.jobs"] == 1
