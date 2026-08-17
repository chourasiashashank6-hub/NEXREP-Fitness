"""Gym squad models."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

from src.db.session import Base


class Squad(Base):
    __tablename__ = "squads"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(120), nullable=False)
    creator_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    max_members = Column(Integer, nullable=False, default=6)
    status = Column(String(16), nullable=False, default="active", index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    creator = relationship("User", foreign_keys=[creator_id])
    members = relationship("SquadMember", back_populates="squad", cascade="all, delete-orphan")


class SquadMember(Base):
    __tablename__ = "squad_members"

    squad_id = Column(Integer, ForeignKey("squads.id", ondelete="CASCADE"), primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True)
    role = Column(String(16), nullable=False, default="member")
    status = Column(String(16), nullable=False, default="invited", index=True)
    joined_at = Column(DateTime, nullable=True)
    share_status = Column(Boolean, nullable=False, default=False, index=True)

    squad = relationship("Squad", back_populates="members")
    user = relationship("User")
