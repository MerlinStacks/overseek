# Zero-Downtime Deployment Guide

## Initial Setup

For first-time installations:

```bash
docker network create proxy-net   # required once per host (for reverse proxy integration)
bash setup.sh                      # interactive, or:
bash setup.sh --domain=myapp.example.com  # non-interactive
docker compose up -d
```

After containers start, open your `APP_URL` and register. The **first user to register becomes the platform superadmin**.

See the [README](./README.md) for full Quick Start instructions.

---

## Overview

OverSeek supports zero-downtime updates via Portainer with health checks.

---

## How It Works

1. **Health Endpoints** (already in API):
   - `/health` - Basic check
   - `/health/ready` - Full dependency check (DB, Redis, ES)
   - `/health/live` - Simple liveness ping

2. **Docker Health Checks** (added to docker-compose.yml):
   - API: Waits 180s startup, checks `/health/live` every 15s
   - Web: Waits 30s startup, checks port 80 every 15s

3. **Portainer Integration**:
   - Portainer monitors health status
   - Won't route traffic until container is healthy
   - Rolling update waits for new container to be ready

---

## Deployment Process (Portainer)

### Standard Update
1. Go to **Stacks → overseekv2**
2. Click **Editor** tab
3. Click **"Update the stack"**
4. Enable **"Re-pull image and redeploy"**
5. Click **"Update"**

Portainer will:
- Pull new images
- Start new containers
- Wait for health checks to pass
- Route traffic to new containers
- Stop old containers

### Per-Service Update (Safer)
```bash
# On the server via SSH or Portainer console
docker compose build api
docker compose up -d --no-deps api
# Wait for healthy, then:
docker compose build web
docker compose up -d --no-deps web
```

---

## NPM Configuration

Your Nginx Proxy Manager should route to the container names:
- **API**: `http://<stack-name>-api-1:3000`
- **Web**: `http://<stack-name>-web-1:80`

> **Note:** `<stack-name>` is the directory name where `docker-compose.yml` lives (e.g., `overseekv2-api-1` if cloned into `overseekv2/`). Check with `docker ps --format "{{.Names}}"`.

No changes needed after initial setup — NPM continues routing to the same hostnames.

---

## Monitoring Health

```bash
# Check container health status
docker ps --format "table {{.Names}}\t{{.Status}}"

# Test health endpoint directly
curl http://localhost:3000/health/ready
```

---

## Rollback

If an update fails:
```bash
# Portainer: Click "Rollback" on the stack
# Or via CLI:
docker compose up -d --force-recreate
```
