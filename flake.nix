{
  description = "Voiden API Workspace";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      supportedSystems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAllSystems = f: nixpkgs.lib.genAttrs supportedSystems (system: f system);
    in
    {
      devShells = forAllSystems (system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.mkShell {
            buildInputs = with pkgs; [
              nodejs_22
              corepack_22
              git
              python3
            ] ++ lib.optionals stdenv.isLinux [
              pkg-config
            ];

            shellHook = ''
              export PATH="$PATH:$(pwd)/node_modules/.bin"
              mkdir -p .local/bin
              corepack enable --install-directory .local/bin
              export PATH="$(pwd)/.local/bin:$PATH"
              echo "========================================="
              echo " Voiden Development Shell Active"
              echo " Node: $(node --version)"
              echo " Yarn: $(yarn --version)"
              echo "========================================="
            '';
          };
        });

      packages = forAllSystems (system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          voiden = pkgs.callPackage ./nix/package.nix {};
          default = self.packages.${system}.voiden;
        });
    };
}
