#!/usr/bin/env node

require("dotenv").config({ path: "../../.env" });

const fs = require("fs");
const path = require("path");
const AWS = require("aws-sdk");
const os = require("os");
const semver = require("semver");

// Read version from package.json
const packageJsonPath = path.resolve(__dirname, "./package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
const APP_VERSION = packageJson.version;

if (!semver.valid(APP_VERSION)) {
  console.error("Invalid version in package.json:", APP_VERSION);
  process.exit(1);
}

// Detect release channel (from args or env)
const releaseChannel = process.argv[2] || process.env.RELEASE_CHANNEL || "stable";
console.log(`📦 Republishing for channel: ${releaseChannel}`);

// Config from env
const DEB_BUILD_DIR = process.env.DEB_BUILD_DIR || "./out/make/deb/x64";
const RPM_BUILD_DIR = process.env.RPM_BUILD_DIR || "./out/make/rpm/x64";
const APPIMAGE_BUILD_DIR = process.env.APPIMAGE_BUILD_DIR || "./out/make";
const S3_BUCKET = releaseChannel === "beta"
  ? process.env.S3_BUCKET_NAME_BETA || "voiden-releases-beta"
  : process.env.S3_BUCKET_NAME_STABLE || "voiden-releases-stable";
const S3_REGION = process.env.S3_REGION || "eu-west-1";
const S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID;
const S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY;
const PLATFORM = os.platform();

if (!S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
  console.error("Missing S3 credentials. Set S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY in your environment.");
  process.exit(1);
}

const s3 = new AWS.S3({
  accessKeyId: S3_ACCESS_KEY_ID,
  secretAccessKey: S3_SECRET_ACCESS_KEY,
  region: S3_REGION,
});

if (PLATFORM === "linux") {
  console.debug(`Detected Linux. Using version ${APP_VERSION} from package.json`);

  const normalizedDebVersion = APP_VERSION.replace(/-/g, '~'); // Debian
  const normalizedRpmVersion = APP_VERSION.replace(/-/g, '.'); // RPM
  const deb = fs.readdirSync(DEB_BUILD_DIR).find(f =>
    f.endsWith(".deb") && (f.includes(APP_VERSION) || f.includes(normalizedDebVersion))
  );
  const rpm = fs.readdirSync(RPM_BUILD_DIR).find(f =>
    f.endsWith(".rpm") && (f.includes(APP_VERSION) || f.includes(normalizedRpmVersion))
  );

  // Find AppImage file
  const appimage = fs.readdirSync(APPIMAGE_BUILD_DIR).find(f =>
    f.endsWith(".AppImage") && f.includes(APP_VERSION)
  );

  if (!deb || !rpm) {
    console.error(`Could not find both .deb and .rpm files with version ${APP_VERSION}`);
    console.error("Found deb:", deb);
    console.error("Found rpm:", rpm);
    process.exit(1);
  }

  if (!appimage) {
    console.warn(`Warning: Could not find AppImage file with version ${APP_VERSION}`);
  }

  const channelPath = releaseChannel === "beta" ? "beta" : "stable";
  const debUrl = `https://voiden.md/api/download/${channelPath}/linux/x64/${deb}`;
  const rpmUrl = `https://voiden.md/api/download/${channelPath}/linux/x64/${rpm}`;
  const appimageUrl = appimage ? `https://voiden.md/api/download/${channelPath}/linux/x64/${appimage}` : undefined;

  const latest = {
    version: APP_VERSION,
    deb: debUrl,
    rpm: rpmUrl,
    ...(appimageUrl && { appimage: appimageUrl }),
  };

  // Create latest.json temporarily in DEB dir
  const latestJsonPath = path.join(DEB_BUILD_DIR, "latest.json");
  fs.writeFileSync(latestJsonPath, JSON.stringify(latest, null, 2));
  console.debug(`Created latest.json:\n`, latest);

  const uploadParams = {
    Bucket: S3_BUCKET,
    Key: `voiden/linux/latest.json`,
    Body: fs.readFileSync(latestJsonPath),
    ACL: "public-read",
    ContentType: "application/json",
  };

  s3.upload(uploadParams, (err, data) => {
    if (err) {
      console.error("Error uploading latest.json:", err);
      process.exit(1);
    }
    console.debug("Uploaded latest.json to:", data.Location);
  });
} else if (PLATFORM === "win32") {
  const channelPath = releaseChannel === "beta" ? "beta" : "stable";
  const WIN_BUILD_DIR = process.env.BUILD_DIR || "./out/make/squirrel.windows/x64";
  const files = fs.readdirSync(WIN_BUILD_DIR).filter(file => file.endsWith(".exe"));
  if (files.length === 0) {
    console.error("No .exe installer found in", WIN_BUILD_DIR);
    process.exit(1);
  }

  const installer = files[0];
  const sourcePath = path.join(WIN_BUILD_DIR, installer);
  const targetPath = path.join(WIN_BUILD_DIR, "setup-latest.exe");
  fs.copyFileSync(sourcePath, targetPath);
  console.debug(`Copied installer to ${targetPath}`);

  const uploadParams = {
    Bucket: S3_BUCKET,
    Key: `voiden/win32/x64/setup-latest.exe`,
    Body: fs.readFileSync(targetPath),
    ACL: "public-read",
    ContentType: "application/vnd.microsoft.portable-executable",
  };

  s3.upload(uploadParams, (err, data) => {
    if (err) {
      console.error("Error uploading file:", err);
      process.exit(1);
    }
    console.debug("Uploaded setup-latest.exe to:", data.Location);
  });
} else {
  console.warn("Unsupported platform:", PLATFORM);
  process.exit(1);
}
