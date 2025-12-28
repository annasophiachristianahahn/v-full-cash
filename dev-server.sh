#!/bin/bash
# Development server using compiled JS (not tsx) to fix proxy-chain compatibility
# This script builds the server and runs it with Node.js --watch for auto-restart

set -e

echo "=== Building server with esbuild ==="
npx esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist --sourcemap

echo "=== Starting server with Node.js (proxy-chain compatible) ==="
echo "USE_PROXY=${USE_PROXY:-false}"

# Node 20's --watch flag auto-restarts when dist/index.js changes
# We run esbuild in watch mode in the background to rebuild on source changes
npx esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist --sourcemap --watch &
ESBUILD_PID=$!

# Give esbuild a moment to start
sleep 1

# Run the server with Node.js --watch (restarts when dist/index.js changes)
NODE_ENV=development node --watch dist/index.js &
NODE_PID=$!

# Cleanup on exit
cleanup() {
  echo "Shutting down..."
  kill $ESBUILD_PID 2>/dev/null || true
  kill $NODE_PID 2>/dev/null || true
  exit 0
}

trap cleanup SIGINT SIGTERM

# Wait for either process to exit
wait
