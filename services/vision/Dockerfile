# TMistan vision service — Tesseract OCR (eng/fas/pus) + CLIP ViT-B/32 (ONNX, CPU).
# Render: type web, runtime docker, dockerfilePath services/vision/Dockerfile, healthCheckPath /health
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    CLIP_MODEL_PATH=/app/models/clip-vit-b32-vision-q8.onnx ORT_THREADS=2

RUN apt-get update \
 && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng tesseract-ocr-fas tesseract-ocr-pus curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

# Bake the model into the image so cold starts never depend on a download.
RUN mkdir -p /app/models \
 && curl -fsSL -o /app/models/clip-vit-b32-vision-q8.onnx \
      https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/onnx/vision_model_quantized.onnx

COPY app ./app
RUN useradd -r -u 10001 vision && chown -R vision /app
USER vision

EXPOSE 8000
HEALTHCHECK --interval=60s --timeout=5s CMD curl -fsS http://127.0.0.1:${PORT:-8000}/health || exit 1
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1 --timeout-keep-alive 20"]
