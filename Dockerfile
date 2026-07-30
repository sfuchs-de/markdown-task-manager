FROM node:22-bookworm-slim AS web
WORKDIR /app
COPY web/package.json web/package-lock.json ./web/
RUN npm --prefix web ci
COPY web ./web
RUN npm --prefix web run build

FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PM_VAULT_ROOT=/vault
WORKDIR /app
COPY requirements.txt .
RUN python -m pip install --no-cache-dir -r requirements.txt
COPY server ./server
COPY scripts ./scripts
COPY --from=web /app/web/dist ./web/dist
RUN mkdir -p /vault && useradd --create-home --uid 10001 app && chown -R app:app /app /vault
USER app
EXPOSE 8765
CMD ["python", "-m", "uvicorn", "server.app:app", "--host", "0.0.0.0", "--port", "8765"]
