FROM nginx:1.27-alpine

# Copy frontend static assets
COPY src/ /usr/share/nginx/html/

# Generate /usr/share/nginx/html/.env at container startup from runtime Secret env vars
RUN mkdir -p /usr/share/nginx/html/datasets && \
    chmod -R a+rX /usr/share/nginx/html && \
    printf '#!/bin/sh\nset -e\nprintf "GOOGLE_MAPS_API_KEY=%%s\\n" "${GOOGLE_MAPS_API_KEY:-}" > /usr/share/nginx/html/.env\nchmod 644 /usr/share/nginx/html/.env\n' \
    > /docker-entrypoint.d/40-generate-env.sh && \
    chmod +x /docker-entrypoint.d/40-generate-env.sh

EXPOSE 80
