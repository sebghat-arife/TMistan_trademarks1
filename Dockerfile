# ─────────────────────────────────────────────────────────────────────────────
# TMistan — OPTIONAL container image (the primary deployment is a Render
# Static Site — see render.yaml). Use this for Railway/Fly/any Docker host.
#
#   Stage 1 (build)  Node 20: compile the Vite/React SPA.
#   Stage 2 (run)    nginx (unprivileged): serve /web/dist with SPA fallback,
#                    /healthz endpoint, listens on $PORT (Railway/Render).
#
# The browser talks to Supabase directly (publishable key + Row Level
# Security). There is no application server, so no service-role key is ever
# present in this image. Importers (Python) are NOT part of the image — they
# are operator tools run from a trusted machine.
#
# Public build-time settings (baked into the JS bundle — they are public by
# design):  SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SITE_* (optional)
# ─────────────────────────────────────────────────────────────────────────────

FROM node:20-alpine AS build
WORKDIR /app/web

# Install dependencies first so they are cached between source changes.
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY web/ ./

ARG SUPABASE_URL
ARG SUPABASE_PUBLISHABLE_KEY
ARG SITE_CONTACT_EMAIL
ARG SITE_CONTACT_PHONE
ARG SITE_CONTACT_ADDRESS
ARG SITE_FACEBOOK_URL
ARG SITE_TWITTER_URL
ARG SITE_LINKEDIN_URL
ENV SUPABASE_URL=$SUPABASE_URL \
    SUPABASE_PUBLISHABLE_KEY=$SUPABASE_PUBLISHABLE_KEY \
    SITE_CONTACT_EMAIL=$SITE_CONTACT_EMAIL \
    SITE_CONTACT_PHONE=$SITE_CONTACT_PHONE \
    SITE_CONTACT_ADDRESS=$SITE_CONTACT_ADDRESS \
    SITE_FACEBOOK_URL=$SITE_FACEBOOK_URL \
    SITE_TWITTER_URL=$SITE_TWITTER_URL \
    SITE_LINKEDIN_URL=$SITE_LINKEDIN_URL

# Fail fast with a clear message instead of shipping an unconfigured bundle.
RUN test -n "$SUPABASE_URL" && test -n "$SUPABASE_PUBLISHABLE_KEY" \
 || { echo >&2 "ERROR: SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY build args are required"; exit 1; }
RUN case "$SUPABASE_PUBLISHABLE_KEY" in sb_secret_*) echo >&2 "ERROR: a SECRET key was passed as the publishable key"; exit 1;; esac
RUN npm run build

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime

# nginx config is a template so the listen port follows $PORT at start-up.
COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/web/dist /usr/share/nginx/html

ENV PORT=8080
EXPOSE 8080
# The image's entrypoint renders /etc/nginx/templates/*.template with envsubst
# (only $PORT is substituted — see NGINX_ENVSUBST_FILTER) and then runs nginx.
ENV NGINX_ENVSUBST_FILTER=^PORT$
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" >/dev/null || exit 1
