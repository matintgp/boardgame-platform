import uuid

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.friendship import Friendship, FriendshipStatus
from app.models.user import User


async def request_friend(db: AsyncSession, requester: User, addressee: User) -> Friendship:
    if requester.id == addressee.id:
        raise ValueError("You cannot friend yourself")
    existing = await db.scalar(
        select(Friendship).where(
            or_(
                (Friendship.requester_id == requester.id)
                & (Friendship.addressee_id == addressee.id),
                (Friendship.requester_id == addressee.id)
                & (Friendship.addressee_id == requester.id),
            )
        )
    )
    if existing is not None:
        raise ValueError("A friendship already exists between you two")
    fr = Friendship(requester_id=requester.id, addressee_id=addressee.id)
    db.add(fr)
    await db.commit()
    return fr


async def list_friends(db: AsyncSession, user_id: uuid.UUID) -> list[dict]:
    """Accepted friends + incoming/outgoing pending requests."""
    rows = list(await db.scalars(
        select(Friendship).where(
            or_(Friendship.requester_id == user_id, Friendship.addressee_id == user_id)
        )
    ))
    other_ids = [
        fr.addressee_id if fr.requester_id == user_id else fr.requester_id
        for fr in rows
    ]
    users: dict[uuid.UUID, User] = {}
    if other_ids:
        user_rows = await db.scalars(select(User).where(User.id.in_(other_ids)))
        users = {u.id: u for u in user_rows}
    out = []
    for fr in rows:
        other_id = fr.addressee_id if fr.requester_id == user_id else fr.requester_id
        direction = "outgoing" if fr.requester_id == user_id else "incoming"
        other = users.get(other_id)
        profile = other.public_profile() if other is not None else {}
        out.append({
            "request_id": str(fr.id),
            "user_id": str(other_id),
            "status": fr.status.value,
            "direction": direction,
            "username": profile.get("username"),
            "rating": profile.get("rating"),
        })
    return out


async def respond(db: AsyncSession, user_id: uuid.UUID, request_id: uuid.UUID, accept: bool) -> None:
    fr = await db.get(Friendship, request_id)
    if fr is None or fr.addressee_id != user_id:
        raise LookupError("Request not found")
    if fr.status != FriendshipStatus.pending:
        raise ValueError("Request already handled")
    if accept:
        fr.status = FriendshipStatus.accepted
    else:
        await db.delete(fr)
    await db.commit()


async def search_users(db: AsyncSession, query: str) -> list[dict]:
    q = f"%{query.lower()}%"
    rows = await db.scalars(
        select(User).where(User.username.ilike(q)).limit(10)  # noqa: S608
    )
    return [u.public_profile() for u in rows]
