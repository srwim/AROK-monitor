"""AROK Monitor - license generator (DEV TOOL - never ship this or the private key).

First run creates a keypair:
  license_private.pem  (keep secret, used to sign)
  license_pub.hex      (ships with the app)

Generate a license:
  python generate_license.py --name "Jane Doe" --email jane@example.com --days 365
"""
import argparse
import base64
import datetime
import json
import os

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

HERE = os.path.dirname(os.path.abspath(__file__))
PRIV = os.path.join(HERE, "license_private.pem")
PUB = os.path.join(HERE, "license_pub.hex")


def _b64e(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def ensure_keys() -> Ed25519PrivateKey:
    if os.path.exists(PRIV):
        with open(PRIV, "rb") as f:
            return serialization.load_pem_private_key(f.read(), password=None)
    key = Ed25519PrivateKey.generate()
    with open(PRIV, "wb") as f:
        f.write(key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ))
    pub = key.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw
    )
    with open(PUB, "w") as f:
        f.write(pub.hex())
    print(f"new keypair created:\n  private: {PRIV} (KEEP SECRET)\n  public:  {PUB} (ships with app)")
    return key


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", required=True)
    ap.add_argument("--email", required=True)
    ap.add_argument("--days", type=int, default=0, help="0 = perpetual")
    ap.add_argument("--tier", default="pro")
    args = ap.parse_args()

    key = ensure_keys()
    payload = {
        "name": args.name,
        "email": args.email,
        "expires": (datetime.date.today() + datetime.timedelta(days=args.days)).isoformat() if args.days else None,
        "tier": args.tier,
    }
    raw = json.dumps(payload, separators=(",", ":")).encode()
    license_key = _b64e(raw) + "." + _b64e(key.sign(raw))
    print("\nLICENSE KEY:\n" + license_key)


if __name__ == "__main__":
    main()
