//! Project discovery and git inspection.

use crate::repos::{git_repo_paths, repo_name};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectMarkers {
    pub project_name: String,
    pub project_type: String,
    pub markers_found: Vec<String>,
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
    /// First 8 chars of the hash: local display and new-commit checks only.
    pub hash: String,
    /// What a `GIT_COMMIT` event carries instead of the hash:
    /// [`commit_event_id`] keyed by the linked account's user id; None while
    /// unlinked (no events are sent then).
    pub event_id: Option<String>,
    pub message: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitInfo {
    /// Name of the repo; a linked worktree reports its main repo's name.
    pub repo_name: String,
    /// The working tree containing the path.
    pub git_root: String,
    /// The main worktree: the repo's identity.
    pub repo_root: String,
    pub branch: String,
    pub recent_commits: Vec<CommitInfo>,
    pub has_uncommitted_changes: bool,
    pub uncommitted_count: usize,
}

/// Gather git info for the repository containing `path`: the repo name,
/// current branch, recent commits and the uncommitted count. No remote URL
/// and no author: nothing uses them, and a remote can embed credentials.
#[tauri::command]
pub(crate) async fn get_git_info(
    path: String,
    app_handle: tauri::AppHandle,
) -> Result<GitInfo, String> {
    // The linked account's user id: the same commit gets the same id on all
    // of the player's computers. Unlinked: no id (no events are sent then).
    let user_id = crate::account::get_profile(app_handle)
        .get("userId")
        .and_then(|v| v.as_str())
        .map(String::from)
        .filter(|id| !id.is_empty());
    tauri::async_runtime::spawn_blocking(move || get_git_info_blocking(path, user_id.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}

/// What a `GIT_COMMIT` event carries instead of the commit hash: the first
/// 16 lowercase hex chars of `HMAC-SHA256(key = user_id, msg = sha)`, where
/// `sha` is the full commit hash as git prints it (drvibe-protocol
/// `EconomyEventType::GitCommit`).
pub(crate) fn commit_event_id(user_id: &str, sha: &str) -> String {
    use hmac::{Hmac, Mac};
    let mut mac = Hmac::<sha2::Sha256>::new_from_slice(user_id.as_bytes())
        .expect("HMAC accepts any key length");
    mac.update(sha.trim().to_ascii_lowercase().as_bytes());
    mac.finalize()
        .into_bytes()
        .iter()
        .take(8)
        .map(|b| format!("{b:02x}"))
        .collect()
}

pub(crate) fn get_git_info_blocking(
    path: String,
    user_id: Option<&str>,
) -> Result<GitInfo, String> {
    let (toplevel, root) = git_repo_paths(Path::new(&path))?;
    let git_root = toplevel.to_string_lossy().into_owned();
    let repo_name = repo_name(&root);
    let repo_root = root.to_string_lossy().into_owned();

    let branch = run_git(&git_root, &["rev-parse", "--abbrev-ref", "HEAD"])
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|_| "unknown".to_string());

    // Format: hash|ISO date|subject (the subject last: it may contain '|')
    let log_raw = run_git(&git_root, &["log", "--format=%H|%ai|%s", "-5"]).unwrap_or_default();

    let recent_commits = log_raw
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|line| {
            let parts: Vec<&str> = line.splitn(3, '|').collect();
            let sha = parts.first().unwrap_or(&"").trim();
            CommitInfo {
                hash: sha.chars().take(8).collect(),
                event_id: user_id
                    .filter(|_| !sha.is_empty())
                    .map(|id| commit_event_id(id, sha)),
                timestamp: parts.get(1).unwrap_or(&"").to_string(),
                message: parts.get(2).unwrap_or(&"").to_string(),
            }
        })
        .collect();

    let status = run_git(&git_root, &["status", "--porcelain"]).unwrap_or_default();
    let has_uncommitted_changes = !status.trim().is_empty();
    let uncommitted_count = status.lines().filter(|l| !l.trim().is_empty()).count();

    Ok(GitInfo {
        repo_name,
        git_root,
        repo_root,
        branch,
        recent_commits,
        has_uncommitted_changes,
        uncommitted_count,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::TempDir;

    #[test]
    fn commit_ids_are_keyed_and_short() {
        let sha = "0123456789abcdef0123456789abcdef01234567";
        let id = commit_event_id("install-a", sha);
        // Python: hmac.new(b"install-a", sha.encode(), hashlib.sha256).hexdigest()[:16]
        assert_eq!(id, "acae9402f1cc3212");
        assert_eq!(
            id,
            commit_event_id("install-a", &format!(" {} ", sha.to_uppercase()))
        );
        assert_ne!(
            id,
            commit_event_id("user-b", sha),
            "another account gets another id"
        );
    }

    /// A project folder (removed when dropped).
    fn temp_project(name: &str, files: &[&str]) -> TempDir {
        let dir = TempDir::new(&format!("proj-{name}"));
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
        let m = scan_project_markers(dir.path().to_string_lossy().into_owned()).unwrap();
        assert_eq!(m.project_type, "rust");
        assert!(m.markers_found.contains(&"Cargo.toml".to_string()));
        assert!(m.markers_found.contains(&".git".to_string()));
        assert_eq!(
            m.project_name,
            dir.path().file_name().unwrap().to_string_lossy()
        );
    }

    #[test]
    fn glob_markers_match_by_extension() {
        let dir = temp_project("dotnet", &["App.sln"]);
        let m = scan_project_markers(dir.path().to_string_lossy().into_owned()).unwrap();
        assert_eq!(m.project_type, "dotnet");
        assert_eq!(m.markers_found, vec!["App.sln".to_string()]);
    }

    #[test]
    fn plain_folder_is_not_a_project() {
        let dir = temp_project("plain", &["notes.txt"]);
        assert!(scan_project_markers(dir.path().to_string_lossy().into_owned()).is_err());
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
        let tmp = temp_project("git", &[]);
        let dir = tmp.path();
        let path = dir.to_string_lossy().into_owned();
        let git = |args: &[&str]| run_git(&path, args).unwrap();
        git(&["init", "-q", "-b", "main"]);
        git(&["config", "user.email", "test@example.com"]);
        git(&["config", "user.name", "Test"]);
        std::fs::write(dir.join("a.txt"), "hello").unwrap();
        git(&["add", "."]);
        git(&["commit", "-q", "-m", "first commit"]);
        std::fs::write(dir.join("b.txt"), "dirty").unwrap();

        let info = get_git_info_blocking(path.clone(), Some("install-a")).unwrap();
        assert_eq!(info.branch, "main");
        assert_eq!(info.recent_commits.len(), 1);
        assert_eq!(info.recent_commits[0].message, "first commit");
        assert_eq!(info.recent_commits[0].hash.len(), 8);
        let full = git(&["rev-parse", "HEAD"]);
        assert_eq!(
            info.recent_commits[0].event_id.as_deref(),
            Some(commit_event_id("install-a", full.trim()).as_str())
        );
        assert!(!full.starts_with(info.recent_commits[0].event_id.as_deref().unwrap()));
        assert!(info.has_uncommitted_changes);
        assert_eq!(info.uncommitted_count, 1);
        let json = serde_json::to_value(&info).unwrap();
        assert!(
            json.get("remote_url").is_none() && json["recent_commits"][0].get("author").is_none()
        );
        assert_eq!(info.repo_name, dir.file_name().unwrap().to_string_lossy());

        // A linked worktree reports its main repo's name and root
        let wt = dir.join("wt-fix");
        git(&["worktree", "add", "-q", "-b", "fix", &wt.to_string_lossy()]);
        let info = get_git_info_blocking(wt.to_string_lossy().into_owned(), None).unwrap();
        assert_eq!(info.recent_commits[0].event_id, None);
        assert_eq!(info.branch, "fix");
        assert_eq!(info.repo_name, dir.file_name().unwrap().to_string_lossy());
        assert!(info.git_root.ends_with("wt-fix"), "{}", info.git_root);
        assert!(!info.repo_root.ends_with("wt-fix"), "{}", info.repo_root);
    }
}
