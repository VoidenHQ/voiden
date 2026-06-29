import { app, dialog, ipcMain, BrowserWindow } from "electron";
import { autoUpdater, type ProgressInfo } from "electron-updater";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import * as semver from "semver";
import * as https from "https";
import { execFile } from "child_process";
import { windowManager } from "./windowManager";
import { saveSettings } from "./settings";
import { flushRendererUnsavedForPaths } from "./fileSystem";

// ---------- Updater logger ----------

let _updaterLogStream: fs.WriteStream | null = null;

function getUpdaterLogPath(): string {
  return path.join(app.getPath("logs"), "updater.log");
}

function getUpdaterLogStream(): fs.WriteStream {
  if (!_updaterLogStream) {
    const logPath = getUpdaterLogPath();
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    _updaterLogStream = fs.createWriteStream(logPath, { flags: "a" });
  }
  return _updaterLogStream;
}

function clearUpdaterLog() {
  try {
    // Close the existing stream so we can truncate the file
    if (_updaterLogStream) {
      _updaterLogStream.end();
      _updaterLogStream = null;
    }
    const logPath = getUpdaterLogPath();
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.writeFileSync(logPath, "");
  } catch (err) {
    console.error("Failed to clear updater log:", err);
  }
}

function updaterLog(level: "INFO" | "WARN" | "ERROR" | "DEBUG", message: string) {
  const line = `[${new Date().toISOString()}] [${level}] ${message}\n`;
  try {
    getUpdaterLogStream().write(line);
  } catch {
    // stream may be closed during shutdown — ignore
  }
  if (level === "ERROR") console.error(`[updater] ${message}`);
  else if (level === "WARN") console.warn(`[updater] ${message}`);
  else console.log(`[updater] ${message}`);
}

const updaterLogger = {
  info:  (msg?: unknown) => updaterLog("INFO",  String(msg ?? "")),
  warn:  (msg?: unknown) => updaterLog("WARN",  String(msg ?? "")),
  error: (msg?: unknown) => updaterLog("ERROR", String(msg ?? "")),
  debug: (msg: string)   => updaterLog("DEBUG", msg),
};

// ---------- Cache helpers ----------

function getUpdaterCacheDir(): string {
  // electron-updater derives this as "<appName>-updater" (see forge.config.ts updaterCacheDirName)
  const dirName = `${app.getName()}-updater`;
  const home = os.homedir();
  if (process.platform === "win32") {
    return path.join(process.env["LOCALAPPDATA"] || path.join(home, "AppData", "Local"), dirName);
  }
  return path.join(home, "Library", "Caches", dirName);
}

function clearUpdaterCache() {
  // Linux uses a custom download path (fixed temp file that is always overwritten),
  // so stale-cache issues only apply to macOS/Windows electron-updater paths.
  if (process.platform !== "darwin" && process.platform !== "win32") return;
  // Never delete the cache while a file is being downloaded or installed —
  // the temp file is written via an open fd, so the write succeeds but the
  // subsequent rename fails with ENOENT once the directory is gone.
  if (isDownloadOrInstallInProgress()) {
    updaterLog("INFO", "clearUpdaterCache: skipped — download/install in progress");
    return;
  }
  try {
    // electron-updater caches downloads at: <OS cache dir>/voiden-updater/pending
    // Clearing before each check prevents stale installers from being used
    // when a newer update has since been released.
    const cacheDir = getUpdaterCacheDir();
    if (fs.existsSync(cacheDir)) {
      fs.rmSync(cacheDir, { recursive: true, force: true });
    }
  } catch (err) {
    console.error("Failed to clear updater cache:", err);
  }
}

// Update state management
enum UpdateState {
  IDLE = "idle",
  CHECKING = "checking",
  DOWNLOADING = "downloading",
  INSTALLING = "installing",
  READY = "ready",
  ERROR = "error"
}


let currentUpdateState: UpdateState = UpdateState.IDLE;

function setUpdateState(state: UpdateState) {
  currentUpdateState = state;
  sendUpdateProgressToWindows({ status: state });
}

function isUpdateInProgress(): boolean {
  return currentUpdateState === UpdateState.CHECKING ||
    currentUpdateState === UpdateState.DOWNLOADING ||
    currentUpdateState === UpdateState.INSTALLING;
}

// Narrower check: only true while the installer file is being written or applied.
// Used to guard clearUpdaterCache() — CHECKING is fine to clear (no file yet),
// but DOWNLOADING/INSTALLING must never be interrupted.
function isDownloadOrInstallInProgress(): boolean {
  return currentUpdateState === UpdateState.DOWNLOADING ||
    currentUpdateState === UpdateState.INSTALLING;
}

function isUpdateSupported(): boolean {
  // Updates only work in packaged/production builds
  return app.isPackaged;
}

function sendUpdateProgressToWindows(progress: { percent?: number; bytesPerSecond?: number; transferred?: number; total?: number; status: string }) {
  if (!isUpdateSupported()) return;

  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("update:progress", progress);
  }
}

function showToast(type: "info" | "error" | "warning", title: string, description: string, duration: number = 5000) {
  app.focus();
  const win = windowManager.browserWindow ?? BrowserWindow.getAllWindows()[0];
  if (win) {
    try {
      win.webContents.send(`toast:${type}`, { title, description, duration });
    } catch (err) { /* window may be destroyed */ }
  }
}

// ---------- Cross-channel update hint ----------

// Tracks the last version we already toasted about so we don't spam every hour.
let _lastCrossChannelToastVersion = "";

function sendChannelSwitchToast(version: string, targetChannel: "stable" | "early-access") {
  const win = windowManager.browserWindow ?? BrowserWindow.getAllWindows()[0];
  if (!win) return;
  try {
    win.webContents.send("toast:channelSwitch", { version, targetChannel });
  } catch { /* window may be destroyed */ }
}

async function checkOtherChannelForUpdate(
  currentVersion: string,
  currentChannel: "stable" | "early-access",
): Promise<void> {
  if (isDownloadOrInstallInProgress()) return;

  const otherChannel = currentChannel === "stable" ? "early-access" : "stable";
  const otherChannelPath = otherChannel === "early-access" ? "beta" : "stable";
  const platform = process.platform;
  const arch = process.arch;

  // Build the check URL. For macOS/Windows we fetch latest.yml (used by electron-updater);
  // for Linux we use the same latest.json endpoint as the main Linux check.
  const checkUrl = platform === "linux"
    ? `https://voiden.md/api/download/${otherChannelPath}/linux/latest.json`
    : `https://voiden.md/api/download/${otherChannelPath}/${platform}/${arch}/latest.yml`;

  const requestOptions = {
    headers: { "User-Agent": `Voiden/${currentVersion} (${platform}: ${arch})` },
  };

  return new Promise((resolve) => {
    https.get(checkUrl, requestOptions, (res) => {
      // Follow up to one redirect (CDN etc.)
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        https.get(res.headers.location, requestOptions, handleResponse).on("error", () => resolve());
        return;
      }
      handleResponse(res);

      function handleResponse(response: import("http").IncomingMessage) {
        let data = "";
        response.on("data", (chunk: string) => (data += chunk));
        response.on("end", () => {
          try {
            let version: string | undefined;
            if (platform === "linux") {
              version = JSON.parse(data)?.version;
            } else {
              // latest.yml contains "version: X.Y.Z" as a top-level key
              version = data.match(/^version:\s*([^\s]+)/m)?.[1]?.trim();
            }

            if (
              version &&
              semver.valid(version) &&
              semver.gt(version, currentVersion) &&
              version !== _lastCrossChannelToastVersion
            ) {
              updaterLog("INFO", `Cross-channel hint: ${otherChannel} has v${version} (current: ${currentVersion})`);
              _lastCrossChannelToastVersion = version;
              sendChannelSwitchToast(version, otherChannel);
            }
          } catch { /* parse error — ignore */ }
          resolve();
        });
      }
    }).on("error", () => resolve());
  });
}

// ---------- Linux package helpers ----------

function detectLinuxPackageType(): "deb" | "rpm" | "appimage" {
  // Check if running as AppImage
  if (process.env.APPIMAGE) {
    return "appimage";
  }

  // For system-installed packages, detect distro
  try {
    const osRelease = fs.readFileSync("/etc/os-release", "utf8");
    const idLike = osRelease.match(/ID_LIKE=(.*)/)?.[1]?.toLowerCase() ?? "";
    const id = osRelease.match(/ID=(.*)/)?.[1]?.toLowerCase() ?? "";

    if (id.includes("ubuntu") || id.includes("debian") || idLike.includes("debian") || idLike.includes("ubuntu")) {
      return "deb";
    }
  } catch (err) {
  }

  return "rpm";
}

function downloadAndInstallPackage(url: string, type: "deb" | "rpm" | "appimage", maxRedirects = 5) {
  if (isUpdateInProgress()) {
    showToast("info", "Update In Progress", "An update is already in progress. Please wait for it to complete.");
    return;
  }

  const extension = type === "appimage" ? "AppImage" : (type === "deb" ? "deb" : "rpm");
  const tmpPath = path.join(app.getPath("temp"), `voiden-latest.${extension}`);
  const file = fs.createWriteStream(tmpPath);

  const requestOptions = {
    headers: {
      'User-Agent': `Voiden/${app.getVersion()} (${process.platform}: ${process.arch})`,
    },
  };

  setUpdateState(UpdateState.DOWNLOADING);
  sendUpdateProgressToWindows({ status: "downloading", percent: 0 });

  let redirectCount = 0;

  function doDownload(downloadUrl: string) {
    https
      .get(downloadUrl, requestOptions, (response) => {
        // Handle redirects
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          redirectCount++;
          if (redirectCount > maxRedirects) {
            setUpdateState(UpdateState.ERROR);
            showToast("error", "Update Download Failed", "Too many redirects while downloading update.");
            return;
          }
          doDownload(response.headers.location);
          return;
        }

        if (response.statusCode !== 200) {
          setUpdateState(UpdateState.ERROR);
          showToast("error", "Update Download Failed", `Failed to download update: ${response.statusCode}`);
          return;
        }

        const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
        let downloadedBytes = 0;
        let lastTime = Date.now();
        let lastBytes = 0;
        let bytesPerSecond = 0;

        response.on('data', (chunk) => {
          downloadedBytes += chunk.length;

          const now = Date.now();
          const elapsed = (now - lastTime) / 1000;
          if (elapsed >= 0.5) {
            bytesPerSecond = Math.round((downloadedBytes - lastBytes) / elapsed);
            lastTime = now;
            lastBytes = downloadedBytes;
          }

          if (totalBytes > 0) {
            const percent = Math.round((downloadedBytes / totalBytes) * 100);
            sendUpdateProgressToWindows({
              status: "downloading",
              percent,
              bytesPerSecond,
              transferred: downloadedBytes,
              total: totalBytes
            });
          }
        });

        response.pipe(file);
        file.on("finish", () => {
          file.close(() => {
            setUpdateState(UpdateState.INSTALLING);
            installPackage(tmpPath, type);
          });
        });
      })
      .on("error", (err) => {
        setUpdateState(UpdateState.ERROR);
        showToast("error", "Download Error", err.message);
      });
  }

  doDownload(url);
}

function installPackage(filePath: string, type: "deb" | "rpm" | "appimage") {
  if (type === "appimage") {
    // For AppImage, just make it executable and inform user
    fs.chmod(filePath, 0o755, (chmodErr) => {
      if (chmodErr) {
        setUpdateState(UpdateState.ERROR);
        showToast("error", "Installation Failed", `Failed to make AppImage executable: ${chmodErr.message}`);
        return;
      }

      setUpdateState(UpdateState.READY);
      app.focus();
      dialog
        .showMessageBox({
          type: "info",
          buttons: ["OK"],
          defaultId: 0,
          title: "Update Downloaded",
          message: "Voiden AppImage has been downloaded.",
          detail: `The new version is saved at:\n${filePath}\n\nRun this file to use the updated version.`,
        })
        .then(() => {
          setUpdateState(UpdateState.IDLE);
        });
    });
    return;
  }

  const command = type === "deb" ? ["dpkg", "-i", filePath] : ["rpm", "-Uvh", filePath];

  execFile("pkexec", command, (error, _stdout, stderr) => {
    fs.unlink(filePath, () => {});

    if (error) {
      setUpdateState(UpdateState.ERROR);
      showToast("error", "Installation Failed", `${error.message}\n\n${stderr}`);
      return;
    }

    setUpdateState(UpdateState.READY);
    app.focus();
    dialog
      .showMessageBox({
        type: "info",
        buttons: ["OK"],
        defaultId: 0,
        title: "Update Complete",
        message: "Voiden has been successfully updated.",
        detail: "The app will now restart to complete the update.",
      })
      .then(() => {
        app.relaunch();
        app.exit(0);
      });
  });
}

function isNewerVersion(latestVersion: string, currentVersion: string): boolean {
  if (!semver.valid(latestVersion)) return false;
  if (semver.gt(latestVersion, currentVersion)) return true;

  // If current is a prerelease, a stable release at the same major.minor is an upgrade
  const isCurrentPre = !!semver.prerelease(currentVersion);
  const isLatestStable = !semver.prerelease(latestVersion);
  if (isCurrentPre && isLatestStable) {
    const baseline = `${semver.major(currentVersion)}.${semver.minor(currentVersion)}.0`;
    return semver.gte(latestVersion, baseline);
  }
  return false;
}

function checkForLinuxUpdate(currentVersion: string, channel: "stable" | "early-access" = "stable") {
  if (isUpdateInProgress()) {
    showToast("info", "Update In Progress", "An update is already in progress. Please wait for it to complete.");
    return;
  }

  const packageType = detectLinuxPackageType();
  const channelPath = channel === "early-access" ? "beta" : "stable";
  const latestUrl = `https://voiden.md/api/download/${channelPath}/linux/latest.json`;

  const requestOptions = {
    headers: {
      'User-Agent': `Voiden/${currentVersion} (${process.platform}: ${process.arch})`,
    },
  };

  setUpdateState(UpdateState.CHECKING);

  https
    .get(latestUrl, requestOptions, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const latest = JSON.parse(data);
          const latestVersion = latest.version;

          setUpdateState(UpdateState.IDLE);

          if (isNewerVersion(latestVersion, currentVersion)) {
            const channelLabel = channel === "early-access" ? " (Early Access)" : "";

            // Determine download URL based on how the app was installed
            let downloadUrl: string;
            let packageTypeLabel: string;

            if (packageType === "appimage") {
              downloadUrl = latest.appimage;
              packageTypeLabel = "AppImage";
            } else if (packageType === "deb") {
              downloadUrl = latest.deb;
              packageTypeLabel = "DEB";
            } else {
              downloadUrl = latest.rpm;
              packageTypeLabel = "RPM";
            }

            // Check if the required package format is available
            if (!downloadUrl) {
              console.error(`Update not available for package type: ${packageType}`);
              return;
            }

            app.focus();
            dialog
              .showMessageBox({
                type: "info",
                buttons: ["Download", "Later"],
                defaultId: 0,
                cancelId: 1,
                title: "Voiden Update Available",
                message: `A new version (${latestVersion})${channelLabel} of Voiden is available.`,
                detail: packageType === "appimage"
                  ? `You are running version ${currentVersion}.\n\nClick "Download" to get the latest AppImage.`
                  : `You are running version ${currentVersion}.\n\nClick "Download" to get the latest ${packageTypeLabel} package.\nYou may be prompted for your password.`,
              })
              .then((result) => {
                if (result.response === 0) {
                  downloadAndInstallPackage(downloadUrl, packageType);
                }
              });
          }
        } catch (err) {
          setUpdateState(UpdateState.ERROR);
        }
      });
    })
    .on("error", () => {
      setUpdateState(UpdateState.ERROR);
    });
}

export function initializeUpdates(channel: "stable" | "early-access" = "stable") {
  const platform = process.platform;
  const arch = process.arch;
  const currentVersion = app.getVersion();

  if (platform === "darwin" || platform === "win32") {
    // Both macOS and Windows use electron-updater natively (NSIS on Windows)
    setupAutoUpdaterListeners();

    const channelPath = channel === "early-access" ? "beta" : "stable";

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.setFeedURL({
      provider: "generic",
      url: `https://voiden.md/api/download/${channelPath}/${platform}/${arch}`,
    });

    // Check for updates after app is ready, then periodically
    app.whenReady().then(() => {
      setTimeout(() => {
        clearUpdaterCache();
        autoUpdater.checkForUpdates()
          .then(() => checkOtherChannelForUpdate(currentVersion, channel))
          .catch((err: Error) => {
            console.error("Auto update check failed:", err);
          });
      }, 10_000);

      // Check for updates every hour
      setInterval(() => {
        if (!isUpdateInProgress()) {
          clearUpdaterCache();
          autoUpdater.checkForUpdates()
            .then(() => checkOtherChannelForUpdate(currentVersion, channel))
            .catch((err: Error) => {
              console.error("Periodic update check failed:", err);
            });
        }
      }, 60 * 60 * 1000);
    });
  } else if (platform === "linux") {
    app.whenReady().then(() => {
      setTimeout(() => {
        if (!isUpdateInProgress()) {
          checkForLinuxUpdate(currentVersion, channel);
          checkOtherChannelForUpdate(currentVersion, channel);
        }
      }, 10_000);

      setInterval(() => {
        if (!isUpdateInProgress()) {
          checkForLinuxUpdate(currentVersion, channel);
          checkOtherChannelForUpdate(currentVersion, channel);
        }
      }, 60 * 60 * 1000);
    });
  }
}

// Manual update check function
export async function checkForUpdatesManually(channel: "stable" | "early-access" = "stable"): Promise<{ available: boolean; version?: string }> {
  if (isUpdateInProgress()) {
    showToast("info", "Update In Progress", "An update is already in progress. Please wait for it to complete.");
    return { available: false };
  }

  const platform = process.platform;
  const currentVersion = app.getVersion();

  if (platform === "linux") {
    return new Promise((resolve) => {
      setUpdateState(UpdateState.CHECKING);

      const channelPath = channel === "early-access" ? "beta" : "stable";
      const latestUrl = `https://voiden.md/api/download/${channelPath}/linux/latest.json`;

      const requestOptions = {
        headers: {
          'User-Agent': `Voiden/${currentVersion} (${process.platform}: ${process.arch})`,
        },
      };

      https
        .get(latestUrl, requestOptions, (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              const latest = JSON.parse(data);
              const latestVersion = latest.version;

              setUpdateState(UpdateState.IDLE);

              if (isNewerVersion(latestVersion, currentVersion)) {
                resolve({ available: true, version: latestVersion });
              } else {
                resolve({ available: false });
              }
            } catch (err) {
              setUpdateState(UpdateState.ERROR);
              resolve({ available: false });
            }
          });
        })
        .on("error", () => {
          setUpdateState(UpdateState.ERROR);
          resolve({ available: false });
        });
    });
  } else if (platform === "win32" || platform === "darwin") {
    // Use electron-updater directly for both macOS and Windows (NSIS)
    try {
      setUpdateState(UpdateState.CHECKING);
      isManualUpdateCheck = true;
      clearUpdaterCache();
      const result = await autoUpdater.checkForUpdates();
      isManualUpdateCheck = false;
      // With autoDownload=true, checkForUpdates() resolves as soon as the version
      // check completes, but the download has already started — update-available
      // will have moved state to DOWNLOADING. Only reset to IDLE if no download
      // was triggered (i.e. state is still CHECKING).
      if (!isDownloadOrInstallInProgress()) {
        setUpdateState(UpdateState.IDLE);
      }

      if (result?.updateInfo && semver.gt(result.updateInfo.version, currentVersion)) {
        return { available: true, version: result.updateInfo.version };
      }
      return { available: false };
    } catch (err) {
      isManualUpdateCheck = false;
      console.error("Manual update check failed:", err);
      setUpdateState(UpdateState.ERROR);
      return { available: false };
    }
  }

  return { available: false };
}

// Setup autoUpdater event listeners once
let autoUpdaterInitialized = false;
let isManualUpdateCheck = false;

function setupAutoUpdaterListeners() {
  if (autoUpdaterInitialized || !isUpdateSupported()) return;
  autoUpdaterInitialized = true;

  // Pipe all internal electron-updater messages to the log file
  autoUpdater.logger = updaterLogger;
  updaterLog("INFO", `Updater initialised — app version: ${app.getVersion()}, platform: ${process.platform}/${process.arch}, log: ${getUpdaterLogPath()}`);

  autoUpdater.on("checking-for-update", () => {
    clearUpdaterLog();
    updaterLog("INFO", `Checking for update — app version: ${app.getVersion()}, platform: ${process.platform}/${process.arch}`);
    setUpdateState(UpdateState.CHECKING);
  });

  autoUpdater.on("update-available", () => {
    updaterLog("INFO", "Update available — starting download");
    setUpdateState(UpdateState.DOWNLOADING);
    sendUpdateProgressToWindows({ status: "downloading", percent: 0 });
  });

  autoUpdater.on("update-not-available", () => {
    updaterLog("INFO", "No update available");
    setUpdateState(UpdateState.IDLE);
  });

  // electron-updater provides detailed progress events
  autoUpdater.on("download-progress", (progress: ProgressInfo) => {
    updaterLog("DEBUG", `Download progress: ${Math.round(progress.percent)}% (${progress.transferred}/${progress.total} bytes, ${progress.bytesPerSecond} B/s)`);
    sendUpdateProgressToWindows({
      status: "downloading",
      percent: Math.round(progress.percent),
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on("update-downloaded", () => {
    updaterLog("INFO", "Update download complete — showing restart dialog");
    setUpdateState(UpdateState.READY);

    const showRestartDialog = () => {
      updaterLog("INFO", "Restart dialog displayed to user");
      app.focus();
      dialog.showMessageBox({
        type: "info",
        buttons: ["Restart Now", "Later"],
        defaultId: 0,
        title: "Update Ready",
        message: "Update downloaded successfully!",
        detail: "The application will restart to complete the installation.",
      }).then((restartResponse) => {
        if (restartResponse.response === 0) {
          updaterLog("INFO", "User chose 'Restart Now' — flushing unsaved tabs before quitAndInstall");
          setUpdateState(UpdateState.INSTALLING);
          // Give the renderer a chance to save any unsaved tab content to disk first —
          // quitAndInstall terminates the app immediately and would otherwise silently
          // discard in-memory drafts (issue: unsaved work lost on update).
          flushRendererUnsavedForPaths([]).then(() => {
            updaterLog("INFO", "quitAndInstall invoked");
            autoUpdater.quitAndInstall(true, true);
          });
        } else {
          updaterLog("INFO", "User chose 'Later' — update deferred");
          setUpdateState(UpdateState.IDLE);
        }
      });
    };

    // On macOS, electron-updater fires update-downloaded and *then* tells
    // Squirrel.Mac to download the zip from its local proxy server. Squirrel
    // must finish that download before quitAndInstall can actually install.
    // A short delay ensures squirrelDownloadedUpdate=true by the time the
    // user clicks "Restart Now", avoiding a silent quit with no install.
    if (process.platform === "darwin") {
      updaterLog("INFO", "macOS: waiting 2 s for Squirrel.Mac to pull from proxy before showing dialog");
      setTimeout(showRestartDialog, 2000);
    } else {
      showRestartDialog();
    }
  });

  autoUpdater.on("error", (error: Error) => {
    updaterLog("ERROR", `Update error: ${error.stack ?? error.message}`);
    setUpdateState(UpdateState.ERROR);

    const isNetworkError = /ENOTFOUND|ENETUNREACH|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|getaddrinfo/i.test(error.message);
    const wasManual = isManualUpdateCheck;
    isManualUpdateCheck = false;

    if (isNetworkError) {
      if (wasManual) {
        showToast("error", "Update Error", "No internet connection", 4000);
      }
    } else {
      showToast("error", "Update Error", `Failed to download update: ${error.message}`);
    }
  });
}

// Register IPC handler for manual update checks
export function registerUpdateIpcHandlers() {
  // Setup autoUpdater listeners once on initialization
  setupAutoUpdaterListeners();

  ipcMain.handle("app:checkForUpdates", async (_event, channel: "stable" | "early-access") => {
    // Don't check for updates in development mode
    if (!isUpdateSupported()) {
      showToast("info", "Updates Not Available", "Updates are only available in production builds. You are currently running a development build.");
      return { available: false };
    }

    // Check if update is already in progress
    if (isUpdateInProgress()) {
      showToast("info", "Update In Progress", "An update is already in progress. Please wait for it to complete.");
      return { available: false, inProgress: true };
    }

    const result = await checkForUpdatesManually(channel);
    const platform = process.platform;

    if (result.available) {
      const channelLabel = channel === "early-access" ? " (Early Access)" : "";

      if (platform === "linux") {
        // For Linux, prompt user to download and install
        const packageType = detectLinuxPackageType();
        const channelPath = channel === "early-access" ? "beta" : "stable";
        const latestUrl = `https://voiden.md/api/download/${channelPath}/linux/latest.json`;

        const requestOptions = {
          headers: {
            'User-Agent': `Voiden/${app.getVersion()} (${process.platform}: ${process.arch})`,
          },
        };

        // Fetch the download URLs
        https.get(latestUrl, requestOptions, (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              const latest = JSON.parse(data);

              // Determine download URL based on how the app was installed
              let downloadUrl: string;
              let packageTypeLabel: string;

              if (packageType === "appimage") {
                downloadUrl = latest.appimage;
                packageTypeLabel = "AppImage";
              } else if (packageType === "deb") {
                downloadUrl = latest.deb;
                packageTypeLabel = "DEB";
              } else {
                downloadUrl = latest.rpm;
                packageTypeLabel = "RPM";
              }

              // Check if the required package format is available
              if (!downloadUrl) {
                console.error(`Update not available for package type: ${packageType}`);
                showToast("warning", "Update Error", `Update not available for ${packageTypeLabel} format.`);
                return;
              }

              app.focus();
              dialog
                .showMessageBox({
                  type: "info",
                  buttons: ["Download & Install", "Later"],
                  defaultId: 0,
                  cancelId: 1,
                  title: "Update Available",
                  message: `A new version (${result.version})${channelLabel} is available!`,
                  detail: packageType === "appimage"
                    ? `You are currently running version ${app.getVersion()}.\n\nClick "Download & Install" to update your AppImage.`
                    : `You are currently running version ${app.getVersion()}.\n\nClick "Download & Install" to update now.\nYou may be prompted for your password.`,
                })
                .then((response) => {
                  if (response.response === 0) {
                    downloadAndInstallPackage(downloadUrl, packageType);
                  }
                });
            } catch (err) {
            }
          });
        });
      } else {
        // For Windows/macOS, download via electron-updater
        app.focus();
        dialog.showMessageBox({
          type: "info",
          buttons: ["Download & Install", "Later"],
          defaultId: 0,
          cancelId: 1,
          title: "Update Available",
          message: `A new version (${result.version})${channelLabel} is available!`,
          detail: `You are currently running version ${app.getVersion()}.\n\nClick "Download & Install" to update now.`,
        }).then(async (response) => {
          if (response.response === 0) {
            try {
              setUpdateState(UpdateState.DOWNLOADING);
              sendUpdateProgressToWindows({ status: "downloading", percent: 0 });
              await autoUpdater.downloadUpdate();
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              setUpdateState(UpdateState.ERROR);
              showToast("error", "Update Error", `Failed to download update: ${errorMessage}`);
            }
          }
        });
      }

      // Always check the other channel when user manually checks
      checkOtherChannelForUpdate(app.getVersion(), channel);
      return { available: true, version: result.version };
    } else {
      showToast("info", "No Updates Available", `You're running the latest version! (${app.getVersion()})`);
      // Still cross-check the other channel in case there's something there
      checkOtherChannelForUpdate(app.getVersion(), channel);
      return { available: false };
    }
  });

  // Add IPC handler to get current update state
  ipcMain.handle("app:getUpdateState", () => {
    return { state: currentUpdateState };
  });

  // Expose log path so the renderer can offer a "Show updater log" action
  ipcMain.handle("app:getUpdaterLogPath", () => getUpdaterLogPath());

  // Return current log file contents to the renderer
  ipcMain.handle("app:readUpdaterLog", () => {
    try {
      const logPath = getUpdaterLogPath();
      if (!fs.existsSync(logPath)) return "";
      return fs.readFileSync(logPath, "utf8");
    } catch {
      return "";
    }
  });
}
