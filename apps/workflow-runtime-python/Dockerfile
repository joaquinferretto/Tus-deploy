FROM python:3.12-slim
WORKDIR /workspace
COPY apps/workflow-runtime-python/pyproject.toml apps/workflow-runtime-python/README.md ./apps/workflow-runtime-python/
COPY apps/workflow-runtime-python/src ./apps/workflow-runtime-python/src
COPY packages/contracts ./packages/contracts
RUN pip install --no-cache-dir jsonschema && pip install --no-cache-dir --no-deps -e ./apps/workflow-runtime-python
CMD ["python", "-m", "worker.main"]
