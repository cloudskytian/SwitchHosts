fn main() {
    // Inject version components from `src/version.json` as compile-time
    // environment variables so Rust code can reference them via `env!()`.
    //
    // version.json is the single source of truth shared with the
    // renderer (which `import`s it directly). Format: [major, minor,
    // patch, build].
    //
    // Emits:
    //   SWH_VERSION_MAJOR   e.g. "4"
    //   SWH_VERSION_MINOR   e.g. "3"
    //   SWH_VERSION_PATCH   e.g. "0"
    //   SWH_VERSION_BUILD   e.g. "6140"
    //   SWH_VERSION_THREE   e.g. "4.3.0"
    //   SWH_VERSION_LABEL   e.g. "v4.3.0 (6140)"
    //   SWH_VERSION_ARRAY   e.g. "[4,3,0,6140]"
    let version_path = std::path::Path::new("../src/version.json");
    println!("cargo:rerun-if-changed={}", version_path.display());

    let content = std::fs::read_to_string(version_path)
        .expect("failed to read src/version.json — is it present at the repo root?");
    let parts: Vec<u32> = serde_json::from_str(&content)
        .expect("src/version.json must be a JSON array of 4 integers");
    assert_eq!(parts.len(), 4, "src/version.json must have exactly 4 elements");

    let major = parts[0];
    let minor = parts[1];
    let patch = parts[2];
    let build = parts[3];

    println!("cargo:rustc-env=SWH_VERSION_MAJOR={major}");
    println!("cargo:rustc-env=SWH_VERSION_MINOR={minor}");
    println!("cargo:rustc-env=SWH_VERSION_PATCH={patch}");
    println!("cargo:rustc-env=SWH_VERSION_BUILD={build}");
    println!("cargo:rustc-env=SWH_VERSION_THREE={major}.{minor}.{patch}");
    println!("cargo:rustc-env=SWH_VERSION_LABEL=v{major}.{minor}.{patch} ({build})");
    println!("cargo:rustc-env=SWH_VERSION_ARRAY=[{major},{minor},{patch},{build}]");

    tauri_build::build()
}
