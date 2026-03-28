# Contributing to OutLittleTribe

First off, thank you for considering contributing to OutLittleTribe! It's people like you that make this completely open-source, community-driven mission a reality.

There are many ways to contribute, from writing tutorials or blog posts, improving the documentation, submitting bug reports and feature requests, to writing code which can be incorporated into OutLittleTribe itself.

## How Can I Contribute?

### Reporting Bugs
If you find a bug in the source code, you can help us by submitting an issue to our GitHub Repository. Even better, you can submit a Pull Request with a fix.

- Please make sure you provide detailed instructions on how to reproduce the issue.
- Describe the expected behavior compared to the actual behavior.
- Include your operating system and environment details.

### Suggesting Enhancements
Feature requests are always welcome! Since OutLittleTribe is designed to serve a broad range of communities without paywalls, any feature that democratizes community building is highly encouraged.

When suggesting an enhancement:
- Provide a clear and detailed explanation of the feature.
- Explain how it makes the platform more inclusive or easier to use.
- Share any mockups or diagrams if applicable.

### Contributing Code
We accept and encourage pull requests. To keep the project maintainable and coherent:

1. **Fork the repository** and create your branch from `main`.
2. **Set up the local environment:** You can use docker-compose to easily spin up the API and frontend.
3. If you've added code that should be tested, **add tests**.
4. If you've changed APIs, **update the documentation**.
5. Ensure the test suite passes before submitting your PR.
6. Make sure your code adheres to standard styling guidelines (e.g., standard Go or Javascript styles).

#### Pull Request Process
1. Update the README.md with details of changes to the interface, if applicable.
2. We review pull requests comprehensively and will provide constructive feedback.
3. Once approved, a maintainer will merge your PR into the project.

## Development Setup

The easiest way to get started is by running docker-compose in the root of the project:

```bash
docker-compose up -d
```
See the `README.md` for more complete local setup steps.

## Code of Conduct

By participating in this project, you are expected to uphold our [Code of Conduct](CODE_OF_CONDUCT.md). We maintain a strictly inclusive, harassment-free environment for everyone.
