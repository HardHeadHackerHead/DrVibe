//! The common subset of `.gitignore` rules, so build output a repo ignores
//! never counts as files changed.
//!
//! Supported: blank lines and `#` comments, `!` negation, trailing `/` for
//! directories, anchored patterns (a `/` anywhere but the end), `*`, `?`,
//! `[...]` classes, `**` segments, `\` escapes, nested `.gitignore` files and
//! `.git/info/exclude`. A path inside an ignored directory stays ignored even
//! if a later rule negates it, as in git. Not supported: `core.excludesFile`.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

#[derive(Debug, Clone)]
pub(crate) struct Rule {
    segments: Vec<String>,
    negated: bool,
    dir_only: bool,
    anchored: bool,
}

impl Rule {
    pub(crate) fn parse(line: &str) -> Option<Rule> {
        let line = line.trim_end_matches(['\r', '\n']);
        // Trailing spaces are ignored unless escaped
        let line = if line.ends_with("\\ ") {
            line
        } else {
            line.trim_end_matches(' ')
        };
        if line.is_empty() || line.starts_with('#') {
            return None;
        }
        let (negated, rest) = match line.strip_prefix('!') {
            Some(r) => (true, r),
            None => (
                false,
                line.strip_prefix('\\')
                    .filter(|r| r.starts_with(['#', '!']))
                    .unwrap_or(line),
            ),
        };
        let (dir_only, rest) = match rest.strip_suffix('/') {
            Some(r) => (true, r),
            None => (false, rest),
        };
        let anchored = rest.contains('/');
        let rest = rest.strip_prefix('/').unwrap_or(rest);
        if rest.is_empty() {
            return None;
        }
        Some(Rule {
            segments: rest.split('/').map(str::to_string).collect(),
            negated,
            dir_only,
            anchored,
        })
    }

    /// Does this rule match `rel` (path components below the rule's
    /// `.gitignore` directory)?
    fn matches(&self, rel: &[&str], is_dir: bool) -> bool {
        if self.dir_only && !is_dir {
            return false;
        }
        if self.anchored {
            segments_match(&self.segments, rel)
        } else {
            rel.last()
                .is_some_and(|name| wildcard_match(&self.segments[0], name))
        }
    }
}

pub(crate) fn parse_rules(text: &str) -> Vec<Rule> {
    text.lines().filter_map(Rule::parse).collect()
}

fn segments_match(pattern: &[String], path: &[&str]) -> bool {
    match pattern.split_first() {
        None => path.is_empty(),
        Some((first, rest)) if first == "**" => {
            (0..=path.len()).any(|skip| segments_match(rest, &path[skip..]))
        }
        Some((first, rest)) => {
            !path.is_empty() && wildcard_match(first, path[0]) && segments_match(rest, &path[1..])
        }
    }
}

/// Glob match within one path segment: `*`, `?`, `[a-z]`, `[!x]`, `\x`.
pub(crate) fn wildcard_match(pattern: &str, text: &str) -> bool {
    let p: Vec<char> = pattern.chars().collect();
    let t: Vec<char> = text.chars().collect();
    wild(&p, &t)
}

fn wild(p: &[char], t: &[char]) -> bool {
    let (mut pi, mut ti) = (0, 0);
    let mut star: Option<(usize, usize)> = None;
    while ti < t.len() {
        if pi < p.len() {
            match p[pi] {
                '*' => {
                    star = Some((pi, ti));
                    pi += 1;
                    continue;
                }
                '?' => {
                    pi += 1;
                    ti += 1;
                    continue;
                }
                '[' => {
                    if let Some((matched, next)) = class_match(p, pi, t[ti]) {
                        if matched {
                            pi = next;
                            ti += 1;
                            continue;
                        }
                    } else if t[ti] == '[' {
                        // Unterminated class: a literal '['
                        pi += 1;
                        ti += 1;
                        continue;
                    }
                }
                '\\' if pi + 1 < p.len() => {
                    if p[pi + 1] == t[ti] {
                        pi += 2;
                        ti += 1;
                        continue;
                    }
                }
                c if c == t[ti] => {
                    pi += 1;
                    ti += 1;
                    continue;
                }
                _ => {}
            }
        }
        // Mismatch: let the last `*` swallow one more character
        match star {
            Some((sp, st)) => {
                pi = sp + 1;
                ti = st + 1;
                star = Some((sp, st + 1));
            }
            None => return false,
        }
    }
    p[pi..].iter().all(|&c| c == '*')
}

/// `[...]` at `p[start]`: Some((matches c, index after `]`)), None if unterminated.
fn class_match(p: &[char], start: usize, c: char) -> Option<(bool, usize)> {
    let mut i = start + 1;
    let negate = matches!(p.get(i), Some('!') | Some('^'));
    if negate {
        i += 1;
    }
    let mut matched = false;
    let mut first = true;
    while i < p.len() {
        if p[i] == ']' && !first {
            return Some((matched != negate, i + 1));
        }
        first = false;
        if i + 2 < p.len() && p[i + 1] == '-' && p[i + 2] != ']' {
            if p[i] <= c && c <= p[i + 2] {
                matched = true;
            }
            i += 3;
        } else {
            if p[i] == c {
                matched = true;
            }
            i += 1;
        }
    }
    None
}

/// Cached `.gitignore` rules for the repos under the watched folders.
/// Each directory's file is read once, on first need, and re-read after an
/// event says it changed.
#[derive(Default)]
pub(crate) struct GitignoreCache {
    rules: HashMap<PathBuf, Option<Arc<Vec<Rule>>>>,
    repo_roots: HashMap<PathBuf, Option<PathBuf>>,
}

const CACHE_LIMIT: usize = 20_000;

impl GitignoreCache {
    /// Forget cached state that `changed` may have made stale.
    pub(crate) fn note_change(&mut self, changed: &Path) {
        match changed.file_name().and_then(|n| n.to_str()) {
            Some(".gitignore") => {
                if let Some(dir) = changed.parent() {
                    self.rules.remove(dir);
                }
            }
            Some("exclude") => {
                if let Some(info) = changed.parent() {
                    self.rules.remove(info);
                }
            }
            Some(".git") => self.repo_roots.clear(),
            _ => {}
        }
    }

    /// Is `path` ignored by its repo's `.gitignore` files? False outside a repo.
    pub(crate) fn is_ignored(&mut self, path: &Path, is_dir: impl Fn() -> bool) -> bool {
        let Some(parent) = path.parent() else {
            return false;
        };
        let Some(root) = self.repo_root(parent) else {
            return false;
        };
        let Ok(rel) = path.strip_prefix(&root) else {
            return false;
        };
        let comps: Vec<&str> = rel
            .components()
            .filter_map(|c| c.as_os_str().to_str())
            .collect();
        if comps.is_empty() {
            return false;
        }

        // Rule sets from lowest to highest precedence: info/exclude, then
        // .gitignore from the repo root down. Each comes with its depth.
        let mut sets: Vec<(usize, Arc<Vec<Rule>>)> = Vec::new();
        if let Some(r) = self.load(&root.join(".git").join("info"), "exclude") {
            sets.push((0, r));
        }
        let mut dir = root.clone();
        for (depth, comp) in comps.iter().enumerate() {
            if let Some(r) = self.load(&dir, ".gitignore") {
                sets.push((depth, r));
            }
            dir.push(comp);
        }

        let mut final_is_dir: Option<bool> = None;
        for k in 1..=comps.len() {
            let prefix = &comps[..k];
            let item_is_dir = if k < comps.len() {
                true
            } else {
                *final_is_dir.get_or_insert_with(&is_dir)
            };
            let mut ignored = false;
            // A .gitignore at depth d applies to items below it (k > d).
            for (depth, rules) in sets.iter().filter(|(d, _)| *d < k) {
                for rule in rules.iter() {
                    if rule.matches(&prefix[*depth..], item_is_dir) {
                        ignored = !rule.negated;
                    }
                }
            }
            if ignored {
                return true;
            }
        }
        false
    }

    fn load(&mut self, dir: &Path, file: &str) -> Option<Arc<Vec<Rule>>> {
        if self.rules.len() > CACHE_LIMIT {
            self.rules.clear();
        }
        self.rules
            .entry(dir.to_path_buf())
            .or_insert_with(|| {
                let text = std::fs::read_to_string(dir.join(file)).ok()?;
                let rules = parse_rules(&text);
                (!rules.is_empty()).then(|| Arc::new(rules))
            })
            .clone()
    }

    /// Nearest ancestor (or `dir` itself) holding `.git`.
    fn repo_root(&mut self, dir: &Path) -> Option<PathBuf> {
        if self.repo_roots.len() > CACHE_LIMIT {
            self.repo_roots.clear();
        }
        let mut visited = Vec::new();
        let mut found = None;
        let mut current = Some(dir);
        while let Some(d) = current {
            if let Some(cached) = self.repo_roots.get(d) {
                found = cached.clone();
                break;
            }
            visited.push(d.to_path_buf());
            if d.join(".git").exists() {
                found = Some(d.to_path_buf());
                break;
            }
            current = d.parent();
        }
        for v in visited {
            self.repo_roots.insert(v, found.clone());
        }
        found
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wildcards() {
        assert!(wildcard_match("*.log", "debug.log"));
        assert!(!wildcard_match("*.log", "debug.log.txt"));
        assert!(wildcard_match("a?c", "abc"));
        assert!(wildcard_match("[abc]x", "bx"));
        assert!(!wildcard_match("[!abc]x", "bx"));
        assert!(wildcard_match("file[0-9].txt", "file7.txt"));
        assert!(wildcard_match("*", "anything"));
        assert!(wildcard_match("\\*star", "*star"));
        assert!(!wildcard_match("\\*star", "xstar"));
        assert!(wildcard_match("a*b*c", "aXXbYYc"));
    }

    fn rule(line: &str) -> Rule {
        Rule::parse(line).unwrap()
    }

    #[test]
    fn rule_parsing_and_matching() {
        assert!(Rule::parse("# comment").is_none());
        assert!(Rule::parse("   ").is_none());
        assert!(Rule::parse("/").is_none());

        let unanchored = rule("*.o");
        assert!(unanchored.matches(&["deep", "x.o"], false));

        let anchored = rule("/dist");
        assert!(anchored.matches(&["dist"], true));
        assert!(!anchored.matches(&["web", "dist"], true));

        let middle = rule("docs/*.html");
        assert!(middle.matches(&["docs", "a.html"], false));
        assert!(!middle.matches(&["x", "docs", "a.html"], false));

        let dir_only = rule("logs/");
        assert!(dir_only.matches(&["a", "logs"], true));
        assert!(!dir_only.matches(&["a", "logs"], false));

        let globstar = rule("**/gen/*.json");
        assert!(globstar.matches(&["gen", "a.json"], false));
        assert!(globstar.matches(&["a", "b", "gen", "a.json"], false));
        let inside = rule("out/**");
        assert!(inside.matches(&["out", "a", "b"], false));

        let neg = rule("!keep.log");
        assert!(neg.negated);
        let literal = rule("\\#notes");
        assert!(literal.matches(&["#notes"], false));
    }
}
