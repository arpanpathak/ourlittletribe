# 🎨 OutLittleTribe Frontend

Welcome to the user interface of OutLittleTribe! This is a lightning-fast Single Page Application (SPA) built with **React** and bundled using **Vite**.

## 💅 Design Philosophy

Our frontend is designed to feel highly dynamic, vibrant, and incredibly premium. 
We strictly enforce:
- **Zero bloat:** No massive component libraries. We utilize raw, modern CSS (`index.css`) utilizing CSS Variables (tokens) for absolute control over micro-animations, glassmorphism, and responsive layouts.
- **Rich Aesthetics:** Dark mode optimization, subtle gradients, and Google's `Outfit` typography.
- **Smooth UX:** Instant transitions and gracefully handled loading states.

---

## 📂 File Structure

- **`src/components/`**: Reusable, atomic UI components (Navbars, Modals, Event Cards).
- **`src/pages/`**: Primary viewport containers (HomeFeed, TribesView, ActivitiesView).
- **`src/types.ts`**: Strict TypeScript interfaces reflecting the Go backend's domain models.
- **`src/App.tsx`**: The core application state manager and view router.
- **`Dockerfile`**: A multi-stage build file that compiles the Vite React app and serves it purely through an optimized Nginx web server in production.

---

## 🔌 API Connectivity

In production (Kubernetes), the React app is served by Nginx, but all API calls go through the **Envoy API Gateway**.
Because of this, the `API_BASE` in `App.tsx` is set to an empty string (`""`). 
When a user requests `/v1/users/me`, the browser automatically sends it to the same domain the app is hosted on, and Envoy handles securely routing that specific path back to the Go API.

---

## 🚀 Running Locally for Development

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+)

### Setup
```bash
npm install
```

### Start the Development Server
If you are running the backend locally on `localhost:8080`, you will want to temporarily update `API_BASE` in `src/App.tsx` to `"http://localhost:8080"` during local development so your requests hit the local Go server instead of trying to hit Vite's dev server.

```bash
npm run dev
```
Your app will be live at `http://localhost:5173` with Lightning-Fast Hot Module Replacement (HMR).
