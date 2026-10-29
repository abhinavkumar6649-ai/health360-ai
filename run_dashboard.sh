#!/bin/bash
# Health360 Interactive Dashboard Launcher
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
echo "Starting Health360 Clinical Intelligence Dashboard..."
echo "Serving at http://localhost:3000"
echo "Press Ctrl+C to stop the server."

# Open browser automatically on macOS
(sleep 1 && open "http://localhost:3000") &
python3 -m http.server 3000 --directory "$DIR"
