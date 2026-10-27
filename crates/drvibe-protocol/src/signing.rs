//! Request signing and PKCE helpers (feature `signing`).
//!
//! A signed desktop request carries, besides `Authorization: Bearer <token>`:
//!
//! - `X-DrVibe-Timestamp`: unix seconds, within 300 s of server time
//! - `X-DrVibe-Nonce`: 16-64 chars of `[A-Za-z0-9_-]`, never reused
//! - `X-DrVibe-Signature`: `hex(HMAC-SHA256(key = token, msg = canonical))`
//!
//! where `canonical` is built by [`canonical_request`]. The server stores
//! each nonce for 10 minutes and rejects repeats, so a captured request
//! cannot be replayed.

use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};

type HmacSha256 = Hmac<Sha256>;

/// Lowercase hex SHA-256 of `bytes`.
pub fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// The string that gets signed:
/// `METHOD \n path_and_query \n timestamp \n nonce \n hex(sha256(body))`.
///
/// `path_and_query` is the request path as sent, e.g. `/api/v1/desktop/sync`
/// (with `?query` when present). `method` is uppercased.
pub fn canonical_request(method: &str, path_and_query: &str, timestamp: i64, nonce: &str, body: &[u8]) -> String {
    format!("{}\n{}\n{}\n{}\n{}", method.to_ascii_uppercase(), path_and_query, timestamp, nonce, sha256_hex(body))
}

/// Hex HMAC-SHA256 signature of a request, keyed by the device token.
pub fn sign_request(
    token: &str,
    method: &str,
    path_and_query: &str,
    timestamp: i64,
    nonce: &str,
    body: &[u8],
) -> String {
    let mut mac = HmacSha256::new_from_slice(token.as_bytes()).expect("HMAC accepts any key length");
    mac.update(canonical_request(method, path_and_query, timestamp, nonce, body).as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

/// Constant-time check of a hex signature produced by [`sign_request`].
pub fn verify_request(
    token: &str,
    method: &str,
    path_and_query: &str,
    timestamp: i64,
    nonce: &str,
    body: &[u8],
    signature_hex: &str,
) -> bool {
    let Ok(sig) = hex::decode(signature_hex) else {
        return false;
    };
    let mut mac = HmacSha256::new_from_slice(token.as_bytes()).expect("HMAC accepts any key length");
    mac.update(canonical_request(method, path_and_query, timestamp, nonce, body).as_bytes());
    mac.verify_slice(&sig).is_ok()
}

/// The id a `GIT_COMMIT` event carries instead of the commit hash: the first
/// 16 lowercase hex chars of `HMAC-SHA256(key = install_id, msg = sha)`,
/// where `sha` is the full commit hash as git prints it. Stable per install,
/// so the server can still de-duplicate, but it cannot be looked up in a
/// public repo.
pub fn commit_event_id(install_id: &str, sha: &str) -> String {
    let mut mac = HmacSha256::new_from_slice(install_id.as_bytes()).expect("HMAC accepts any key length");
    mac.update(sha.trim().to_ascii_lowercase().as_bytes());
    let mut id = hex::encode(mac.finalize().into_bytes());
    id.truncate(16);
    id
}

/// True if `nonce` has an acceptable length and alphabet.
pub fn nonce_is_well_formed(nonce: &str) -> bool {
    (16..=64).contains(&nonce.len()) && nonce.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// PKCE S256 challenge: base64url(SHA-256(verifier)) without padding.
pub fn pkce_challenge(code_verifier: &str) -> String {
    base64url(&Sha256::digest(code_verifier.as_bytes()))
}

fn base64url(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = match chunk.len() {
            3 => (chunk[0] as u32) << 16 | (chunk[1] as u32) << 8 | chunk[2] as u32,
            2 => (chunk[0] as u32) << 16 | (chunk[1] as u32) << 8,
            _ => (chunk[0] as u32) << 16,
        };
        let chars = chunk.len() + 1;
        for i in 0..chars {
            out.push(ALPHABET[(n >> (18 - 6 * i) & 0x3f) as usize] as char);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sign_and_verify_round_trip() {
        let sig = sign_request("dvd_abc", "post", "/api/v1/desktop/sync", 1_700_000_000, "n0nce-n0nce-n0nce", b"{}");
        assert!(verify_request(
            "dvd_abc",
            "POST",
            "/api/v1/desktop/sync",
            1_700_000_000,
            "n0nce-n0nce-n0nce",
            b"{}",
            &sig
        ));
        assert!(!verify_request(
            "dvd_abd",
            "POST",
            "/api/v1/desktop/sync",
            1_700_000_000,
            "n0nce-n0nce-n0nce",
            b"{}",
            &sig
        ));
        assert!(!verify_request(
            "dvd_abc",
            "POST",
            "/api/v1/desktop/sync",
            1_700_000_000,
            "n0nce-n0nce-n0nce",
            b"{ }",
            &sig
        ));
    }

    #[test]
    fn pkce_matches_rfc7636_example() {
        // RFC 7636 appendix B.
        assert_eq!(
            pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn commit_ids_are_keyed_and_short() {
        let sha = "0123456789abcdef0123456789abcdef01234567";
        let id = commit_event_id("install-a", sha);
        assert_eq!(id.len(), 16);
        assert!(id.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()));
        assert_eq!(id, commit_event_id("install-a", &format!(" {} ", sha.to_uppercase())));
        assert_ne!(id, commit_event_id("install-b", sha), "another install gets another id");
        assert!(!sha.starts_with(&id[..8]), "never the hash prefix");
        // Python: hmac.new(b"install-a", sha.encode(), hashlib.sha256).hexdigest()[:16]
        assert_eq!(id, "acae9402f1cc3212");
    }

    #[test]
    fn nonce_rules() {
        assert!(nonce_is_well_formed("abcdefghijklmnop"));
        assert!(!nonce_is_well_formed("short"));
        assert!(!nonce_is_well_formed("abcdefghijklmnop!"));
    }
}
