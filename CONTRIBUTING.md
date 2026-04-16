# Building Voiden, together...

Thank you for your interest in helping us improve Voiden! This document provides guidelines and instructions for contributing.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [How to Contribute](#how-to-contribute)
- [Pull Request Process](#pull-request-process)
- [Coding Guidelines](#coding-guidelines)
- [Reporting Bugs](#reporting-bugs)
- [Suggesting Enhancements](#suggesting-enhancements)

## Code of Conduct

This project adheres to a Code of Conduct. By participating, you are expected to uphold this code. Please report unacceptable behavior to conduct@voiden.dev.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR-USERNAME/voiden.git`
3. Add upstream remote: `git remote add upstream https://github.com/VoidenHQ/voiden.git`
4. Create a new branch: `git checkout -b feature/your-feature-name`

## Development Setup

### Prerequisites

- Node.js v22.x or latest LTS version
- Yarn 4 (via Corepack)
- TypeScript knowledge

### Installation

```bash
# Ensure correct node version
nvm use

# Set yarn version
corepack enable
corepack use yarn@4.3.1

# Install dependencies
yarn install
```

### Building

```bash
# Build core extensions
yarn workspace @voiden/core-extensions build
```

### Running the App

```bash
# Start the Electron app (this also starts the UI dev server)
cd apps/electron && yarn start
```

### Troubleshooting

If you encounter issues with dependencies or builds, use the cleanup script:

```bash
# First, provide permission to execute the script
chmod +x ./cleanup.sh

# Then, run:
./cleanup.sh
```

## How to Contribute

### Types of Contributions

We welcome various types of contributions:

- **Bug fixes** - Fix issues in existing code
- **New features** - Add new functionality to the app
- **Documentation** - Improve README, add examples, write guides (see [Voiden Docs Repository](https://github.com/VoidenHQ/docs))
- **Tests** - Add or improve test coverage

### Before You Start

1. Check if an issue already exists for what you want to work on
2. For major changes, open an issue first to discuss your proposal
3. For bug fixes, search existing issues or create a new one
4. Comment on the issue to let others know you're working on it

## Pull Request Process

1. **Update your fork** with the latest changes from upstream:
   ```bash
   git fetch upstream
   git rebase upstream/beta
   ```

2. **Make your changes** following the coding guidelines below

3. **Test your changes**:
   ```bash
   yarn test
   yarn test:ui
   ```

4. **Commit your changes** with clear, descriptive commit messages:
   ```bash
   git commit -m "feat: add new API for custom panels"
   ```

   Follow [Conventional Commits](https://www.conventionalcommits.org/) format:
   - `feat:` - New features
   - `fix:` - Bug fixes
   - `docs:` - Documentation changes
   - `chore:` - Maintenance tasks
   - `refactor:` - Code refactoring
   - `test:` - Adding or updating tests

5. **Push to your fork**:
   ```bash
   git push origin feature/your-feature-name
   ```

6. **Create a Pull Request** from your fork to the main repository

7. **Address review feedback** - Be responsive to comments and requested changes

### Pull Request Guidelines

- Keep PRs focused on a single feature or bug fix
- Include a clear description of what the PR does
- Reference any related issues (e.g., "Fixes #123")
- Update documentation if you're changing APIs
- Add examples if introducing new features
- Ensure all checks pass before requesting review

### Branch Naming

- Features: `feature/[feature-name]`
- Bug Fixes: `bugfix/[bug-name]`

## Coding Guidelines

### TypeScript Style

- Use TypeScript strict mode
- Provide explicit type annotations for public APIs
- Use interfaces for public types
- Document all public APIs with JSDoc comments
- Prefer `const` over `let`, avoid `var`
- Use meaningful variable and function names

### Code Organization

- Keep files focused on a single responsibility
- Export only what's necessary for the public API
- Group related functionality together
- Maintain consistent file structure

### Documentation

- Add JSDoc comments to all public classes, methods, and types
- Include `@example` tags showing usage
- Document parameters with `@param` and return values with `@returns`
- Keep comments up-to-date when changing code

## Reporting Bugs

When reporting bugs, please use our [Bug Report Template](.github/ISSUE_TEMPLATE/bug_report.md) and include:

- **Description** - Clear description of the bug
- **Steps to reproduce** - Minimal steps to reproduce the issue
- **Expected behavior** - What you expected to happen
- **Actual behavior** - What actually happened
- **Environment** - OS, Node.js version, Voiden version
- **Code sample** - Minimal reproducible example
- **Screenshots** - If applicable

## Suggesting Enhancements

For feature requests, please use our [Feature Request Template](.github/ISSUE_TEMPLATE/feature_request.md) and include:

- **Use case** - Describe the problem you're trying to solve
- **Proposed solution** - Your suggested approach
- **Alternatives** - Other solutions you've considered
- **Examples** - Code examples showing how it would work

## Testing

```bash
# Run all tests
yarn test

# Run UI tests
yarn test:ui

# Run UI tests with interactive UI
yarn workspace voiden-ui test:ui
```

## Questions?

If you have questions:

- Check existing [GitHub Issues](https://github.com/VoidenHQ/voiden/issues)
- Read the [documentation](https://docs.voiden.md/docs/getting-started-section/intro)
- Open a new issue with the "question" label

## License

By contributing to this project, you agree that your contributions will be licensed under the Apache License 2.0, the same license as the project.
