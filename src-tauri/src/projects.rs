//! Project discovery and git inspection.

use crate::system::dirs_home;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectMarkers {
    pub project_name: String,
    pub project_type: String,
    pub markers_found: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoInfo {
    pub name: String,
    pub path: String,
}

// Scan a directory for project marker files (.git, package.json, Cargo.toml, etc.)
#[tauri::command]
pub(crate) fn scan_project_markers(dir_path: String) -> Result<ProjectMarkers, String> {
    let dir = Path::new(&dir_path);
    if !dir.is_dir() {
        return Err(format!("Not a directory: {}", dir_path));
    }

    // Order matters: first non-git match sets the project_type.
    // .git is checked last so specific types take precedence.
    let marker_checks: Vec<(&str, &str)> = vec![
        ("Cargo.toml", "rust"),
        ("package.json", "node"),
        ("pyproject.toml", "python"),
        ("setup.py", "python"),
        ("requirements.txt", "python"),
        ("go.mod", "go"),
        ("pubspec.yaml", "flutter"),
        ("pom.xml", "java"),
        ("build.gradle", "java"),
        ("*.sln", "dotnet"),
        ("*.csproj", "dotnet"),
        ("Gemfile", "ruby"),
        ("composer.json", "php"),
        ("CMakeLists.txt", "cmake"),
        ("Makefile", "make"),
        ("*.ipynb", "datascience"),
        ("index.html", "web"),
        (".git", "git"),
    ];

    let mut markers_found = Vec::new();
    let mut project_type = String::from("unknown");

    for (marker, ptype) in &marker_checks {
        if let Some(ext) = marker.strip_prefix('*') {
            // Glob-style check: look for any file matching the extension (e.g. ".sln")
            if let Ok(entries) = std::fs::read_dir(dir) {
                for entry in entries.flatten() {
                    if let Some(name) = entry.file_name().to_str() {
                        if name.ends_with(ext) {
                            markers_found.push(name.to_string());
                            if project_type == "unknown" {
                                project_type = ptype.to_string();
                            }
                            break;
                        }
                    }
                }
            }
        } else {
            let marker_path = dir.join(marker);
            if marker_path.exists() {
                markers_found.push(marker.to_string());
                if project_type == "unknown" {
                    project_type = ptype.to_string();
                }
            }
        }
    }

    if markers_found.is_empty() {
        return Err("No project markers found".to_string());
    }

    // Derive project name from directory name
    let project_name = dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    Ok(ProjectMarkers {
        project_name,
        project_type,
        markers_found,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredProject {
    pub name: String,
    pub path: String,
    pub project_type: String,
    pub markers_found: Vec<String>,
}

// Recursively scan directories for coding projects up to a depth limit.
// Skips common build artifact and dependency directories for speed.
// Async with the walk on a blocking thread so it never stalls the main thread.
#[tauri::command]
pub(crate) async fn scan_directories_for_projects(
    search_paths: Vec<String>,
    max_depth: u32,
) -> Vec<DiscoveredProject> {
    tauri::async_runtime::spawn_blocking(move || {
        scan_directories_for_projects_blocking(search_paths, max_depth)
    })
    .await
    .unwrap_or_default()
}

pub(crate) fn scan_directories_for_projects_blocking(
    search_paths: Vec<String>,
    max_depth: u32,
) -> Vec<DiscoveredProject> {
    let home = dirs_home();
    let mut projects = Vec::new();
    let mut seen_paths: std::collections::HashSet<String> = std::collections::HashSet::new();

    let ignore_dirs: std::collections::HashSet<&str> = [
        "node_modules",
        ".node_modules",
        "venv",
        ".venv",
        "env",
        "target",
        "build",
        "dist",
        "out",
        ".output",
        ".next",
        ".nuxt",
        "__pycache__",
        ".cache",
        ".gradle",
        ".m2",
        ".cargo",
        ".git",
        ".svn",
        ".hg",
        "$Recycle.Bin",
        "System Volume Information",
        "AppData",
        "Library",
        ".Trash",
        ".idea",
        ".vs",
        ".vscode",
    ]
    .iter()
    .copied()
    .collect();

    let marker_checks: Vec<(&str, &str)> = vec![
        ("Cargo.toml", "rust"),
        ("package.json", "node"),
        ("pyproject.toml", "python"),
        ("setup.py", "python"),
        ("requirements.txt", "python"),
        ("go.mod", "go"),
        ("pubspec.yaml", "flutter"),
        ("pom.xml", "java"),
        ("build.gradle", "java"),
        ("Gemfile", "ruby"),
        ("composer.json", "php"),
        ("CMakeLists.txt", "cmake"),
        ("Makefile", "make"),
        ("index.html", "web"),
        (".git", "git"),
    ];

    for search in &search_paths {
        let resolved = if search.starts_with("~/") || search.starts_with("~\\") {
            match &home {
                Some(h) => h.join(&search[2..]),
                None => continue,
            }
        } else if search == "~" {
            match &home {
                Some(h) => h.clone(),
                None => continue,
            }
        } else {
            PathBuf::from(search)
        };

        if !resolved.is_dir() {
            continue;
        }

        // Iterative stack-based depth-limited traversal
        let mut stack: Vec<(PathBuf, u32)> = vec![(resolved, 0)];

        while let Some((dir, depth)) = stack.pop() {
            if depth > max_depth {
                continue;
            }

            let dir_str = dir.to_string_lossy().to_string();
            if seen_paths.contains(&dir_str) {
                continue;
            }
            seen_paths.insert(dir_str);

            // Check this directory for project markers
            let mut markers_found = Vec::new();
            let mut project_type = String::new();

            for (marker, ptype) in &marker_checks {
                let marker_path = dir.join(marker);
                if marker_path.exists() {
                    markers_found.push(marker.to_string());
                    if project_type.is_empty() {
                        project_type = ptype.to_string();
                    }
                }
            }

            // Also check for glob-style markers (*.sln, *.csproj, *.ipynb)
            if let Ok(entries) = std::fs::read_dir(&dir) {
                for entry in entries.flatten() {
                    if let Some(name) = entry.file_name().to_str() {
                        if name.ends_with(".sln") || name.ends_with(".csproj") {
                            markers_found.push(name.to_string());
                            if project_type.is_empty() {
                                project_type = "dotnet".to_string();
                            }
                        } else if name.ends_with(".ipynb") {
                            markers_found.push(name.to_string());
                            if project_type.is_empty() {
                                project_type = "datascience".to_string();
                            }
                        }
                    }
                }
            }

            if !markers_found.is_empty() {
                let name = dir
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("unknown")
                    .to_string();

                projects.push(DiscoveredProject {
                    name,
                    path: dir.to_string_lossy().to_string(),
                    project_type,
                    markers_found,
                });

                // Don't recurse into discovered projects (they are leaf nodes)
                continue;
            }

            // If not a project, recurse into subdirectories
            if depth < max_depth {
                if let Ok(entries) = std::fs::read_dir(&dir) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if path.is_dir() {
                            if let Some(dir_name) = path.file_name().and_then(|n| n.to_str()) {
                                if !ignore_dirs.contains(dir_name) && !dir_name.starts_with('.') {
                                    stack.push((path, depth + 1));
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    projects
}

// Recursively scan a directory up to `depth` levels for git repos.
pub(crate) fn collect_git_repos(dir: &Path, depth: u32, repos: &mut Vec<RepoInfo>) {
    let ignore: &[&str] = &[
        "node_modules",
        "target",
        "__pycache__",
        "venv",
        ".venv",
        "dist",
        "build",
        ".next",
        "vendor",
        "Pods",
    ];
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        // Skip hidden dirs and noisy build/dependency dirs
        if name.starts_with('.') || ignore.contains(&name.as_str()) {
            continue;
        }

        if path.join(".git").exists() {
            repos.push(RepoInfo {
                name,
                path: path.to_string_lossy().to_string(),
            });
            // Don't recurse into repos — nested .git is unusual and expensive
            continue;
        }
        if depth > 1 {
            collect_git_repos(&path, depth - 1, repos);
        }
    }
}

// Scan configured directories for git repositories, up to 4 levels deep.
// Catches repos nested several folders deep, e.g. ~/Desktop/work/projects/my-repo.
#[tauri::command]
pub(crate) async fn get_recent_git_repos(search_paths: Vec<String>) -> Vec<RepoInfo> {
    tauri::async_runtime::spawn_blocking(move || get_recent_git_repos_blocking(search_paths))
        .await
        .unwrap_or_default()
}

pub(crate) fn get_recent_git_repos_blocking(search_paths: Vec<String>) -> Vec<RepoInfo> {
    let mut repos = Vec::new();
    let home = dirs_home();

    for search in &search_paths {
        let resolved = if let Some(rest) = search.strip_prefix("~/") {
            match &home {
                Some(h) => h.join(rest),
                None => continue,
            }
        } else {
            PathBuf::from(search)
        };

        if !resolved.is_dir() {
            continue;
        }

        // If the user pasted the repo root itself (e.g. C:\code\my-project),
        // add it directly instead of only scanning its children.
        if resolved.join(".git").exists() {
            if let Some(name) = resolved.file_name().and_then(|n| n.to_str()) {
                repos.push(RepoInfo {
                    name: name.to_string(),
                    path: resolved.to_string_lossy().to_string(),
                });
            }
        } else {
            // Otherwise treat it as a parent folder and scan up to 4 levels deep.
            collect_git_repos(&resolved, 4, &mut repos);
        }
    }

    repos
}

// Helper: run a git command in a working directory and return stdout on success.
pub(crate) fn run_git(cwd: &str, args: &[&str]) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let mut cmd = std::process::Command::new("git");
    cmd.current_dir(cwd).args(args);

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitInfo {
    pub hash: String,
    pub message: String,
    pub author: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitInfo {
    pub repo_name: String,
    pub git_root: String,
    pub branch: String,
    pub recent_commits: Vec<CommitInfo>,
    pub has_uncommitted_changes: bool,
    pub uncommitted_count: usize,
    pub remote_url: Option<String>,
}

/// Gather git info for the repository containing `path`.
/// Returns the repo name, current branch, recent commits, and remote URL.
#[tauri::command]
pub(crate) async fn get_git_info(path: String) -> Result<GitInfo, String> {
    tauri::async_runtime::spawn_blocking(move || get_git_info_blocking(path))
        .await
        .map_err(|e| e.to_string())?
}

pub(crate) fn get_git_info_blocking(path: String) -> Result<GitInfo, String> {
    let git_root =
        run_git(&path, &["rev-parse", "--show-toplevel"]).map(|s| s.trim().to_string())?;

    let repo_name = Path::new(&git_root)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    let branch = run_git(&git_root, &["rev-parse", "--abbrev-ref", "HEAD"])
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|_| "unknown".to_string());

    // Format: hash|subject|author|ISO date
    let log_raw = run_git(&git_root, &["log", "--format=%H|%s|%an|%ai", "-5"]).unwrap_or_default();

    let recent_commits = log_raw
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|line| {
            let parts: Vec<&str> = line.splitn(4, '|').collect();
            CommitInfo {
                hash: parts.first().unwrap_or(&"").chars().take(8).collect(),
                message: parts.get(1).unwrap_or(&"").to_string(),
                author: parts.get(2).unwrap_or(&"").to_string(),
                timestamp: parts.get(3).unwrap_or(&"").to_string(),
            }
        })
        .collect();

    let status = run_git(&git_root, &["status", "--porcelain"]).unwrap_or_default();
    let has_uncommitted_changes = !status.trim().is_empty();
    let uncommitted_count = status.lines().filter(|l| !l.trim().is_empty()).count();

    let remote_url = run_git(&git_root, &["remote", "get-url", "origin"])
        .ok()
        .map(|u| u.trim().to_string())
        .filter(|u| !u.is_empty());

    Ok(GitInfo {
        repo_name,
        git_root,
        branch,
        recent_commits,
        has_uncommitted_changes,
        uncommitted_count,
        remote_url,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_project(name: &str, files: &[&str]) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("drvibe-proj-{}-{}", std::process::id(), name));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        for f in files {
            if f.ends_with('/') {
                std::fs::create_dir_all(dir.join(f)).unwrap();
            } else {
                std::fs::write(dir.join(f), "").unwrap();
            }
        }
        dir
    }

    #[test]
    fn rust_project_wins_over_git_marker() {
        let dir = temp_project("rust", &["Cargo.toml", ".git/"]);
        let m = scan_project_markers(dir.to_string_lossy().into_owned()).unwrap();
        assert_eq!(m.project_type, "rust");
        assert!(m.markers_found.contains(&"Cargo.toml".to_string()));
        assert!(m.markers_found.contains(&".git".to_string()));
        assert_eq!(m.project_name, dir.file_name().unwrap().to_string_lossy());
    }

    #[test]
    fn glob_markers_match_by_extension() {
        let dir = temp_project("dotnet", &["App.sln"]);
        let m = scan_project_markers(dir.to_string_lossy().into_owned()).unwrap();
        assert_eq!(m.project_type, "dotnet");
        assert_eq!(m.markers_found, vec!["App.sln".to_string()]);
    }

    #[test]
    fn plain_folder_is_not_a_project() {
        let dir = temp_project("plain", &["notes.txt"]);
        assert!(scan_project_markers(dir.to_string_lossy().into_owned()).is_err());
    }

    fn git_available() -> bool {
        std::process::Command::new("git")
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    #[test]
    fn git_info_reads_branch_commits_and_changes() {
        if !git_available() {
            eprintln!("git not installed; skipping");
            return;
        }
        let dir = temp_project("git", &[]);
        let path = dir.to_string_lossy().into_owned();
        let git = |args: &[&str]| run_git(&path, args).unwrap();
        git(&["init", "-q", "-b", "main"]);
        git(&["config", "user.email", "test@example.com"]);
        git(&["config", "user.name", "Test"]);
        std::fs::write(dir.join("a.txt"), "hello").unwrap();
        git(&["add", "."]);
        git(&["commit", "-q", "-m", "first commit"]);
        std::fs::write(dir.join("b.txt"), "dirty").unwrap();

        let info = get_git_info_blocking(path).unwrap();
        assert_eq!(info.branch, "main");
        assert_eq!(info.recent_commits.len(), 1);
        assert_eq!(info.recent_commits[0].message, "first commit");
        assert_eq!(info.recent_commits[0].hash.len(), 8);
        assert!(info.has_uncommitted_changes);
        assert_eq!(info.uncommitted_count, 1);
        assert_eq!(info.remote_url, None);
    }
}
