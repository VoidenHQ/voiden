# One derivation per plugin repo (see flake.nix's plugin-* inputs). Each just
# gets the plugin's own hermetic `npm ci` done — it does NOT run the plugin's
# own build. The actual vite build happens once, later, in package.nix's
# buildPhase via scripts/build-plugins.mjs run against all prepared plugins
# together — that's the same script forge.config.ts's generateAssets hook
# calls for a normal (non-Nix) build, so plugin bundles get the identical
# host-shimming (window.__voiden_shims__), manifest-injection, and minification
# logic without reimplementing any of it here.
{ buildNpmPackage }:

# id: matches the registry's plugin id — must equal the directory name
# scripts/build-plugins.mjs / forge.config.ts's staging logic expect under
# plugins/<id>/.
{ id, src, npmDepsHash }:

buildNpmPackage {
  pname = id;
  version = "0.0.0";
  inherit src npmDepsHash;

  # Plugins declare react/react-dom (and @voiden/sdk) as peerDependencies —
  # deliberately unresolved in their lockfiles, since the real react instance
  # comes from the host app's window.__voiden_shims__ at runtime, not a real
  # install. Without this, npm 7+'s automatic peer-dependency install tries to
  # fetch them from the live registry during the (offline, sandboxed) build.
  npmFlags = [ "--legacy-peer-deps" ];

  # Only need `npm ci` (via npmConfigHook, during configurePhase) to populate
  # node_modules — skip the plugin's own "npm run build".
  dontNpmBuild = true;

  installPhase = ''
    runHook preInstall
    mkdir -p $out
    cp -r . $out/
    runHook postInstall
  '';
}
