#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "Building docker images via docker-compose..."
docker compose build --no-cache

echo "Saving images to decodex_images.tar..."
docker save -o decodex_images.tar decodex_backend:latest decodex_frontend:latest

echo "Saved: $ROOT_DIR/decodex_images.tar"
