FROM node:20-alpine

# Install system dependencies
RUN apk add --no-cache \
    git \
    python3 \
    make \
    g++

# Set working directory
WORKDIR /workspace

# Copy package template with pinned versions
COPY package.json /tmp/package.json

# Pre-install dependencies globally for faster sandbox creation
RUN cd /tmp && npm install && \
    npm cache clean --force

# Set npm to use the pre-installed modules
ENV NODE_PATH=/tmp/node_modules
ENV PATH=/tmp/node_modules/.bin:$PATH

# Expose Next.js dev server port
EXPOSE 3000

CMD ["/bin/sh"]
