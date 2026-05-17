# ☸️ Kubernetes Infrastructure & Gateway API

Welcome to the infrastructure core of **OutLittleTribe**. This directory contains all the Kubernetes manifests required to deploy a production-grade, highly secure, and highly available instance of the application.

## 🏗 Architecture Highlight

We utilize a modern stack to ensure peak performance and zero-trust security:
- **Gateway API (Envoy):** Replaces the legacy Nginx Ingress. Envoy Gateway handles our Layer 7 routing, dynamic LoadBalancer IP allocation, and strictly terminates TLS.
- **Cert-Manager:** Automatically provisions and renews free `Let's Encrypt` SSL/TLS 1.3 certificates via HTTP-01 challenges.
- **Cilium eBPF:** Enforces a strict, default-deny network policy. Lateral movement within the cluster is restricted (e.g. the Frontend cannot talk directly to the Database).

---

## 📂 File Structure & Templating

To prevent fragile configurations and dirty Git histories, we use a **Templating System**. The `deploy.sh` script in the root directory takes these templates, safely injects your dynamic LoadBalancer IP / Domain, and applies them to the cluster.

### 🛠 The Blueprints (Committed to Git)
- **`config-template.yaml`**: Non-sensitive environment variables (e.g. frontend URLs).
- **`gateway-template.yaml`**: The Envoy Gateway listeners (Port 80/443) and HTTPRoutes mapping `/v1/*` to the backend.
- **`certificate-template.yaml`**: The Let's Encrypt TLS certificate request.
- **`secrets.example.yaml`**: A dummy file showing exactly what secrets you need to provide.

### 🔒 Core Workloads (Committed to Git)
- **`namespace.yaml`**: Creates the `ourlittletribe` isolated namespace.
- **`database.yaml`**: Stateful PostgreSQL deployment & persistent volume.
- **`backend.yaml`**: The Go REST API deployment.
- **`frontend.yaml`**: The React/Nginx SPA deployment.
- **`network-policy.yaml`**: Cilium Zero-Trust rules.
- **`gatewayclass.yaml` & `clusterissuer.yaml`**: Configuration for Envoy and Cert-Manager.

### 👻 Generated Files (Ignored by Git)
When you run `./deploy.sh`, the following files are dynamically generated locally and applied to the cluster. They are safely ignored by `.gitignore`:
- `config.yaml`
- `secrets.yaml`
- `gateway.yaml`
- `certificate.yaml`

---

## 🚀 How to Deploy

1. **Prepare Secrets:**
   ```bash
   cp secrets.example.yaml secrets.yaml
   ```
   Open `secrets.yaml` and fill in your actual Google OAuth tokens, secure database password, and a long random JWT secret string.

2. **Run the Root Deployment Script:**
   Navigate back to the root directory and run the deployment automation:
   ```bash
   cd ..
   ./deploy.sh
   ```
   *The script will handle building Docker images, applying the manifests, provisioning the LoadBalancer IP, generating the domain, and configuring TLS automatically.*
