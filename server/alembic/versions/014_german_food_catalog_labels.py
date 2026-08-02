"""improve german food catalog labels

Revision ID: 014_german_food_labels
Revises: 013_user_profile_photo
Create Date: 2026-06-27

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "014_german_food_labels"
down_revision: Union[str, None] = "013_user_profile_photo"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            UPDATE food_item_labels fil
            SET label = CASE LOWER(fi.food_name)
                WHEN 'chicken burger (fast food)' THEN 'Hähnchenburger (Fast Food)'
                WHEN 'veggie burger' THEN 'Gemüseburger'
                WHEN 'lentil burger patty' THEN 'Linsen-Burger-Patty'
                ELSE fil.label
            END
            FROM food_items fi
            WHERE fil.food_id = fi.food_id
              AND fil.language_tag = 'de'
              AND LOWER(fi.food_name) IN ('chicken burger (fast food)', 'veggie burger', 'lentil burger patty')
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE food_category_labels fcl
            SET label = CASE LOWER(REPLACE(fc.category_name, '_', ' '))
                WHEN 'legume pulse' THEN 'Hülsenfrüchte'
                WHEN 'fast food' THEN 'Fast Food'
                ELSE fcl.label
            END
            FROM food_categories fc
            WHERE fcl.category_id = fc.category_id
              AND fcl.language_tag = 'de'
              AND LOWER(REPLACE(fc.category_name, '_', ' ')) IN ('legume pulse', 'fast food')
            """
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            """
            UPDATE food_item_labels fil
            SET label = CASE LOWER(fi.food_name)
                WHEN 'chicken burger (fast food)' THEN 'Hähnchen burger (fast food)'
                WHEN 'veggie burger' THEN 'Veggie burger'
                WHEN 'lentil burger patty' THEN 'Linse burger patty'
                ELSE fil.label
            END
            FROM food_items fi
            WHERE fil.food_id = fi.food_id
              AND fil.language_tag = 'de'
              AND LOWER(fi.food_name) IN ('chicken burger (fast food)', 'veggie burger', 'lentil burger patty')
            """
        )
    )
