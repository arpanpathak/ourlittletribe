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

### 📊 Observability & Monitoring Blueprints (Committed to Git)
- **`monitoring-backend.yaml`**: CoreOS `ServiceMonitor` that looks for services in `ourlittletribe` namespace with label `app: backend` and scrapes their `/metrics` on port `http`.
- **`monitoring-envoy.yaml`**: CoreOS `PodMonitor` that scrapes Envoy Gateway proxy endpoints on port `19001` (`/stats/prometheus`) for traffic throughput and error rates.
- **`grafana-dashboard.json`**: Pre-configured JSON dashboard containing high-fidelity panels for Request Rates, 5xx Error Rates, and P50/P90/P99 latency distribution.

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
   *The script will handle building Docker images, applying the manifests, deploying the Prometheus/Grafana stack, setting up the custom dashboards, provisioning the LoadBalancer IP, generating the domain, and configuring TLS automatically.*

---

## 📊 Observability & Monitoring Stack

The cluster deploys a full production-grade observability stack running in the `monitoring` namespace using **Prometheus Operator** and **Grafana**. 

### 1. How Metrics Scraping Works
* **Go Backend API**: The Go backend is instrumented with the Prometheus client. Our `monitoring-backend.yaml` service monitor discovers the backend pods, and scrapes `/metrics` every 30 seconds.
* **Envoy API Gateway**: The `monitoring-envoy.yaml` pod monitor discovers the Envoy proxy pods running in `envoy-gateway-system` namespace, scraping internal Envoy network statistics.

### 2. Automatic Grafana Dashboard Provisioning
We do not configure dashboards manually via the Grafana UI. 
- The deployment script creates a Kubernetes `ConfigMap` called `ourlittletribe-grafana-dashboard` in the `monitoring` namespace holding the payload of `grafana-dashboard.json`.
- The ConfigMap is labeled with `grafana_dashboard: "1"` and annotated with `grafana_folder: OutLittleTribe`.
- The `k8s-sidecar` helper container running in the Grafana pod watches the Kubernetes API for labeled ConfigMaps, downloads `grafana-dashboard.json` directly into Grafana's local shared directory, and triggers a hot-reload of Grafana's dashboards configuration.
- The dashboard is automatically placed under the **OutLittleTribe** folder!

### 3. Accessing the Grafana Dashboards
To view live metrics (Request Latency, HTTP 5xx errors, Node CPU/RAM):
1. **Port-forward the Grafana service to your local machine**:
   ```bash
   kubectl port-forward -n monitoring svc/kube-prometheus-stack-grafana 3000:80
   ```
2. **Open your browser** to `http://localhost:3000`
3. **Log in** with the following credentials:
   - **Username**: `admin`
   - **Password**: `admin`
4. **Locate your dashboard**: Go to **Dashboards** -> **Folders** -> **OutLittleTribe** -> **OutLittleTribe — Go Backend API**.

