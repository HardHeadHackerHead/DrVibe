//! Test fixtures. Every test that needs files on disk gets them from
//! `TempDir`, which removes its folder when dropped, panics included, so a
//! test run leaves nothing behind in the system temp folder.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

/// Prefix of every fixture folder. Unique per process and per call, so tests
/// running in parallel never share one.
const PREFIX: &str = "drvibe-fixture-";

static NEXT: AtomicU32 = AtomicU32::new(0);

pub(crate) struct TempDir {
    path: PathBuf,
}

impl TempDir {
    /// Creates an empty folder `drvibe-fixture-<name>-<pid>-<n>` in the temp folder.
    pub(crate) fn new(name: &str) -> Self {
        let n = NEXT.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!("{PREFIX}{name}-{}-{n}", std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        Self { path }
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }

    pub(crate) fn join(&self, rel: impl AsRef<Path>) -> PathBuf {
        self.path.join(rel)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

/// Anything of ours (`drvibe-…`/`dr-vibe-…` naming the pid) the test process
/// `pid` left in the temp folder, whether it came from `TempDir` or not.
pub(crate) fn leftovers(pid: u32) -> Vec<PathBuf> {
    let pid = pid.to_string();
    std::fs::read_dir(std::env::temp_dir())
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.file_name().and_then(|n| n.to_str()).is_some_and(|n| {
                (n.starts_with("drvibe-") || n.starts_with("dr-vibe-"))
                    && n.split('-').any(|part| part == pid)
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn removed_when_dropped() {
        let dir = TempDir::new("drop");
        std::fs::write(dir.join("a.txt"), "x").unwrap();
        let path = dir.path().to_path_buf();
        drop(dir);
        assert!(!path.exists());
    }

    #[test]
    fn removed_when_the_test_panics() {
        let path = std::sync::Mutex::new(PathBuf::new());
        let result = std::panic::catch_unwind(|| {
            let dir = TempDir::new("panic");
            *path.lock().unwrap() = dir.path().to_path_buf();
            panic!("test failure");
        });
        assert!(result.is_err());
        let path = path.into_inner().unwrap();
        assert!(!path.as_os_str().is_empty());
        assert!(!path.exists());
    }

    /// Runs every other test in a child process, then looks for fixture
    /// folders that child left behind.
    #[test]
    fn test_suite_leaves_nothing_in_temp() {
        if std::env::var_os("DRVIBE_SUITE_CHILD").is_some() {
            return;
        }
        let child = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--skip", "test_suite_leaves_nothing_in_temp", "--quiet"])
            .env("DRVIBE_SUITE_CHILD", "1")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        let pid = child.id();
        let output = child.wait_with_output().unwrap();
        assert!(
            output.status.success(),
            "child test run failed:
{}",
            String::from_utf8_lossy(&output.stdout)
        );
        let left = leftovers(pid);
        assert!(left.is_empty(), "left in temp: {left:?}");
    }
}
