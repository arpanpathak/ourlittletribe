//! Builds the web app and lists its files for embedding.
//!
//! The TypeScript in `web/src` compiles to `web/dist` with the project's own
//! `tsc`. Then every file the page loads (the HTML, CSS, icon, compiled
//! scripts and vendored Leaflet and font) is written into a list that
//! `web.rs` includes, so adding a file never means editing Rust.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Single files at the top of `web/` that the page loads.
const TOP_FILES: &[&str] = &["index.html", "app.css", "favicon.svg"];

/// Folders under `web/` whose files the page loads.
const FOLDERS: &[&str] = &["dist", "vendor"];

/// What, when changed, means the web app must be built again.
const WATCHED: &[&str] = &[
    "src",
    "tsconfig.json",
    "package.json",
    "index.html",
    "app.css",
    "favicon.svg",
    "vendor",
];

fn web_dir() -> PathBuf {
    let manifest = env::var("CARGO_MANIFEST_DIR").expect("cargo sets CARGO_MANIFEST_DIR");
    Path::new(&manifest).join("../../web")
}

/// Runs the TypeScript compiler. Without one (a machine with no Node), the
/// last build in `web/dist` is used, with a warning.
fn compile_typescript(web: &Path) {
    let compiler = web.join("node_modules/.bin/tsc");
    if !compiler.exists() {
        println!(
            "cargo:warning=web/node_modules is missing; run `npm ci` in web/. Using the existing web/dist."
        );
        return;
    }

    let status = Command::new(&compiler)
        .args(["-p", "."])
        .current_dir(web)
        .status()
        .expect("could not start tsc");
    assert!(
        status.success(),
        "the web app does not compile; run `npm run check` in web/"
    );
}

/// Every file under `folder`, as paths relative to `web`, sorted.
fn files_under(web: &Path, folder: &Path) -> Vec<String> {
    let mut found = Vec::new();
    let mut waiting = vec![folder.to_path_buf()];

    while let Some(directory) = waiting.pop() {
        let entries = fs::read_dir(&directory)
            .unwrap_or_else(|error| panic!("{}: {error}", directory.display()));
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                waiting.push(path);
                continue;
            }

            let relative = path.strip_prefix(web).expect("files are under web/");
            found.push(relative.to_string_lossy().replace('\\', "/"));
        }
    }

    found.sort();
    found
}

/// The Rust source of the file list.
fn file_list(web: &Path, files: &[String]) -> String {
    let mut source = String::from(
        "/// Every file of the web app, by its path under `web/`.\nconst FILES: &[(&str, &[u8])] = &[\n",
    );
    for file in files {
        let absolute = web
            .join(file)
            .canonicalize()
            .unwrap_or_else(|error| panic!("{file}: {error}"));
        source.push_str(&format!(
            "    ({file:?}, include_bytes!({:?}).as_slice()),\n",
            absolute.display().to_string()
        ));
    }
    source.push_str("];\n");
    source
}

fn main() {
    let web = web_dir();
    for watched in WATCHED {
        println!("cargo:rerun-if-changed={}", web.join(watched).display());
    }

    compile_typescript(&web);
    assert!(
        web.join("dist").is_dir(),
        "web/dist is missing: run `npm ci` in web/ so the build can compile the TypeScript"
    );

    let mut files: Vec<String> = TOP_FILES.iter().map(|file| file.to_string()).collect();
    for folder in FOLDERS {
        files.extend(files_under(&web, &web.join(folder)));
    }

    let out = PathBuf::from(env::var("OUT_DIR").expect("cargo sets OUT_DIR"));
    fs::write(out.join("web_files.rs"), file_list(&web, &files))
        .expect("could not write the file list");
}
