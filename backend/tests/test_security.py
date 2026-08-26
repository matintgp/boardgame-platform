import pytest

from app.core.security import (
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)
from app.games.registry import get_engine


def test_password_hash_roundtrip():
    h = hash_password("correct horse battery staple")
    assert verify_password("correct horse battery staple", h)
    assert not verify_password("wrong", h)
    # Argon2 hashes are salted
    assert h != hash_password("correct horse battery staple")


def test_jwt_roundtrip():
    import uuid

    uid = uuid.uuid4()
    token = create_access_token(uid)
    assert decode_access_token(token) == uid


def test_registry_has_chess():
    cls = get_engine("chess")
    assert cls.game_id == "chess"


def test_registry_rejects_unknown():
    with pytest.raises(KeyError):
        get_engine("nope")
