import re

from pydantic import BaseModel, EmailStr, Field, field_validator

USERNAME_RE = re.compile(r"^[a-zA-Z0-9_]{3,32}$")


class RegisterIn(BaseModel):
    email: EmailStr
    username: str
    password: str = Field(min_length=8, max_length=128)

    @field_validator("username")
    @classmethod
    def _username(cls, v: str) -> str:
        if not USERNAME_RE.match(v):
            raise ValueError(
                "Username must be 3-32 chars; letters, digits and underscore only"
            )
        return v

    @field_validator("password")
    @classmethod
    def _password_strength(cls, v: str) -> str:
        if v.lower() in ("password", "12345678", "qwertyui"):
            raise ValueError("Password is too common")
        return v


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class UserOut(BaseModel):
    id: str
    email: str
    username: str
    rating: int

    @classmethod
    def from_model(cls, u) -> "UserOut":
        return cls(id=str(u.id), email=u.email, username=u.username, rating=u.rating)


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class FriendRequestIn(BaseModel):
    username: str


class FriendRequestActionIn(BaseModel):
    request_id: str
    accept: bool


class CreateGameIn(BaseModel):
    game_type: str = "chess"
    settings: dict = Field(default_factory=dict)


class JoinGameIn(BaseModel):
    seat: int | None = None


class ActionIn(BaseModel):
    action: str = "move"
    payload: dict


class CreateBotGameIn(BaseModel):
    """POST /games/bot — unrated chess vs Stockfish persona."""

    game_type: str = "chess"
    difficulty: str = Field(min_length=1, max_length=32)
    player_color: str = "random"
