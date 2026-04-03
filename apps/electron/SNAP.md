# Voiden — Snap Release Guide

## Confinement

Voiden uses **strict confinement** — NOT classic.

Classic confinement requires a special human review process from the Snap Store security
team (see https://forum.snapcraft.io/t/process-for-reviewing-classic-confinement-snaps/1460)
and is only approved for tools like compilers, shells, and terminal emulators.

Voiden qualifies for strict confinement with the plugs defined in `snapcraft.yaml`
(network, home, opengl, wayland, x11, etc.) — no special review or approval needed.

---

## One-time Setup

### 1. Register the snap name
- Go to https://snapcraft.io → create a free account
- Go to https://snapcraft.io/snaps → click **Register a snap name**
- Register the name `voiden`

### 2. Login on your Linux machine
```bash
sudo snap install snapcraft --classic
snapcraft login   # opens browser — log in with your snapcraft.io account
```

---

## Every Release (must run on Linux)

### Step 1 — Build the .deb
```bash
yarn workspace voiden make
```

### Step 2 — Run the publish script
```bash
# Beta
node apps/electron/publish-snap.js beta

# Stable
node apps/electron/publish-snap.js stable
```

The script automatically:
- Stamps the current version from `package.json` into `snapcraft.yaml`
- Sets `grade: devel` for beta, `grade: stable` for stable
- Builds the `.snap` via `snapcraft --destructive-mode`
- Uploads and releases to the Snap Store via `snapcraft upload --release=<channel>`

---

## Channels

| Channel | Command | Who gets it |
|---|---|---|
| `stable` | `node publish-snap.js stable` | All users by default |
| `beta` | `node publish-snap.js beta` | Users who opted into beta |

---

## User Install Commands

```bash
# Stable
sudo snap install voiden

# Beta
sudo snap install voiden --channel=beta

# Switch from beta to stable
sudo snap refresh voiden --channel=stable

# Update
sudo snap refresh voiden
```

---

## Files in This Repo

| File | Purpose |
|---|---|
| `apps/electron/snapcraft.yaml` | Snap build config — version is auto-stamped on each publish |
| `apps/electron/publish-snap.js` | Build + upload script |
