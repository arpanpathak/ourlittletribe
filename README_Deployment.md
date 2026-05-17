# Our Little Tribe - Kubernetes Deployment Guide

This document outlines the complete procedure for deploying the **Our Little Tribe** application into a production-grade Kubernetes cluster using modern Gateway API architecture.

## 🏗 Architecture Overview

The deployment provisions the following resources inside the `ourlittletribe` Kubernetes namespace:
1. **Frontend**: React (Vite) Single Page Application served via an Nginx container.
2. **Backend**: Go API server operating internally on port `8080`.
3. **Database**: Stateful PostgreSQL instance with a `1Gi` PersistentVolumeClaim (PVC) to ensure data persistence across pod restarts.
4. **API Gateway (Envoy)**: We utilize the modern **Kubernetes Gateway API** via **Envoy Gateway**. It manages routing, TLS termination, and traffic splitting between the frontend (`/`) and backend (`/v1/*`).
5. **Security (Cilium)**: Zero-Trust network policies restrict lateral movement (e.g., only the Backend can talk to the Database).

---

## 🔒 Security Configuration

- **Namespaces**: All resources are logically isolated in the `ourlittletribe` namespace.
- **TLS 1.3 / Cert-Manager**: Automated Let's Encrypt certificate generation using the HTTP-01 challenge directly through the Envoy Gateway HTTPRoute. The gateway strictly terminates TLS.
- **Secrets Management**: Sensitive data such as Google OAuth tokens, PostgreSQL passwords, and JWT secrets are managed via Kubernetes `Secret` resources and are **excluded** from version control.
- **Network Policies**: Cilium Layer 4/Layer 7 policies ensure a default-deny posture inside the namespace, explicitly allowing only necessary communication paths.

---

## 🚀 Deployment Process

### Prerequisites

Before deploying, ensure you have the following installed and configured:
- `docker` (authenticated to Docker Hub via `docker login`)
- `kubectl` (configured with your target cluster's context)
- A Kubernetes cluster with **Cilium** installed (for network policies).
- `cert-manager` installed in your cluster (for TLS certificates).

### 1-Click Deployment

We have automated the build and deployment process into a single, idempotent script.

**Step 1: Configure your secrets**
Because we don't commit secrets to git, you must create them first:
```bash
cp k8s/secrets.example.yaml k8s/secrets.yaml
```
Edit `k8s/secrets.yaml` to include your actual Google OAuth credentials, secure passwords, and JWT keys. 

**Step 2: Run the Deployment Script**
```bash
chmod +x deploy.sh
./deploy.sh
```

**What this script does:**
1. Builds the backend/frontend Docker images and pushes them to `arpanpathak/ourlittletribe-*`.
2. Applies the base infrastructure (Database, Backend, Frontend, and Network Policies).
3. Installs Gateway API CRDs and Envoy Gateway (if not already present).
4. Creates a temporary HTTP Gateway to provision a cloud LoadBalancer IP.
5. Acquires the IP, dynamically maps it to a `<IP>.nip.io` domain, and injects it into all YAML templates safely.
6. Deploys the finalized Gateway, HTTPRoutes, and Let's Encrypt Certificate.
7. Restarts the pods to pick up the new domain and configurations.

---

## 🛠 Kubernetes Manifests Breakdown

We use a template system to keep our codebase completely clean while dynamically generating environment-specific resources:

- `namespace.yaml`: Creates the isolated environment.
- `database.yaml`, `backend.yaml`, `frontend.yaml`: Core application workloads.
- `network-policy.yaml`: Enforces Cilium network segmentation rules.
- `gatewayclass.yaml`: Specifies the Envoy Gateway class.
- `clusterissuer.yaml`: Configures cert-manager to use Let's Encrypt production servers via Gateway API routing.
- **Templates**: `config-template.yaml`, `gateway-template.yaml`, `certificate-template.yaml`, and `secrets.example.yaml` serve as the blueprints. The deployment script copies these, injects the dynamic nip.io domain, and applies them (the generated files are ignored by `.gitignore`).

---

## 🚑 Troubleshooting

- **503 Service Unavailable / Connection Timeout**: If Envoy Gateway returns a 503, it means it cannot reach the backend/frontend pods. This is usually caused by an issue in the pod (check `kubectl get pods -n ourlittletribe`) or a Cilium network policy blocking traffic. Ensure you haven't altered labels without updating `network-policy.yaml`.
- **Browser Not Secure (HTTPS)**: Cert-manager takes about 1-2 minutes to issue a Let's Encrypt certificate after a new LoadBalancer IP is provisioned. If the browser says "Not Private", just wait a moment and refresh.
- **Google Auth Redirect Mismatch**: If you change clusters and get a new LoadBalancer IP, the nip.io domain changes. You **must** update your Authorized Redirect URIs in the Google Cloud Console to match the new URL output by the deployment script.
