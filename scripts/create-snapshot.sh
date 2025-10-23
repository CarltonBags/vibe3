#!/bin/bash

# Script to create a Daytona Snapshot with pinned Next.js, Tailwind, and FontAwesome versions

set -e

SNAPSHOT_NAME="nextjs-tailwind-fontawesome-stable"

echo "=========================================="
echo "Creating Daytona Snapshot"
echo "=========================================="
echo ""
echo "Snapshot Name: $SNAPSHOT_NAME"
echo "Node Version: 20 (Alpine)"
echo "Next.js: 14.2.18"
echo "React: 18.3.1"
echo "Tailwind CSS: 3.4.17"
echo "FontAwesome: 6.7.2"
echo ""
echo "=========================================="
echo ""

# Check if Daytona CLI is installed
if ! command -v daytona &> /dev/null; then
    echo "❌ Error: Daytona CLI is not installed."
    echo ""
    echo "Install it with:"
    echo "curl -sf -L https://download.daytona.io/daytona/install.sh | sh"
    exit 1
fi

# Navigate to project root
cd "$(dirname "$0")/.."

echo "📦 Building and pushing snapshot to Daytona..."
echo ""

# Create the snapshot with the Dockerfile
daytona snapshot create "$SNAPSHOT_NAME" \
  --dockerfile ./sandbox-templates/Dockerfile \
  --cpu 2 \
  --memory 4 \
  --disk 10

echo ""
echo "✅ Snapshot '$SNAPSHOT_NAME' created successfully!"
echo ""
echo "=========================================="
echo "Next Steps:"
echo "=========================================="
echo ""
echo "1. Verify the snapshot in Daytona dashboard"
echo "2. The API route will automatically use this snapshot"
echo ""
echo "Snapshot Details:"
echo "  - CPU: 2 vCPUs"
echo "  - Memory: 4 GB"
echo "  - Disk: 10 GB"
echo ""
echo "To rebuild this snapshot with updates:"
echo "  ./scripts/create-snapshot.sh"
echo ""
