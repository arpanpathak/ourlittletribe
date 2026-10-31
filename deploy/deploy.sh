#!/usr/bin/env bash
# Builds the release binary here (aarch64; the glibc 2.35 build runs on the Thor's 2.39)
# and installs it on the Thor as a user service next to the Tigress Cub.
# Usage: deploy/deploy.sh [ssh-host]   (default: thor)
set -euo pipefail
host="${1:-thor}"
cd "$(dirname "$0")/.."
cargo build --release -p tribe-server
ssh "$host" 'mkdir -p .local/bin .config/systemd/user'
scp target/release/ourlittletribe "$host:.local/bin/ourlittletribe.new"
scp deploy/ourlittletribe.service "$host:.config/systemd/user/ourlittletribe.service"
ssh "$host" 'mv .local/bin/ourlittletribe.new .local/bin/ourlittletribe \
  && systemctl --user daemon-reload \
  && systemctl --user enable ourlittletribe \
  && systemctl --user restart ourlittletribe \
  && sleep 1 && curl -fsS 127.0.0.1:8090/health && echo'
echo "Publish once with: ssh $host 'sudo tailscale funnel --bg --https=8443 http://127.0.0.1:8090'"
