#!/usr/bin/env python3
"""Safely reset an existing active Membership CRM Super Admin password."""

from __future__ import annotations

import getpass
import hashlib
import hmac
import json
from pathlib import Path
import secrets
import sqlite3
import sys
from datetime import datetime

CRM_DIR = Path.home() / "Documents" / "Membership CRM"
DATABASE_PATH = CRM_DIR / "membership_crm.db"
BACKUP_DIR = CRM_DIR / "Backups"
MIN_PASSWORD_LENGTH = 8
EXPECTED_SCHEME = "pbkdf2_sha256"


class ResetError(RuntimeError):
    """A safe, user-facing reset failure."""


def parse_existing_hash(encoded: str) -> tuple[int, int, int]:
    """Return iterations, salt byte length, and digest byte length."""
    try:
        scheme, iterations_text, salt_hex, digest_hex = encoded.split("$")
        iterations = int(iterations_text)
        salt = bytes.fromhex(salt_hex)
        digest = bytes.fromhex(digest_hex)
    except (AttributeError, TypeError, ValueError) as exc:
        raise ResetError("The selected account has an unsupported password hash format.") from exc
    if scheme != EXPECTED_SCHEME or iterations <= 0 or not salt or not digest:
        raise ResetError("The selected account does not use the expected PBKDF2-SHA256 format.")
    return iterations, len(salt), len(digest)


def hash_password(password: str, existing_hash: str) -> str:
    iterations, salt_length, digest_length = parse_existing_hash(existing_hash)
    salt = secrets.token_bytes(salt_length)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, iterations, dklen=digest_length
    )
    return f"{EXPECTED_SCHEME}${iterations}${salt.hex()}${digest.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    """Verify the generated value before committing it to the database."""
    try:
        scheme, iterations_text, salt_hex, expected_hex = encoded.split("$")
        if scheme != EXPECTED_SCHEME:
            return False
        expected = bytes.fromhex(expected_hex)
        actual = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            bytes.fromhex(salt_hex),
            int(iterations_text),
            dklen=len(expected),
        )
        return hmac.compare_digest(actual, expected)
    except (TypeError, ValueError):
        return False


def connect_read_only() -> sqlite3.Connection:
    connection = sqlite3.connect(
        DATABASE_PATH.resolve().as_uri() + "?mode=ro", uri=True, timeout=10
    )
    connection.row_factory = sqlite3.Row
    return connection


def active_super_admins(connection: sqlite3.Connection) -> list[sqlite3.Row]:
    return connection.execute(
        """
        SELECT id, username, full_name, password_hash
        FROM users
        WHERE role = ? AND is_active = 1
        ORDER BY username COLLATE NOCASE
        """,
        ("Super Admin",),
    ).fetchall()


def choose_account(accounts: list[sqlite3.Row]) -> sqlite3.Row:
    print("Active Super Admin accounts:")
    for index, account in enumerate(accounts, start=1):
        print(f"  {index}. {account['username']} — {account['full_name']}")
    while True:
        choice = input("Select the account number to reset (or q to cancel): ").strip()
        if choice.lower() in {"q", "quit", "cancel"}:
            raise KeyboardInterrupt
        try:
            selected = int(choice)
        except ValueError:
            print("Enter one of the account numbers shown above.")
            continue
        if 1 <= selected <= len(accounts):
            return accounts[selected - 1]
        print("Enter one of the account numbers shown above.")


def prompt_for_password() -> str:
    while True:
        first = getpass.getpass("New password: ")
        if len(first) < MIN_PASSWORD_LENGTH:
            print(f"Password must contain at least {MIN_PASSWORD_LENGTH} characters.")
            first = ""
            continue
        second = getpass.getpass("Confirm new password: ")
        if not hmac.compare_digest(first, second):
            print("Passwords do not match. Try again.")
            first = second = ""
            continue
        second = ""
        return first


def create_backup() -> Path:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    backup_path = BACKUP_DIR / f"membership_crm_before_admin_password_reset_{timestamp}.db"
    source = sqlite3.connect(str(DATABASE_PATH), timeout=10)
    destination = sqlite3.connect(str(backup_path), timeout=10)
    try:
        source.backup(destination)
        destination.commit()
    finally:
        destination.close()
        source.close()
    if not backup_path.is_file() or backup_path.stat().st_size == 0:
        raise ResetError("The safety backup could not be verified; no changes were made.")
    return backup_path


def reset_password(account: sqlite3.Row, new_hash: str, backup_path: Path) -> None:
    connection = sqlite3.connect(str(DATABASE_PATH), timeout=10)
    try:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("BEGIN IMMEDIATE")
        current = connection.execute(
            """
            SELECT id, username, full_name FROM users
            WHERE id = ? AND role = ? AND is_active = 1
            """,
            (account["id"], "Super Admin"),
        ).fetchone()
        if current is None:
            raise ResetError("The selected account is no longer an active Super Admin.")
        updated = connection.execute(
            "UPDATE users SET password_hash = ? WHERE id = ? AND role = ? AND is_active = 1",
            (new_hash, account["id"], "Super Admin"),
        )
        if updated.rowcount != 1:
            raise ResetError("The password update was not applied exactly once.")
        details = json.dumps(
            {
                "event": "local_super_admin_password_reset",
                "method": EXPECTED_SCHEME,
                "backup_file": backup_path.name,
                "plain_text_password_stored": False,
            },
            separators=(",", ":"),
        )
        connection.execute(
            """
            INSERT INTO audit_log (
                user_id, username, user_full_name, action_type,
                record_type, record_id, details
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                current[0], current[1], current[2], "LOCAL_PASSWORD_RESET",
                "user", str(current[0]), details,
            ),
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def main() -> int:
    if not DATABASE_PATH.is_file():
        raise ResetError(f"CRM database not found at: {DATABASE_PATH}")
    with connect_read_only() as connection:
        accounts = active_super_admins(connection)
    if not accounts:
        raise ResetError("No active Super Admin exists. This utility will not create a new admin.")
    account = choose_account(accounts)
    parse_existing_hash(account["password_hash"])
    password = prompt_for_password()
    try:
        new_hash = hash_password(password, account["password_hash"])
        if not verify_password(password, new_hash):
            raise ResetError("Password hash verification failed; no changes were made.")
        backup_path = create_backup()
        reset_password(account, new_hash, backup_path)
    finally:
        password = ""
    print(f"Password reset completed for {account['username']} ({account['full_name']}).")
    print(f"Safety backup: {backup_path}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\nPassword reset cancelled. No changes were made.")
        raise SystemExit(1)
    except (ResetError, sqlite3.Error, OSError) as exc:
        print(f"Password reset failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
