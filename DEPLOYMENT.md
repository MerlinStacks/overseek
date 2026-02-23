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

## Automated CI/CD (Recommended)

Pushes to `main` trigger GitHub Actions to build only the changed service image(s) and push them to GitHub Container Registry (GHCR). Portainer picks up the new images automatically.

### How It Works

1. **Push to `main`** → GitHub Actions detects changed paths (`server/` vs `client/`)
2. **Build** → Only the affected image is built and pushed to GHCR
3. **Deploy** → Portainer GitOps detects the change and pulls the new image
4. **Zero downtime** → Health checks gate the rollover; `shutdown.ts` drains in-flight requests

### First-Time Setup

1. **GitHub**: No extra secrets needed — the workflow uses the built-in `GITHUB_TOKEN` for GHCR.

2. **Portainer**: Configure your stack for GitOps auto-updates:
   - Go to **Stacks → overseekv2 → Editor**
   - Enable **"GitOps updates"** pointing to `main` branch
   - Set polling interval (e.g., 5 minutes)
   - Enable **"Re-pull images"** so Portainer pulls new GHCR images

3. **Initial image bootstrap** (one-time):
   - Temporarily **pause** Portainer GitOps polling
   - Push the workflow to `main` and wait for GitHub Actions to finish (~5 min)
   - Verify images exist: `docker pull ghcr.io/merlinstacks/overseek-api:latest`
   - **Resume** Portainer GitOps polling

### Optional: Instant Deploys via Webhooks

Instead of waiting for Portainer polling, you can trigger instant redeploys:

1. In Portainer, enable webhooks for `api` and `web` services
2. Add the webhook URLs as **GitHub Repository Variables** (Settings → Secrets → Actions → Variables):
   - `PORTAINER_WEBHOOK_API`
   - `PORTAINER_WEBHOOK_WEB`
3. The workflow will ping them after pushing images

---

## Local Development

The `docker-compose.override.yml` file (gitignored) restores `build:` directives for local builds:

```bash
# Local: builds from source (override file adds build: directives)
docker compose build
docker compose up -d

# Production server: pulls from GHCR (no override file present)
docker compose pull
docker compose up -d
```

> **Note:** The override file should exist on developer machines but **not** on the production server.

---

## Health Endpoints

- `/health` — Basic check
- `/health/ready` — Full dependency check (DB, Redis, ES)
- `/health/live` — Simple liveness ping

Docker health checks are configured in `docker-compose.yml`:
- API: 180s startup, checks `/health/live` every 15s
- Web: 30s startup, checks port 80 every 15s

---

## Manual Deployment

### Per-Service Update (via GHCR)
```bash
# On the server — pull and restart only one service
docker compose pull api
docker compose up -d --no-deps api

# Or for the web client:
docker compose pull web
docker compose up -d --no-deps web
```

### Force Rebuild via GitHub Actions
Use the **workflow_dispatch** trigger in GitHub:
1. Go to **Actions → Build & Deploy → Run workflow**
2. Select `api`, `web`, or `both`

### Full Stack Update (Portainer)
1. Go to **Stacks → overseekv2**
2. Click **Editor** tab
3. Click **"Update the stack"**
4. Enable **"Re-pull image and redeploy"**
5. Click **"Update"**

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
# Or via CLI — roll back to previous image by SHA:
docker compose pull   # pulls latest (which may be broken)
# Instead, use a specific known-good SHA:
# docker pull ghcr.io/merlinstacks/overseek-api:<good-commit-sha>
# docker compose up -d --no-deps api

# Or force recreate with current images:
docker compose up -d --force-recreate
```

