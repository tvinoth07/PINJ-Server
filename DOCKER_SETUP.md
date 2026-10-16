# DecodeX Docker Setup Guide

## Overview
This package contains Docker images and configuration for the DecodeX project (Backend + Frontend).

**File:** `DecodeX-docker-complete.tar.gz` (332 MB)

## Contents
- `decodex_backend.tar` - Backend service Docker image (Python/FastAPI)
- `decodex_frontend.tar` - Frontend service Docker image (Node/Nginx)
- `docker-compose.yml` - Docker Compose configuration
- `backend/requirements` - Backend Python dependencies
- `frontend/package.json` & `frontend/package-lock.json` - Frontend dependencies

## Prerequisites
- Docker (version 20.10 or higher)
- Docker Compose (included with Docker Desktop on Windows/Mac, or available separately on Linux)
- At least 500MB of free disk space

## Installation & Usage

### 1. Extract the Archive
```bash
mkdir DecodeX-Docker
cd DecodeX-Docker
tar -xzf DecodeX-docker-complete.tar.gz
```

### 2. Load Docker Images
```bash
docker load < decodex_backend.tar
docker load < decodex_frontend.tar
```

### 3. Verify Images
```bash
docker images | grep decodex
```

You should see:
- `decodex_backend:latest`
- `decodex_frontend:latest`

### 4. Start Services
```bash
docker compose up -d
```

Or with the older syntax:
```bash
docker-compose up -d
```

### 5. Access Services
- **Frontend:** http://localhost:3000
- **Backend API:** http://localhost:8000

### 6. View Logs
```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f backend
docker compose logs -f frontend
```

### 7. Stop Services
```bash
docker compose down
```

## Service Details

### Backend Service
- **Image:** `decodex_backend:latest`
- **Port:** 8000
- **Tech Stack:** Python 3.11, FastAPI, Uvicorn
- **API Docs:** http://localhost:8000/docs (Swagger UI)

### Frontend Service
- **Image:** `decodex_frontend:latest`
- **Port:** 3000
- **Tech Stack:** Node 18 (build), Nginx (runtime)
- **Built with:** Vite, React

## Troubleshooting

### Port Already in Use
If ports 3000 or 8000 are already in use:
```bash
# Edit docker-compose.yml and change the ports:
# ports:
#   - "3000:3000"  -> "8080:3000"
#   - "8000:8000"  -> "8001:8000"

docker compose up -d
```

### Image Loading Issues
```bash
# Check available disk space
df -h

# Remove old images if needed
docker image prune -a

# Then reload images
docker load < decodex_backend.tar
docker load < decodex_frontend.tar
```

### Service Won't Start
```bash
# Check Docker daemon is running
docker ps

# Review logs for errors
docker compose logs -f [service_name]

# Restart services
docker compose restart
```

## Performance Notes
- Backend service uses 308 MB (compressed tar)
- Frontend service uses 26 MB (compressed tar)
- Total deployment size: ~334 MB
- Frontend build size warning: Main JS chunk is ~603KB (consider code splitting for optimization)

## Additional Commands

### Remove All Containers & Images
```bash
docker compose down -v
docker rmi decodex_backend:latest decodex_frontend:latest
```

### Rebuild from Source (if needed)
If you have the full source code and want to rebuild:
```bash
# From the DecodeX project root:
docker compose build
docker compose up -d
```

## Support
For issues or questions about the application, refer to the main DecodeX project documentation.
