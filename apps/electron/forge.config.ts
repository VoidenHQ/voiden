import { ForgeConfig } from "@electron-forge/shared-types";
import { MakerZIP } from "@electron-forge/maker-zip";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import { getAppUpdateYml } from "electron-updater-yaml";
import dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { execSync } from "child_process";

dotenv.config({ path: "../../.env" });

const isMac = process.platform === "darwin";
const isWindows = process.platform === "win32";
const isLinux = process.platform === "linux";

// Read package.json to detect if this is a beta or stable build
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf-8"));
const version = packageJson.version;
const isBetaBuild = version.includes("beta") || version.includes("alpha") || version.includes("rc");

// Helper function to calculate SHA512 hash of a file
function calculateSha512(filePath: string): string {
  const fileBuffer = fs.readFileSync(filePath);
  const hash = crypto.createHash("sha512");
  hash.update(fileBuffer);
  return hash.digest("base64");
}

// Helper function to generate latest-mac.yml or latest.yml for electron-updater
function generateUpdateYml(artifactPath: string, version: string, platform: "darwin" | "win32", _arch: string): string {
  const fileName = path.basename(artifactPath);
  const fileSize = fs.statSync(artifactPath).size;
  const sha512 = calculateSha512(artifactPath);
  const releaseDate = new Date().toISOString();

  if (platform === "darwin") {
    return `version: ${version}
files:
  - url: ${fileName}
    sha512: ${sha512}
    size: ${fileSize}
path: ${fileName}
sha512: ${sha512}
releaseDate: '${releaseDate}'
`;
  } else {
    // Windows
    return `version: ${version}
files:
  - url: ${fileName}
    sha512: ${sha512}
    size: ${fileSize}
path: ${fileName}
sha512: ${sha512}
releaseDate: '${releaseDate}'
`;
  }
}

// Detect release channel (beta or stable)
// Priority: 1) RELEASE_CHANNEL env var, 2) version number detection, 3) default to stable
const releaseChannel = process.env.RELEASE_CHANNEL || (isBetaBuild ? "beta" : "stable");
const s3BucketName = releaseChannel === "beta"
  ? process.env.S3_BUCKET_NAME_BETA || "voiden-beta-releases"
  : process.env.S3_BUCKET_NAME_STABLE || "voiden-releases";
const s3Region = process.env.S3_REGION || "eu-west-1";

const makers = [];

if (isMac) {
  // macUpdateManifestBaseUrl must match the channel this build is being published to
  // For beta builds (version contains "beta"), use beta channel
  // For stable builds, use stable channel
  makers.push(
    new MakerZIP((arch) => ({
      macUpdateManifestBaseUrl: `https://voiden.md/api/download/${releaseChannel}/darwin/${arch}`,
    })),
    new MakerDMG((arch) => ({
      name: "Voiden",
      icon: "./src/images/icon.png",
      format: "ULFO",
      background: "./src/images/background-dmg.png",
      overwrite: true,
      contents: [
        {
          x: 150,
          y: 200,
          type: "file",
          path: `${process.cwd()}/out/Voiden-darwin-${arch}/Voiden.app`,
        },
        { x: 450, y: 200, type: "link", path: "/Applications" },
      ],
    }))
  );
} else if (isWindows) {
  makers.push({
    name: "@felixrieseberg/electron-forge-maker-nsis",
    config: {
      // Code signing is handled by sign.js (referenced in package.json build.win.sign)
      // updater config removed: it generated a latest.yml with pre-signing hash that
      // conflicted with the postMake hook's latest.yml (computed after signing).
      // app-update.yml is now generated in packageAfterCopy for Windows.

      // Register file associations via app-builder-lib so "Open with Voiden"
      // appears in Windows Explorer for .void and common text/code files.
      getAppBuilderConfig: async () => ({
        fileAssociations: [
          {
            ext: "void",
            name: "Voiden Document",
            description: "Voiden Document",
            role: "Editor",
          },
          {
            ext: ["txt", "md", "markdown", "json", "yaml", "yml", "xml", "html", "htm", "css"],
            name: "Text File",
            role: "Editor",
          },
          {
            ext: [
              "js", "ts", "jsx", "tsx", "py", "rb", "go", "rs", "java",
              "c", "cpp", "h", "hpp", "cs", "php", "sh", "env", "toml",
              "ini", "cfg", "conf", "log", "csv", "sql", "graphql", "gql",
              "proto", "tf", "swift", "kt", "dart",
            ],
            name: "Source Code",
            role: "Editor",
          },
        ],
      }),
    },
  });
} else if (isLinux) {
  makers.push(
    new MakerDeb({
      options: {
        bin: "Voiden",
        name: "voiden",
        productName: "Voiden",
        icon: "./src/images/icon.png",
        maintainer: "Voiden By ApyHub <info@voiden.md>", // Required for .deb
        homepage: "https://voiden.md",
        mimeType: [
          "x-scheme-handler/voiden",
          "application/x-void",
          "text/plain",
          "text/x-source-code",
          "application/json",
          "application/xml",
          "text/xml",
          "text/html",
          "text/css",
          "text/javascript",
          "text/x-python",
          "text/x-ruby",
          "text/x-go",
          "text/x-rust",
          "text/x-java",
          "text/x-csrc",
          "text/x-c++src",
          "text/x-shellscript",
          "text/markdown",
          "text/x-yaml",
          "application/x-yaml",
          "application/yaml",
          "text/csv",
          "text/x-sql",
        ],
      },
    }),
    new MakerRpm({
      options: {
        bin: 'Voiden',
        name: 'voiden',
        productName: 'Voiden',
        icon: './src/images/icon.png',
        homepage: 'https://voiden.md',
        mimeType: [
          "x-scheme-handler/voiden",
          "application/x-void",
          "text/plain",
          "text/x-source-code",
          "application/json",
          "application/xml",
          "text/xml",
          "text/html",
          "text/css",
          "text/javascript",
          "text/x-python",
          "text/x-ruby",
          "text/x-go",
          "text/x-rust",
          "text/x-java",
          "text/x-csrc",
          "text/x-c++src",
          "text/x-shellscript",
          "text/markdown",
          "text/x-yaml",
          "application/x-yaml",
          "application/yaml",
          "text/csv",
          "text/x-sql",
        ],
      },
    }),
    {
      name: '@pengx17/electron-forge-maker-appimage',
      platforms: ['linux'],
      config: {
        options: {
          bin: 'Voiden',
          name: 'Voiden',
          icon: './src/images/icon.png',
          categories: ['Development'],
        }
      }
    }
  );
}

const config: ForgeConfig = {
  hooks: {
    // Stamp version from package.json into bin scripts before packaging
    generateAssets: async () => {
      const REGISTRY_URL = "https://raw.githubusercontent.com/VoidenHQ/plugin-registry/main/extensions.json";
      let registryEntries: any[] = [];

      // Prefer the locally cloned registry repo (populated by cleanup.sh).
      // Fall back to a live GitHub fetch only when the clone is absent (e.g. CI).
      const localRegistryPath = path.join(__dirname, "../../plugins/plugin-registry/extensions.json");
      if (fs.existsSync(localRegistryPath)) {
        const raw = JSON.parse(fs.readFileSync(localRegistryPath, "utf-8"));
        registryEntries = Array.isArray(raw) ? raw.filter((p: any) => p.type === "core") : Object.values(raw?.plugins ?? {});
        console.log(`Using local registry clone: ${registryEntries.length} core plugins`);
      } else {
        try {
          console.log("Local registry clone not found — fetching from GitHub...");
          const res = await fetch(REGISTRY_URL);
          if (res.ok) {
            const raw = await res.json();
            registryEntries = Array.isArray(raw) ? raw.filter((p: any) => p.type === "core") : Object.values(raw?.plugins ?? {});
            console.log(`Registry fetched from GitHub — ${registryEntries.length} core plugins`);
          } else {
            console.warn(`Failed to fetch registry (HTTP ${res.status})`);
          }
        } catch (e) {
          console.warn("Could not reach registry:", (e as Error).message);
        }
      }
      // Wrap as object map for compatibility with the rest of this hook
      const registry = { plugins: Object.fromEntries(registryEntries.map((p: any) => [p.id, p])) };
      // Parse semver range for voidenVersion compatibility check at build time
      const satisfiesRange = (appVer: string, range: string): boolean => {
        const clean = (v: string) => v.replace(/[-+].*$/, "").trim();
        const parse = (v: string) => clean(v).split(".").map((n) => parseInt(n, 10) || 0);
        const cmp = (a: number[], b: number[]) => { for (let i = 0; i < 3; i++) { if ((a[i]??0) !== (b[i]??0)) return (a[i]??0)-(b[i]??0); } return 0; };
        const av = parse(appVer);
        for (const part of range.trim().split(/\s+/)) {
          const m = part.match(/^(>=|<=|>|<|=)?(.+)$/); if (!m) continue;
          const [,op,ver] = m; const d = cmp(av, parse(ver));
          if (op === ">=" && d < 0) return false;
          if (op === ">" && d <= 0) return false;
          if (op === "<=" && d > 0) return false;
          if (op === "<" && d >= 0) return false;
          if ((!op || op === "=") && d !== 0) return false;
        }
        return true;
      };

      // Build the set of plugin IDs that are registered and eligible to bundle.
      // Plugins not in the registry are never bundled, even if present in plugins/.
      const registeredIds = new Set<string>(Object.values(registry.plugins).map((p: any) => p.id as string));
      const excludedIds = new Set<string>();
      for (const [, p] of Object.entries(registry.plugins) as [string, any][]) {
        const id = p.id as string;
        if (p.bundled === false) {
          excludedIds.add(id);
          continue;
        }
        if (p.voidenVersion && !satisfiesRange(version, p.voidenVersion)) {
          excludedIds.add(id);
          console.log(`Excluding ${id} — requires ${p.voidenVersion}, building ${version}`);
        }
      }

      // Build plugin bundles from plugins/ repos into each plugin's own dist/.
      // Then collect compatible ones into staging dirs for packaging.
      // plugins/ is populated by cleanup.sh (clones repos).
      const pluginsDir = path.join(__dirname, "../../plugins");

      // Staging dirs — cleared and repopulated each build
      const stagingDir = path.join(__dirname, "bundled-plugins");
      const stagingMainDir = path.join(__dirname, "bundled-main-plugins");
      fs.mkdirSync(stagingDir, { recursive: true });
      fs.mkdirSync(stagingMainDir, { recursive: true });
      for (const f of fs.readdirSync(stagingDir)) fs.unlinkSync(path.join(stagingDir, f));
      for (const f of fs.readdirSync(stagingMainDir)) fs.unlinkSync(path.join(stagingMainDir, f));

      if (fs.existsSync(pluginsDir)) {
        console.log("Building plugin bundles...");
        // Build renderer bundles (plugins/*/dist/{id}.js)
        execSync("node scripts/build-plugins.mjs", {
          cwd: path.join(__dirname, "../.."),
          stdio: "inherit",
        });

        // Build main-process bundles for plugins that have build-main.mjs
        for (const pluginDir of fs.readdirSync(pluginsDir)) {
          const buildMainPath = path.join(pluginsDir, pluginDir, "build-main.mjs");
          if (!fs.existsSync(buildMainPath)) continue;
          try {
            execSync("node build-main.mjs", {
              cwd: path.join(pluginsDir, pluginDir),
              stdio: "inherit",
            });
          } catch (e) {
            console.warn(`build-main.mjs failed for ${pluginDir}`);
          }
        }

        // Collect built bundles from plugins/*/dist/ into staging dirs
        for (const pluginDir of fs.readdirSync(pluginsDir)) {
          const manifestPath = path.join(pluginsDir, pluginDir, "manifest.json");
          if (!fs.existsSync(manifestPath)) continue;
          const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
          const pluginId = manifest.id;
          if (!pluginId || !registeredIds.has(pluginId) || excludedIds.has(pluginId)) continue;

          // Renderer bundle
          const rendererBundle = path.join(pluginsDir, pluginDir, "dist", `${pluginId}.js`);
          if (fs.existsSync(rendererBundle)) {
            fs.copyFileSync(rendererBundle, path.join(stagingDir, `${pluginId}.js`));
            console.log(`Staged renderer bundle: ${pluginId}.js`);
          }

          // Main-process bundle (only for plugins with mainProcess: true)
          if (manifest.mainProcess) {
            const distDir = path.join(pluginsDir, pluginDir, "dist");
            const mainBundle = fs.existsSync(path.join(distDir, `${pluginId}-main.cjs`))
              ? path.join(distDir, `${pluginId}-main.cjs`)
              : path.join(distDir, `${pluginId}-main.js`);
            const ext = mainBundle.endsWith(".cjs") ? ".cjs" : ".js";
            if (fs.existsSync(mainBundle)) {
              fs.copyFileSync(mainBundle, path.join(stagingMainDir, `${pluginId}-main${ext}`));
              console.log(`Staged main-process bundle: ${pluginId}-main${ext}`);
            }
          }

          // Changelog
          const changelogSrc = path.join(pluginsDir, pluginDir, "changelog.json");
          if (fs.existsSync(changelogSrc)) {
            fs.copyFileSync(changelogSrc, path.join(stagingDir, `${pluginId}-changelog.json`));
            console.log(`Staged changelog: ${pluginId}-changelog.json`);
          }
        }
      } else {
        console.warn("plugins/ not found — no plugin bundles will be included (run cleanup.sh first)");
      }

      // Snapshot the registry so the packaged app has a reliable offline fallback.
      // The live GitHub fetch at startup will overwrite this in memory — the snapshot
      // is only used when the network is unavailable on first open.
      fs.writeFileSync(
        path.join(__dirname, "src", "extensions.json"),
        JSON.stringify(registryEntries, null, 2),
      );
      console.log("Wrote extensions.json snapshot with", registryEntries.length, "core plugins");

      // Copy skill.md files from plugin repos into skills/core/ so they are
      // bundled as extraResource and available at runtime via process.resourcesPath
      const skillsCoreDir = path.join(__dirname, "skills", "core");
      fs.mkdirSync(skillsCoreDir, { recursive: true });
      if (fs.existsSync(pluginsDir)) {
        for (const pluginDir of fs.readdirSync(pluginsDir)) {
          const manifestPath = path.join(pluginsDir, pluginDir, "manifest.json");
          if (!fs.existsSync(manifestPath)) continue;
          const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
          const pluginId = manifest.id;
          if (!pluginId || !registeredIds.has(pluginId) || excludedIds.has(pluginId)) continue;
          const skillSrc = path.join(pluginsDir, pluginDir, "src", "skill.md");
          if (fs.existsSync(skillSrc)) {
            fs.copyFileSync(skillSrc, path.join(skillsCoreDir, `${pluginId}.skill.md`));
            console.log(`Copied skill.md for ${pluginId}`);
          }
        }
      }

      const binDir = path.join(__dirname, "bin");

      // Replace VOIDEN_VERSION="<any value>" with the current version in bash script
      const bashFile = path.join(binDir, "voiden");
      if (fs.existsSync(bashFile)) {
        const content = fs.readFileSync(bashFile, "utf-8");
        fs.writeFileSync(bashFile, content.replace(/VOIDEN_VERSION="[^"]*"/, `VOIDEN_VERSION="${version}"`));
        console.log(`Stamped version ${version} into voiden`);
      }

      // Replace set "VOIDEN_VERSION=<any value>" with the current version in cmd script
      const cmdFile = path.join(binDir, "voiden.cmd");
      if (fs.existsSync(cmdFile)) {
        const content = fs.readFileSync(cmdFile, "utf-8");
        fs.writeFileSync(cmdFile, content.replace(/set "VOIDEN_VERSION=[^"]*"/, `set "VOIDEN_VERSION=${version}"`));
        console.log(`Stamped version ${version} into voiden.cmd`);
      }
    },
    // Generate app-update.yml in the packaged app's resources directory
    // This tells electron-updater where to check for updates (without needing electron-builder)
    packageAfterCopy: async (_config, buildPath, _electronVersion, platform, arch) => {
      if (platform !== "darwin" && platform !== "win32") return;

      const resourcesPath = path.resolve(buildPath, "..");
      const yml = await getAppUpdateYml({
        name: "Voiden",
        url: `https://voiden.md/api/download/${releaseChannel}/${platform}/${arch}`,
        updaterCacheDirName: "voiden-updater",
      });

      fs.writeFileSync(path.join(resourcesPath, "app-update.yml"), yml);
      console.log(`Generated app-update.yml in ${resourcesPath}`);
    },
    postMake: async (_config, makeResults) => {
      for (const result of makeResults) {
        const { platform, arch, artifacts } = result;

        // Find the main artifact (zip for mac, exe for windows)
        for (const artifactPath of artifacts) {
          const fileName = path.basename(artifactPath);
          const artifactDir = path.dirname(artifactPath);

          // Generate latest-mac.yml for macOS zip files
          if (platform === "darwin" && fileName.endsWith(".zip") && !fileName.includes("RELEASES")) {
            const ymlContent = generateUpdateYml(artifactPath, version, "darwin", arch);
            const ymlPath = path.join(artifactDir, `latest-mac.yml`);
            fs.writeFileSync(ymlPath, ymlContent);
            console.log(`Generated: ${ymlPath}`);

            // Also add the yml file to artifacts so it gets published
            result.artifacts.push(ymlPath);
          }

          // Generate latest.yml for Windows exe files
          if (platform === "win32" && (fileName.endsWith(".exe") || fileName.endsWith("Setup.exe"))) {
            const ymlContent = generateUpdateYml(artifactPath, version, "win32", arch);
            const ymlPath = path.join(artifactDir, `latest.yml`);
            fs.writeFileSync(ymlPath, ymlContent);
            console.log(`Generated: ${ymlPath}`);

            // Also add the yml file to artifacts so it gets published
            result.artifacts.push(ymlPath);
          }
        }
      }

      return makeResults;
    },
  },
  packagerConfig: {
    extraResource: ["src/sample-project", "splash.html", "logo-dark.png", "background.png", "default.settings.json", "public/fonts", "themes", "bin", "src/images/icon.png", "skills", "bundled-plugins", "bundled-main-plugins", "src/extensions.json"],
    extendInfo: "./info.plist",
    asar: {
      // Required for node-pty: ensures both `pty.node` and `spawn-helper` are unpacked for Unix platforms
      unpack: "**/{*.node,spawn-helper}",
    },
    osxSign: {},
    osxNotarize: isMac && process.env.APPLE_ID
      ? {
          appleId: process.env.APPLE_ID,
          appleIdPassword: process.env.APPLE_ID_PASSWORD,
          teamId: process.env.APPLE_TEAM_ID,
        }
      : undefined,
    icon: "./src/images/icon.png",
    protocols: [
      {
        name: "Voiden",
        schemes: ["voiden"],
      },
    ],
  },
  rebuildConfig: {},
  publishers: [
    {
      name: "@electron-forge/publisher-s3",
      config: {
        bucket: s3BucketName,
        region: s3Region,
        folder: "voiden", 
        public: true,
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
      },
    },
  ],
  makers,
  plugins: [
    new VitePlugin({
      build: [
        { entry: "src/main.ts", config: "vite.main.config.ts" },
        { entry: "src/preload.ts", config: "vite.preload.config.ts" },
      ],
      renderer: [{ name: "main_window", config: "vite.renderer.config.ts" }],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;