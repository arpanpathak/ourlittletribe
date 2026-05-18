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

### 🛠️ The Blueprints (Committed to Git)

- **`secrets.example.yaml`**: 
  A template showing exactly how to declare sensitive configuration values. It acts as a blueprint for `secrets.yaml` (which is git-ignored for safety). It defines keys for:
  - Google OAuth Credentials (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`).
  - PostgreSQL Database Credentials (`POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`).
  - Application Security Tokens (`JWT_SECRET` used to sign authentication cookies).
  
- **`config-template.yaml`**: 
  Defines a `ConfigMap` containing non-sensitive application environment variables. The deployment script copies this file and replaces the `<MAGIC_DOMAIN>` placeholder with the actual LoadBalancer IP domain (e.g. `https://149.248.44.155.nip.io`). This is injected into the Go backend (`PORT`, `FRONTEND_URL`) and the frontend React proxy routing (`VITE_API_BASE_URL`).

- **`gateway-template.yaml`**: 
  The routing backbone of our cluster. It configures the **Kubernetes Gateway API** resources:
  - A `Gateway` that binds to public ports 80 (HTTP) and 443 (HTTPS) with TLS termination configured to use our Let's Encrypt certificates.
  - A `HTTPRoute` for the Frontend that directs all default root paths (`/`) to the React SPA container.
  - A `HTTPRoute` for the Backend that directs all `/v1/*` API endpoints straight to the Go backend container.

- **`certificate-template.yaml`**: 
  An automated SSL provisioning manifest. It defines a `Certificate` custom resource for `cert-manager`, specifying our dynamic magic nip.io domain and requesting a free production-grade Let's Encrypt TLS 1.3 certificate using the HTTP-01 challenge verified directly through our Envoy Gateway listeners.

---

### 🔒 Core Workloads (Committed to Git)

- **`namespace.yaml`**: 
  Declares the `ourlittletribe` namespace to isolate our application resources logically from other tenants. It also applies labels (`environment: production` and `name: ourlittletribe`) which allow monitoring sidecars and network policies to securely select and isolate this space.

- **`database.yaml`**: 
  Handles our stateful persistence layer:
  - A `PersistentVolumeClaim` (PVC) requesting `1Gi` of cloud-managed block storage to ensure database files are preserved across pod upgrades or crash restarts.
  - A `Deployment` running PostgreSQL with resource boundaries, reading credentials securely from `secrets.yaml`, and mounting the PVC volume into `/var/lib/postgresql/data`.
  - A cluster-internal `Service` exposing PostgreSQL privately on port `5432` only to other pods.

- **`backend.yaml`**: 
  Handles the Go REST API application. It defines:
  - A `Deployment` running our high-performance Go binary, complete with readiness/liveness probes and pod environment parameters mapped directly from our `secrets` and `config` manifests. It is annotated for automated Prometheus scraping.
  - A cluster-internal `Service` that binds to port `8080`, naming the port `http` so CoreOS monitoring operators can discover it automatically.

- **`frontend.yaml`**: 
  Handles the React Single Page Application. It configures:
  - A `Deployment` running our React assets served through a highly optimized Nginx alpine container.
  - A cluster-internal `Service` exposing the frontend on port `80`.

- **`network-policy.yaml`**: 
  Our security crown jewel. It declares **Cilium Network Policies** enforcing strict Layer 4 ingress rules to guarantee a Zero-Trust topology:
  - **Database Policy**: Restricts ingress to port 5432 so that *only* pods labeled `app: backend` can reach the Database.
  - **Backend Policy**: Restricts ingress so that *only* the frontend container or Envoy Gateway controller can connect to our HTTP REST API on port 8080.
  - No lateral movement or untrusted ingress is tolerated within the namespace.

- **`gatewayclass.yaml` & `clusterissuer.yaml`**: 
  System-level infrastructure controllers. `gatewayclass.yaml` declares Envoy Gateway (`eg`) as the routing controller engine, and `clusterissuer.yaml` registers Let's Encrypt's production servers with `cert-manager` using the ACME protocol, binding it to the public HTTP listener.

---

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

