"""
Authentification par PIN + JWT tokens.
Compatible avec le système de PIN existant (params: PIN_ACCUEIL, PIN_TECH).
"""

import os
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt

from app.database import get_cursor
from app.models import LoginRequest, TokenResponse

router = APIRouter(prefix="/api/auth", tags=["auth"])
security = HTTPBearer(auto_error=False)

JWT_SECRET = os.getenv("JWT_SECRET", "klikphone-secret-change-me-in-prod")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_HOURS = 24


def create_token(target: str, utilisateur: str) -> str:
    """Crée un JWT token."""
    expire = datetime.utcnow() + timedelta(hours=JWT_EXPIRE_HOURS)
    payload = {
        "sub": utilisateur,
        "target": target,
        "exp": expire,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    """Décode et valide un JWT token."""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token invalide ou expiré",
        )


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> dict:
    """Dépendance FastAPI pour vérifier l'authentification."""
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Non authentifié",
        )
    return decode_token(credentials.credentials)


async def get_optional_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> Optional[dict]:
    """Auth optionnelle (pour les routes publiques qui bénéficient d'un contexte user)."""
    if credentials is None:
        return None
    try:
        return decode_token(credentials.credentials)
    except HTTPException:
        return None


@router.post("/login", response_model=TokenResponse)
async def login(req: LoginRequest):
    """Authentification par PIN.
    
    Vérifie le PIN contre la table params (PIN_ACCUEIL ou PIN_TECH).
    """
    if req.target not in ("accueil", "tech"):
        raise HTTPException(400, "Target invalide: accueil ou tech")

    param_key = f"PIN_{req.target.upper()}"

    with get_cursor() as cur:
        cur.execute("SELECT valeur FROM params WHERE cle = %s", (param_key,))
        row = cur.fetchone()

    if not row:
        raise HTTPException(500, "PIN non configuré dans la base")

    stored_pin = row["valeur"]
    if req.pin != stored_pin:
        raise HTTPException(401, "PIN incorrect")

    utilisateur = req.utilisateur or req.target.capitalize()
    token = create_token(req.target, utilisateur)

    return TokenResponse(
        access_token=token,
        target=req.target,
        utilisateur=utilisateur,
    )


@router.get("/me")
async def get_me(user: dict = Depends(get_current_user)):
    """Retourne les infos de l'utilisateur connecté."""
    return {
        "utilisateur": user["sub"],
        "target": user["target"],
    }
