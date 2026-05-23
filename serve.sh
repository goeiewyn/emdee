#!/usr/bin/env bash
# emdee dev server — run once from the project folder
# Usage: bash serve.sh
cd "$(dirname "$0")"

# Free port 8000 if something is already holding it
lsof -ti tcp:8000 | xargs kill -9 2>/dev/null

echo "emdee running at http://localhost:8000"
python3 -m http.server 8000
