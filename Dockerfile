FROM nginx:1.27-alpine

# Copy frontend static assets
COPY src/ /usr/share/nginx/html/

# Generate /usr/share/nginx/html/.env at container startup from runtime Secret env vars.
# GOOGLE_MAPS_API_KEY: Maps JavaScript API key
# DATA_SOURCE:         "alloydb" (via /api backend) or "file" (static /datasets); defaults to file
RUN mkdir -p /usr/share/nginx/html/datasets && \
    chmod -R a+rX /usr/share/nginx/html && \
    printf '#!/bin/sh\nset -e\n{\n  printf "GOOGLE_MAPS_API_KEY=%%s\\\\n" "${GOOGLE_MAPS_API_KEY:-}"\n  printf "DATA_SOURCE=%%s\\\\n" "${DATA_SOURCE:-file}"\n} > /usr/share/nginx/html/.env\nchmod 644 /usr/share/nginx/html/.env\n' \
    > /docker-entrypoint.d/40-generate-env.sh && \
    chmod +x /docker-entrypoint.d/40-generate-env.sh

EXPOSE 80
