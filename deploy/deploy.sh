#!/usr/bin/env bash
# Builds the release binary here (aarch64; the glibc 2.35 build runs on the Thor's 2.39),
# installs it on the Thor as a user service, and keeps the "ourlittletribe"
# Tailscale node running beside it.
# Usage: deploy/deploy.sh [ssh-host]   (default: thor)
set -euo pipefail
host="${1:-thor}"
cd "$(dirname "$0")/.."

cargo build --release -p tribe-server

ssh "$host" 'mkdir -p .local/bin .config/systemd/user'
scp target/release/ourlittletribe "$host:.local/bin/ourlittletribe.new"
scp deploy/ourlittletribe.service deploy/ourlittletribe-tailscale.service "$host:.config/systemd/user/"

ssh "$host" 'mv .local/bin/ourlittletribe.new .local/bin/ourlittletribe \
  && systemctl --user daemon-reload \
  && systemctl --user enable ourlittletribe ourlittletribe-tailscale \
  && systemctl --user restart ourlittletribe \
  && systemctl --user start ourlittletribe-tailscale \
  && sleep 1 && curl -fsS 127.0.0.1:8090/health && echo'

cat <<NOTE
Deployed. The first time only, sign the "ourlittletribe" node in and publish it:
  ssh $host 'tailscale --socket=\$XDG_RUNTIME_DIR/ourlittletribe-tailscaled.sock up --hostname=ourlittletribe'
  ssh $host 'tailscale --socket=\$XDG_RUNTIME_DIR/ourlittletribe-tailscaled.sock funnel --bg http://127.0.0.1:8090'
NOTE
