"""add language-tagged catalog labels

Revision ID: 004_catalog_language_labels
Revises: 003_canonical_logging_ids
Create Date: 2026-06-22

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "004_catalog_language_labels"
down_revision: Union[str, None] = "003_canonical_logging_ids"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            CREATE TABLE IF NOT EXISTS global_exercise_labels (
                id BIGSERIAL PRIMARY KEY,
                exercise_id BIGINT NOT NULL,
                language_tag VARCHAR(32) NOT NULL,
                label TEXT NOT NULL,
                aliases TEXT[] NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT uq_global_exercise_label_language UNIQUE (exercise_id, language_tag)
            )
            """
        )
    )
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_global_exercise_labels_exercise_id ON global_exercise_labels(exercise_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_global_exercise_labels_language_tag ON global_exercise_labels(language_tag)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_global_exercise_labels_label_lower ON global_exercise_labels((LOWER(label)))"))

    # food_items/food_categories are startup-managed in this app, so keep this
    # migration tolerant of environments that create those tables outside Alembic.
    op.execute(
        sa.text(
            """
            CREATE TABLE IF NOT EXISTS food_item_labels (
                id BIGSERIAL PRIMARY KEY,
                food_id BIGINT NOT NULL,
                language_tag VARCHAR(32) NOT NULL,
                label TEXT NOT NULL,
                aliases TEXT[] NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT uq_food_item_label_language UNIQUE (food_id, language_tag)
            )
            """
        )
    )
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_food_item_labels_food_id ON food_item_labels(food_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_food_item_labels_language_tag ON food_item_labels(language_tag)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_food_item_labels_label_lower ON food_item_labels((LOWER(label)))"))

    op.execute(
        sa.text(
            """
            CREATE TABLE IF NOT EXISTS food_category_labels (
                id BIGSERIAL PRIMARY KEY,
                category_id BIGINT NOT NULL,
                language_tag VARCHAR(32) NOT NULL,
                label TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT uq_food_category_label_language UNIQUE (category_id, language_tag)
            )
            """
        )
    )
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_food_category_labels_category_id ON food_category_labels(category_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_food_category_labels_language_tag ON food_category_labels(language_tag)"))

    op.execute(
        sa.text(
            """
            DO $$
            BEGIN
              IF to_regclass('public.food_items') IS NOT NULL
                 AND NOT EXISTS (
                   SELECT 1 FROM pg_constraint WHERE conname = 'fk_food_item_labels_food_id'
                 ) THEN
                ALTER TABLE food_item_labels
                ADD CONSTRAINT fk_food_item_labels_food_id
                FOREIGN KEY (food_id) REFERENCES food_items(food_id) ON DELETE CASCADE;
              END IF;

              IF to_regclass('public.food_categories') IS NOT NULL
                 AND NOT EXISTS (
                   SELECT 1 FROM pg_constraint WHERE conname = 'fk_food_category_labels_category_id'
                 ) THEN
                ALTER TABLE food_category_labels
                ADD CONSTRAINT fk_food_category_labels_category_id
                FOREIGN KEY (category_id) REFERENCES food_categories(category_id) ON DELETE CASCADE;
              END IF;

              IF to_regclass('public.global_exercises') IS NOT NULL
                 AND NOT EXISTS (
                   SELECT 1 FROM pg_constraint WHERE conname = 'fk_global_exercise_labels_exercise_id'
                 ) THEN
                ALTER TABLE global_exercise_labels
                ADD CONSTRAINT fk_global_exercise_labels_exercise_id
                FOREIGN KEY (exercise_id) REFERENCES global_exercises(id) ON DELETE CASCADE;
              END IF;
            END $$;
            """
        )
    )


def downgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS food_category_labels"))
    op.execute(sa.text("DROP TABLE IF EXISTS food_item_labels"))
    op.execute(sa.text("DROP TABLE IF EXISTS global_exercise_labels"))
