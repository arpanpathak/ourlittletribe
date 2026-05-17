#!/bin/bash
# -----------------------------------------------------------------------------
# Our Little Tribe - Streamlined Kubernetes Deployment Script
# -----------------------------------------------------------------------------
# This script automates the deployment of the entire Our Little Tribe stack,
# including the Envoy Gateway API, Cert-Manager TLS, and Cilium Networking.
# -----------------------------------------------------------------------------

set -e # Exit immediately if a command exits with a non-zero status

echo "🚀 Starting streamlined deployment process for Our Little Tribe..."

# Check for secrets
if [ ! -f "k8s/secrets.yaml" ]; then
    echo "⚠️  k8s/secrets.yaml not found!"
    echo "Please run: cp k8s/secrets.example.yaml k8s/secrets.yaml"
    echo "Then fill in your production secrets (Google OAuth, DB, JWT) before running this script."
    exit 1
fi

# ==========================================
# Phase 1: Build & Push Images
# ==========================================
echo "📦 Building and Pushing Docker images..."
cd backend && docker build -t arpanpathak/ourlittletribe-backend:latest . && docker push arpanpathak/ourlittletribe-backend:latest && cd ..
cd frontend && docker build -t arpanpathak/ourlittletribe-frontend:latest . && docker push arpanpathak/ourlittletribe-frontend:latest && cd ..

# ==========================================
# Phase 2: Core Infrastructure
# ==========================================
echo "☸️ Applying core infrastructure..."
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/secrets.yaml
kubectl apply -f k8s/database.yaml
kubectl apply -f k8s/backend.yaml
kubectl apply -f k8s/frontend.yaml
kubectl apply -f k8s/network-policy.yaml

# ==========================================
# Phase 3: Gateway API & Cert-Manager
# ==========================================
echo "📦 Installing Gateway API and Envoy Gateway (if not exists)..."
kubectl apply -f https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.0.0/standard-install.yaml
kubectl apply --server-side -f https://github.com/envoyproxy/gateway/releases/download/v1.0.1/install.yaml

# Ensure GatewayClass is applied
kubectl apply -f k8s/gatewayclass.yaml
kubectl apply -f k8s/clusterissuer.yaml

# Deploy a temporary HTTP-only Gateway to get the LoadBalancer IP
echo "apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: outlittletribe-gateway
  namespace: ourlittletribe
spec:
  gatewayClassName: eg
  listeners:
  - name: http
    protocol: HTTP
    port: 80" | kubectl apply -f -

echo "⏳ Waiting for Envoy Gateway to provision a LoadBalancer IP (can take a few minutes)..."
GATEWAY_IP=""
while [ -z "$GATEWAY_IP" ] || [ "$GATEWAY_IP" == "<pending>" ]; do
    sleep 5
    GATEWAY_IP=$(kubectl get gateway outlittletribe-gateway -n ourlittletribe -o jsonpath='{.status.addresses[0].value}' 2>/dev/null || true)
done

echo "✅ Gateway IP acquired: $GATEWAY_IP"
MAGIC_DOMAIN="${GATEWAY_IP}.nip.io"

echo "📜 Injecting magic domain ($MAGIC_DOMAIN) into templates..."

# Use python to perform safe string replacement on the templates
python3 -c "
import sys
domain = sys.argv[1]

for f in ['config', 'gateway', 'certificate', 'secrets']:
    template_path = f'k8s/{f}-template.yaml' if f != 'secrets' else 'k8s/secrets.yaml'
    out_path = f'k8s/{f}.yaml'
    
    with open(template_path, 'r') as file:
        content = file.read()
    
    # Replace the placeholder
    content = content.replace('<MAGIC_DOMAIN>', domain)
    
    with open(out_path, 'w') as file:
        file.write(content)
" "$MAGIC_DOMAIN"

# ==========================================
# Phase 4: Finalize Configurations & TLS
# ==========================================
echo "☸️ Applying finalized domain configurations and Requesting Let's Encrypt TLS Certificate..."
kubectl apply -f k8s/config.yaml
kubectl apply -f k8s/secrets.yaml
kubectl apply -f k8s/gateway.yaml
kubectl apply -f k8s/certificate.yaml

echo "🔄 Restarting pods to pick up new configurations..."
kubectl rollout restart deployment backend-deployment -n ourlittletribe
kubectl rollout restart deployment frontend-deployment -n ourlittletribe

echo "🎉 DEPLOYMENT COMPLETE!"
echo "Your app is securely accessible at: https://$MAGIC_DOMAIN"
echo "Note: It may take 1-2 minutes for the Let's Encrypt TLS certificate to finish issuing."
