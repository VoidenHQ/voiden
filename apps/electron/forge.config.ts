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
      // Copy core extension skill.md files into skills/core/ so they are
      // bundled as extraResource and available at runtime via process.resourcesPath
      const coreExtSrcDir = path.join(__dirname, "../../core-extensions/src");
      const skillsCoreDir = path.join(__dirname, "skills", "core");
      fs.mkdirSync(skillsCoreDir, { recursive: true });
      for (const extId of fs.readdirSync(coreExtSrcDir)) {
        const skillSrc = path.join(coreExtSrcDir, extId, "skill.md");
        if (fs.existsSync(skillSrc)) {
          fs.copyFileSync(skillSrc, path.join(skillsCoreDir, `${extId}.skill.md`));
          console.log(`Copied skill.md for ${extId}`);
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
    extraResource: ["src/sample-project", "splash.html", "logo-dark.png", "background.png", "default.settings.json", "public/fonts", "themes", "bin", "src/images/icon.png", "skills"],
    extendInfo: "./info.plist",
    asar: {
      // 👇 Required for node-pty: ensures both `pty.node` and `spawn-helper` are unpacked for Unix platforms
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
        { entry: "src/fileWatcher.worker.ts", config: "vite.watcher.config.ts" },
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