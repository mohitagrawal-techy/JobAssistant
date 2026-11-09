"""Google sign-in using the OpenID Connect authorization code flow."""

from dataclasses import dataclass
from datetime import UTC, datetime
from urllib.parse import urlencode

import httpx
import jwt

from app.config import get_settings

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
ISSUERS = {"https://accounts.google.com", "accounts.google.com"}
HTTP_TIMEOUT_SECONDS = 15


class GoogleAuthError(Exception):
    pass


@dataclass(frozen=True)
class GoogleIdentity:
    subject: str
    email: str
    email_verified: bool


def is_configured() -> bool:
    settings = get_settings()
    return bool(settings.google_client_id and settings.google_client_secret)


def _redirect_uri() -> str:
    return f"{get_settings().app_base_url}/api/auth/google/callback"


def authorization_url(state: str, nonce: str) -> str:
    query = urlencode(
        {
            "client_id": get_settings().google_client_id,
            "redirect_uri": _redirect_uri(),
            "response_type": "code",
            "scope": "openid email",
            "state": state,
            "nonce": nonce,
            "prompt": "select_account",
        }
    )
    return f"{AUTH_URL}?{query}"


async def _post_token(code: str) -> dict:
    settings = get_settings()
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as client:
            response = await client.post(
                TOKEN_URL,
                data={
                    "code": code,
                    "client_id": settings.google_client_id,
                    "client_secret": settings.google_client_secret,
                    "redirect_uri": _redirect_uri(),
                    "grant_type": "authorization_code",
                },
            )
        response.raise_for_status()
        return response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise GoogleAuthError("Token exchange failed") from exc


async def fetch_identity(code: str, nonce: str) -> GoogleIdentity:
    """Swap the sign-in code for the user's verified identity."""
    tokens = await _post_token(code)
    try:
        # OpenID Connect allows skipping the signature check here, because this token came
        # straight from Google's token endpoint over TLS. Its claims still need checking.
        claims = jwt.decode(tokens["id_token"], options={"verify_signature": False})
        issuer, audience, expires = claims["iss"], claims["aud"], float(claims["exp"])
        subject, email = str(claims["sub"]), str(claims["email"]).lower()
        token_nonce = claims["nonce"]
    except (jwt.PyJWTError, KeyError, TypeError, ValueError) as exc:
        raise GoogleAuthError("Malformed ID token") from exc

    if issuer not in ISSUERS:
        raise GoogleAuthError("Unexpected issuer")
    if audience != get_settings().google_client_id:
        raise GoogleAuthError("Token was issued for another app")
    if expires <= datetime.now(UTC).timestamp():
        raise GoogleAuthError("Token has expired")
    if token_nonce != nonce:
        raise GoogleAuthError("Nonce mismatch")
    return GoogleIdentity(subject, email, claims.get("email_verified") is True)
