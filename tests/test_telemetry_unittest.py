import unittest

from worker.telemetry import InMemoryTelemetry, TelemetryContext


class TelemetryPortTests(unittest.TestCase):
    def test_context_and_redaction(self):
        telemetry = InMemoryTelemetry()
        telemetry.log(
            "worker.started",
            TelemetryContext(correlation_id="corr-python", tenant_id="tenant-a"),
            {"authorization": "secret-value", "attempt": 1},
        )
        telemetry.increment("worker.jobs")

        self.assertEqual(telemetry.logs[0]["correlationId"], "corr-python")
        self.assertEqual(telemetry.logs[0]["attributes"]["authorization"], "[REDACTED]")
        self.assertEqual(telemetry.metrics["worker.jobs"], 1)


if __name__ == "__main__":
    unittest.main()
