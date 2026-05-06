# Measurement

State files under `harness/state/` log every loop run's duration, per-attempt reviewer verdicts, retry counts, and exhaustion events; the live conversation transcripts in `requirements_communication/`, `blueprints_communication/`, and `work-orders_communication/` (snapshotted into `harness/state/reviews/<loop-name>/attempt-<N>/` at attempt boundaries) capture push-back reasoning. Git history captures commit cadence across the artifact trees (`requirements/`, `blueprints/`, `work-orders/`, `artifacts/`).

From these sources the operator can observe: open-question count per upstream-loop run, attempts-to-pass distribution per loop, time-from-trigger-to-pass, and which reviewers most often flag issues. There is no external telemetry and no dashboards — the harness does not ship metrics to a monitoring system or render charts. Trends surface through ad-hoc inspection of state files, the snapshotted conversation transcripts, and git log.

This measurement surface is deliberately minimal. The operator is the sole consumer of the data and reads it only when a loop misbehaves or when they want to understand where time is being spent. Building a richer observability layer is not a goal.
