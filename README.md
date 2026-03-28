<div align="center">
  <h1>🌍 OutLittleTribe (FindMyTribes)</h1>
  <p><strong>A fiercely independent, open-source, and cloud-agnostic community platform.</strong></p>

  <!-- Navigation Tabs -->
  <p>
    <a href="#-mission"><b>🎯 Mission</b></a> &nbsp;&bull;&nbsp;
    <a href="#-features"><b>✨ Features</b></a> &nbsp;&bull;&nbsp;
    <a href="#-architecture"><b>🏗️ Architecture</b></a> &nbsp;&bull;&nbsp;
    <a href="#-getting-started"><b>🚀 Quick Start</b></a> &nbsp;&bull;&nbsp;
    <a href="CONTRIBUTING.md"><b>🤝 Contributing</b></a> &nbsp;&bull;&nbsp;
    <a href="CODE_OF_CONDUCT.md"><b>🛡️ Code of Conduct</b></a>
  </p>

  <p>
    <img src="https://img.shields.io/github/stars/arpanpathak/ourlittletribe?style=for-the-badge&color=yellow" alt="Stars"/>
    <img src="https://img.shields.io/github/forks/arpanpathak/ourlittletribe?style=for-the-badge&color=blue" alt="Forks"/>
    <img src="https://img.shields.io/github/issues/arpanpathak/ourlittletribe?style=for-the-badge&color=red" alt="Issues"/>
    <img src="https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge" alt="License"/>
  </p>
</div>

---

## 🎯 Mission

We believe that community building should be a **fundamental human right**, not a monetized feature gated behind corporate paywalls. Our mission is to democratize community organization by providing a fully open-source, self-hostable platform. We empower individuals, local groups, and organizations to connect, share, and grow together without arbitrary fees, algorithms prioritizing profit over people, or restrictive corporate roadblocks.

<details>
<summary><b>Read more about our vision (Click to Expand)</b></summary>
<br>
OutLittleTribe is an inclusive, community-driven alternative to mainstream event-planning applications (like Meetup.com). We strive to create a safe, welcoming, and accessible space for absolutely everyone. Our overarching vision is to deliver a **bloat-free, clean, fast, and efficient UI** along with a uniquely superior and easy-to-use UX. Our goal is a decentralized, cloud-agnostic social fabric where you completely own your community's data.

The project is built deliberately for safety, accessibility, and positive social impact.
</details>

## ✨ Features

- ⚡ **Superior User Experience:** Designed to be a bloat-free, clean, blazingly fast, and highly efficient interface. We prioritize an intuitive and exceptionally easy-to-use UX above all else.
- 🚫 **No Corporate Paywalls:** 100% free and open-source forever. No hidden fees to organize or join events.
- ☁️ **Cloud-Agnostic Setup:** Run your instance anywhere. Whether using Docker on your local machine or deploying to your own cloud infrastructure, the platform is extremely portable.
- 🏕️ **Tribe Management:** Seamlessly create, manage, and discover "Tribes" matching your interests, complete with custom avatars and cover photos.
- 📅 **Event Management:** Robust event creation, RSVP handling, detailed location/time management, and MVC backend architecture.
- 🛡️ **Inclusive Community First:** Standardized codes of conduct, modern UI, and community-first workflows.

<details>
<summary><b>View the Technical Capabilities (Click to Expand)</b></summary>

- Advanced REST APIs built on Go with a clean modular MVC design.
- Secure HTTP/2 routing, decoupled database layer.
- OAuth2 implementations ready for integration.
- Responsive, rich-aesthetic frontend stack.

</details>

## 🏗️ Architecture

OutLittleTribe strictly isolates concerns into layers following an **MVC Model**:

1. **Routing Layer**: Expressive, grouped RESTful endpoints.
2. **Controller Layer**: Inbound request validation and parsing.
3. **Service Layer**: Pure business logic separated from HTTP details.
4. **Data Layer**: Clean database repositories ensuring high portability across persistence layers (PostgreSQL / SQLite).

---

## 🚀 Getting Started

OutLittleTribe consists of a decoupled architecture with a dedicated backend API and a modern frontend interface. It is fully containerized to make deployments feel like magic.

### Prerequisites
- [Docker](https://www.docker.com/) & Docker Compose
- [Go 1.22+](https://go.dev/) (for backend development)
- [Node.js](https://nodejs.org/) (for frontend development)

### Quick Start (Docker)

The fastest way to get the entire ecosystem up and running:

```bash
git clone https://github.com/arpanpathak/ourlittletribe.git
cd ourlittletribe

# Fire up the entire stack, including the backend, frontend, and DB securely
docker-compose up -d
```
The API and frontend will automatically orchestrate and bind to your local environment.

---

## 🤝 Contributing

We are profoundly grateful for our community of contributors! Whether you're fixing a bug, writing documentation, or proposing entirely new features, your help is what makes OutLittleTribe thrive.

Please deeply review our [Contributing Guidelines](CONTRIBUTING.md) to get started on local development, architectural conventions, and PR expectations.

## 🛡️ Community Standards

By participating in this project, you are expected to uphold our [Code of Conduct](CODE_OF_CONDUCT.md). We maintain a strictly inclusive, harassment-free environment for everyone.

## 📜 License

This project is licensed under the [MIT License](LICENSE). You are completely free to use, modify, distribute, and self-host the software.
