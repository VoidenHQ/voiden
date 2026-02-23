
<br/>

<p align="center">
<a href="https://voiden.md">
<img src="apps/electron/logo-dark.png" width="80"/>
</a>
</p>
<p align="center">
  <a href="https://www.linkedin.com/showcase/voiden/">
    <img src="https://img.shields.io/badge/LinkedIn-0077B5?style=for-the-badge&logo=linkedin&logoColor=white" alt="LinkedIn" width="70">
  </a>
  <a href="https://x.com/VoidenMD">
    <img src="https://img.shields.io/badge/X-000000?style=for-the-badge&logo=x&logoColor=white" alt="X" width="40">
  </a>
  <a href="https://discord.com/invite/XSYCf7JF4F">
    <img src="https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord" width="75">
  </a>
  <a href="https://docs.voiden.md/docs/getting-started-section/intro" rel="nofollow"><img src="https://camo.githubusercontent.com/ae085ed78e2d78de6bf57bf725d555769e12e21bbfbf5ce461d55a567ccbbdfe/68747470733a2f2f696d672e736869656c64732e696f2f62616467652f446f63732d3065613565392e737667" alt="Documentation" data-canonical-src="https://img.shields.io/badge/Docs-0ea5e9.svg" style="max-width: 100%;" ></a>
</p>

**Voiden** is an offline-first API client for developers, Testers and Technical Writers who want their API work to feel like code—not a SaaS dashboard.

Voiden lets you build, test, and link API requests like reusable blocks, comment on JSON or XML, preview responses (even PDFs or videos), and manage environments, themes, and scripts. The best part is that Voiden enables all this without ever needing the cloud. Voiden is your API lab: fast, transparent, versionable, and unapologetically opinionated.

No accounts, no sync, no cloud required.

![Video](apps/electron/public/start.png)

---

### 📦 Download  
**Version 1.1.0 is now available!**

👉 **[Download Voiden ↗️](https://voiden.md/download)**  

The website will automatically detect your operating system and highlight the correct installer for you.
(Windows, macOS Intel/Apple Silicon, and Linux).


>🔧 Looking for the **beta** builds?  [Download beta versions ↗️](https://voiden.md/download#beta)

## Getting Started

### 1. Found a bug?

Head over to the [Issues](https://github.com/voidenhq/feedback/issues) tab and click **"New issue"**. Use the **Bug report** template to give us everything we need to fix it.

### 2. Have a feature idea?

We love hearing about new possibilities. Use the **Feature request** template to tell us what you have in mind.

### 3. Just want to say something?

Open a general issue or leave a note.

### 4. Or join us in office hours every friday!

We host weekly Voiden Office Hours on Discord. It’s meant to be a casual space to hang out and discuss about new  ideas, features, roadmap updates, and answer contributor and user questions.

If you are using Voiden or thinking about contributing, come join the conversation: [https://discord.gg/kxnmsUDe?event=1473246419006656617](https://discord.gg/dsJjScpN3u?event=1473246419006656617)

---

Thanks for sharing your thoughts with us 💜

---

## Quick Start (Local Development)

### Prerequisites

- Node.js v21.x
- Yarn v4.3.1
- **Windows Only**: [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with:
  - "Desktop development with C++" workload
  - MSVC (C++ compiler)
  - Windows SDK

```bash
git clone https://github.com/VoidenHQ/voiden.git
cd voiden
yarn install 
yarn workspace @voiden/core-extensions build
cd apps/electron && yarn start
```
> Note : `yarn install` may fail on Windows due to a non-PTY build issue.
See the troubleshooting guide: [Build Errors (Windows)](/docs/troubleshooting/BUILD_ERRORS.md)

See the [Full Installation Guide](docs/getting-started/FRESH_INSTALL.md) for detailed setup including Windows requirements.

## Documentation

All documentation is in the [docs/](docs/) folder:

| Topic | Description |
|-------|-------------|
| [Getting Started](docs/getting-started/FRESH_INSTALL.md) | Installation and setup |
| [Architecture](docs/architecture/OVERVIEW.md) | System design and structure |
| [Extensions](docs/extensions/HOW_TO_ADD.md) | Build your own extensions |
| [Themes](docs/customization/THEMES.md) | Create custom themes |
| [Troubleshooting](docs/troubleshooting/COMMON_ISSUES.md) | Common issues and solutions |

See the [Documentation Index](docs/INDEX.md) for the complete list.

## Project Structure

```
voiden/
├── apps/
│   ├── electron/          # Electron main process
│   └── ui/                # React renderer
├── core-extensions/       # Built-in extensions
└── docs/                  # Documentation
```

## Contributing

We welcome contributions! Please read:

- [Contributing Guide](CONTRIBUTING.md) - How to contribute
- [Code of Conduct](CODE_OF_CONDUCT.md) - Community guidelines
- [Security Policy](SECURITY.md) - Reporting vulnerabilities

## Milestones

Track our progress and see what's coming next:

### 🎯 Current Sprint
👉 **[View active milestone →](https://github.com/voidenhq/voiden/milestones)**

We organize our work into milestones that group related issues and features. Each milestone includes:
- **Planned features** for the release
- **Bug fixes** in progress
- **Target release date**

---

## License

This project is licensed under the [Apache License 2.0](LICENSE).

## Links

- [Changelog](changelog.md)
- [Documentation](docs/INDEX.md)
- [Report an Issue](https://github.com/VoidenHQ/voiden/issues)
